#!/usr/bin/env node
/**
 * 三视口横向溢出检查。
 *
 * 背景：连续两轮 UI 问题都出在「只测了桌面宽度」。tsc / 单测 / 构建一个都抓不到
 * flex 子项不收缩导致的横向溢出，只能真的用窄视口渲染一遍。
 *
 * 做法：起一个 preview 服务，逐页 × 逐视口打开，遍历 body 下所有元素的
 * getBoundingClientRect()，找出越过视口左右边界、且祖先没有任何裁剪/滚动容器的元素。
 *
 * 用法：
 *   npm run build && npm run check:overflow
 *   node scripts/check-overflow.mjs --base http://127.0.0.1:3000   # 复用已起的服务
 *   node scripts/check-overflow.mjs --json                          # 只输出 JSON
 *
 * 退出码：0 无溢出；1 发现溢出或检查失败。
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ARTIFACT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "ui-overflow-artifacts");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const BASE = value("--base", "");
const SELF_SERVE = !flag("--base");
const JSON_ONLY = flag("--json");
let PORT = Number(value("--port", "0"));

/** 拿一个空闲端口，避免上次残留进程把默认端口占住。 */
function findFreePort() {
    return new Promise((resolve, reject) => {
        const srv = createServer();
        srv.unref();
        srv.on("error", reject);
        srv.listen(0, "127.0.0.1", () => {
            const { port } = srv.address();
            srv.close(() => resolve(port));
        });
    });
}

/** 被测页面。`/canvas/:id` 需要真实项目数据，不纳入。 */
const ROUTES = [
    { path: "/", name: "首页" },
    { path: "/assets", name: "我的资产" },
    { path: "/prompts", name: "提示词库" },
    { path: "/tasks", name: "任务中心" },
    { path: "/canvas", name: "我的画布" },
    { path: "/config", name: "配置" },
    // 画布详情（/canvas/:id）需要真实项目数据，自动检查造不出场景，留给真机。
    { path: "/__not-found__", name: "404 页" },
];

const VIEWPORTS = [
    { width: 390, height: 844, name: "390" },
    { width: 768, height: 1024, name: "768" },
    { width: 1440, height: 900, name: "1440" },
];

/** 在页面里跑的检测函数（自包含，会被序列化注入）。 */
function collectOverflow(vw) {
    const TOLERANCE = 1;

    /**
     * 只有「显式声明的横向滚动区」才豁免。
     *
     * 不能用 overflow-x: auto/scroll 一刀切——一个普通的 `overflow-y-auto` 容器
     * 会被 CSS 连带算成 overflow-x: auto，从而把真实溢出藏起来（真实案例：视频页
     * 390 下溢出 89px，元素被父容器横向滚动兜住，但用户看到的就是布局坏掉）。
     */
    const EXPLICIT_HSCROLL = "[data-hscroll], .ant-table-body, .ant-table-content, .ant-tabs-nav, .ant-tabs-nav-list, .ant-carousel";
    const isExplicitHScroll = (el) => {
        let p = el.parentElement;
        while (p && p !== document.documentElement) {
            if (p.matches && p.matches(EXPLICIT_HSCROLL)) return true;
            p = p.parentElement;
        }
        return false;
    };

    const describe = (el) => {
        const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 3).join(".") : "";
        const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
        return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${cls ? "." + cls : ""}${text ? ` 「${text}」` : ""}`;
    };

    const overflowEls = [];
    for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;

        const cs = getComputedStyle(el);
        if (cs.position === "fixed") continue; // 浮层/抽屉/提示，不参与页面宽度
        if (cs.visibility === "hidden" || cs.display === "none") continue;

        const overRight = r.right > vw + TOLERANCE;
        const overLeft = r.left < -TOLERANCE;
        if (!overRight && !overLeft) continue;
        if (isExplicitHScroll(el)) continue;

        overflowEls.push({ el, r, overRight });
    }

    // 只保留最外层越界元素：子元素越界只是父容器越界的重复表现，逐层上报没法读
    const overflowSet = new Set(overflowEls.map((o) => o.el));
    const topLevel = overflowEls.filter((o) => {
        let p = o.el.parentElement;
        while (p) {
            if (overflowSet.has(p)) return false;
            p = p.parentElement;
        }
        return true;
    });

    const offenders = [];
    for (const { el, r, overRight } of topLevel) {
        // 滑出式侧栏（Agent 面板）根节点本身在视口外是设计如此；它的子元素已被上面吸收
        if (el.tagName === "ASIDE" || el.matches?.("[data-slide-panel]")) continue;
        offenders.push({
            element: describe(el),
            left: Math.round(r.left),
            right: Math.round(r.right),
            width: Math.round(r.width),
            over: Math.round(overRight ? r.right - vw : -r.left),
        });
    }

    // 同位置重复上报去重
    const seen = new Set();
    const unique = offenders.filter((o) => {
        const key = `${o.element}|${o.left}|${o.right}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    return {
        innerWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        pageOverflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
        rendered: (document.body?.innerText || "").trim().length > 0,
        offenders: unique.slice(0, 15),
        offenderCount: unique.length,
    };
}

function startPreview() {
    return new Promise((resolve, reject) => {
        const child = spawn("npx", ["vite", "preview", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
            stdio: ["ignore", "pipe", "pipe"],
            shell: process.platform === "win32",
        });
        let ready = false;
        const timer = setTimeout(() => {
            if (!ready) {
                child.kill();
                reject(new Error("preview 服务 15s 内未就绪"));
            }
        }, 15000);
        const onData = (buf) => {
            const text = buf.toString();
            if (/Local:\s+http/.test(text) && !ready) {
                ready = true;
                clearTimeout(timer);
                resolve(child);
            }
        };
        child.stdout.on("data", onData);
        child.stderr.on("data", onData);
        child.on("error", (e) => {
            clearTimeout(timer);
            reject(e);
        });
    });
}

/**
 * 优先用 playwright 自带的 chromium；本机没有时回退到系统 chromium/chrome。
 * CI 里由 `playwright install` 保证第一种可用。
 */
async function launchBrowser(playwright) {
    const candidates = [undefined, process.env.CHROMIUM_PATH, "/usr/bin/chromium", "/usr/bin/google-chrome", "/usr/bin/chromium-browser"].filter(
        (v) => v !== null,
    );
    let lastError;
    for (const executablePath of candidates) {
        try {
            return await playwright.chromium.launch(executablePath ? { executablePath } : {});
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError;
}

async function main() {
    let playwright;
    try {
        playwright = await import("playwright");
    } catch {
        console.error("缺少 playwright。先执行：pnpm add -D playwright && npx playwright install chromium");
        process.exit(1);
    }

    let server = null;
    let base = BASE;
    if (SELF_SERVE) {
        if (!PORT) PORT = await findFreePort();
        try {
            server = await startPreview();
            base = `http://127.0.0.1:${PORT}`;
        } catch (error) {
            console.error(`起 preview 失败：${error.message}`);
            console.error("如果还没构建：npm run build；或手动起服务后用 --base 指定。");
            process.exit(1);
        }
    }

    const results = [];
    const failures = [];
    let browser;
    try {
        browser = await launchBrowser(playwright);
        for (const viewport of VIEWPORTS) {
            const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
            const consoleErrors = [];
            page.on("pageerror", (e) => consoleErrors.push(String(e).slice(0, 200)));

            for (const route of ROUTES) {
                const url = `${base}${route.path}`;
                try {
                    // SPA 里常有持续轮询，networkidle 不可靠；用 domcontentloaded + 固定等待
                    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
                    await page.waitForFunction(() => document.body && document.body.innerText.trim().length > 0, null, { timeout: 8000 }).catch(() => {});
                    await page.waitForTimeout(900);
                    const data = await page.evaluate(collectOverflow, viewport.width);
                    // 页面没渲染出内容时不能算「无溢出」，否则是假绿
                    if (!data.rendered) {
                        throw new Error("页面内容为空，可能未完成渲染");
                    }
                    const record = { viewport: viewport.name, route: route.path, name: route.name, ...data };
                    results.push(record);
                    if (data.offenderCount > 0 || data.pageOverflow > 0) {
                        failures.push(record);
                        // 留一张现场图，CI 失败时直接能看（artifact 上传）
                        await mkdir(ARTIFACT_DIR, { recursive: true }).catch(() => {});
                        const shot = join(ARTIFACT_DIR, `${viewport.name}-${route.path.replace(/\//g, "_") || "home"}.png`);
                        await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
                    }
                } catch (error) {
                    results.push({ viewport: viewport.name, route: route.path, name: route.name, error: String(error).slice(0, 200) });
                    failures.push({ viewport: viewport.name, route: route.path, name: route.name, error: String(error).slice(0, 200), offenders: [] });
                }
            }
            if (consoleErrors.length) {
                results.push({ viewport: viewport.name, consoleErrors });
            }
            await page.close();
        }
    } finally {
        await browser?.close();
        server?.kill();
    }

    if (JSON_ONLY) {
        console.log(JSON.stringify({ base, results, ok: failures.length === 0 }, null, 2));
    } else {
        console.log(`\n三视口横向溢出检查 · ${base}\n`);
        for (const viewport of VIEWPORTS) {
            const rows = results.filter((r) => r.viewport === viewport.name && r.route);
            const bad = rows.filter((r) => (r.offenderCount || 0) > 0 || (r.pageOverflow || 0) > 0 || r.error);
            const widthNote = rows.map((r) => r.innerWidth).find(Boolean) || viewport.width;
            const realWidth = rows.length ? rows[0].innerWidth : viewport.width;
            console.log(`${viewport.name.padEnd(5)} 宽（实测 ${realWidth || widthNote}px）：${bad.length === 0 ? "无溢出" : `${bad.length} 页溢出`}`);
            for (const row of bad) {
                if (row.error) {
                    console.log(`  ✗ ${row.name} ${row.route} — 打开失败：${row.error}`);
                    continue;
                }
                console.log(`  ✗ ${row.name} ${row.route} — 页面越界 ${row.pageOverflow}px，${row.offenderCount} 个元素`);
                for (const o of row.offenders.slice(0, 5)) {
                    console.log(`      ${o.element}  left=${o.left} right=${o.right} 超出 ${o.over}px`);
                }
            }
        }
        const consoleRows = results.filter((r) => r.consoleErrors);
        if (consoleRows.length) {
            console.log("\n页面运行时错误：");
            for (const row of consoleRows) console.log(`  ${row.viewport}: ${row.consoleErrors.join(" | ")}`);
        }
        console.log(failures.length === 0 ? "\n✓ 全部通过\n" : `\n✗ ${failures.length} 项未通过\n`);
    }

    process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
