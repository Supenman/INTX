#!/usr/bin/env node
/**
 * 设计令牌收口门禁。
 *
 * 背景：同一套界面里 stone / slate / gray 与裸 text-[Npx] 混着写，明暗主题下表现不一致，
 * 而且改一次 token 要翻遍全项目。tsc / 单测 / 构建都抓不到这类问题。
 *
 * 规则来自 HANDOFF 第 3 节映射表：
 *   - 禁止 stone / slate / gray / zinc / neutral 档位色
 *   - 禁止裸黑 / 裸白（AGENTS.md「不要硬编码黑白、stone、slate 等颜色」）
 *   - 禁止裸字号 text-[N px] / text-[N rem]
 *   - 禁止裸圆角 rounded-[N px] / rounded-[N rem]
 *
 * 放行（AGENTS.md 明确允许）：
 *   - 扁平按钮 hover 反馈 hover:bg-black/5 / dark:hover:bg-white/10
 *
 * 基线机制：check-tokens.baseline.json 记录每个文件的当前命中数。
 * 只允许 ≤ 基线，增加即失败；减少后请用 --update 降低基线，避免回退。
 *
 * 用法：
 *   npm run check:tokens              # 按基线校验
 *   npm run check:tokens -- --update  # 收口后重写基线（只能降低）
 *   npm run check:tokens -- --json    # 只输出 JSON
 *
 * 退出码：0 通过；1 有新增或读取失败。
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");
const BASELINE = join(ROOT, "scripts", "check-tokens.baseline.json");
const EXT = /\.(tsx?|jsx?)$/;

/** 全局样式里也不允许写死十六进制 / rgba 颜色（除 tokens.css 的 Primitive 层定义本体）。 */
const CSS_GLOBALS = ["src/styles/globals.css"];
const CSS_TOKEN_DEFS = /^\s*--[\w-]+:/;

/** AGENTS.md 允许的扁平按钮 hover 反馈：判色前先抠掉，避免误报。 */
const ALLOWED = [/dark:hover:bg-white\/10/g, /hover:bg-black\/5/g, /dark:hover:bg-white\/5/g, /hover:bg-black\/10/g];

/**
 * 叠在彩色片段 / 视频画面 / 固定浅色浮层上的真黑白：换成 --foreground 会随明暗反转看不清，
 * 与 IMAGE_OVERLAY_ALLOW 同理，只是这里叠的是媒体块与浮层，不是用户上传的图片。
 * 按「文件 + 精确 class」放行，不用行号——代码增删行不会让豁免悄悄失效。
 * 边界断言保证 bg-white 不会误伤 bg-white/30 这类带透明度的类。
 */
const OVERLAY_CLASS_ALLOW = new Map([
    [
        "src/components/canvas/canvas-timeline-dialog.tsx",
        new Set(["bg-black", "text-white/60", "bg-black/5", "bg-white/5", "text-white", "bg-white/30", "bg-white/20"]),
    ],
    ["src/components/canvas/canvas-node.tsx", new Set(["text-white"])],
    ["src/components/canvas/canvas-selection-toolbar.tsx", new Set(["bg-white", "border-black/10", "bg-black/10"])],
]);
function escapeClass(cls) {
    return cls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 叠在用户图片上的选区 / 蒙层 / 手柄：必须用真黑真白。
 *
 * 这些元素与界面主题无关——要保证在任意一张图片（亮片、暗片、透明片）上都看得见。
 * 换成 --foreground 会跟着明暗反转：暗色主题下白色手柄变浅灰，落在浅色图片上就消失了。
 * 按「文件 + 行号」逐条豁免，新增必须写明理由，不要整文件放行。
 */
const IMAGE_OVERLAY_ALLOW = new Map([
    [
        "src/components/canvas/canvas-node-crop-dialog.tsx",
        new Set([
            77, // 裁剪画布垫底 bg-black/5
            80, // 图片舞台底 bg-black（图片可能带透明）
            85, // 裁剪框边 border-white
            86, 87, 88, 89, // 三分线 border-white/50
            94, // 拖拽手柄 border-black bg-white
            164, 165, 166, 167, // 框外蒙层 bg-black/55
        ]),
    ],
    [
        "src/components/canvas/canvas-node-mask-edit-dialog.tsx",
        new Set([
            256, // 画笔预览圈 border-white/90 bg-black/5（叠在图上）
            259, // 画笔尺寸标签 bg-black/75 text-white
        ]),
    ],
]);

const RULES = [
    {
        id: "neutral",
        label: "中性色档位（stone/slate/gray/zinc/neutral）",
        re: /\b(?:bg|text|border|ring|fill|stroke|from|to|via|divide|placeholder|outline|decoration|caret|accent|shadow)-(?:stone|slate|gray|zinc|neutral)-\d{2,3}\b/g,
    },
    {
        id: "blackwhite",
        label: "裸黑/裸白",
        re: /\b(?:bg|text|border|fill|stroke|from|to|via|divide)-(?:white|black)(?:\/\d{1,3})?\b/g,
    },
    {
        id: "fontsize",
        label: "裸字号 text-[Npx]",
        re: /\btext-\[\d+(?:\.\d+)?(?:px|rem)\]/g,
    },
    {
        id: "radius",
        label: "裸圆角 rounded-[Npx]",
        re: /\brounded-\[\d+(?:\.\d+)?(?:px|rem)\]/g,
    },
    {
        id: "hardcoded",
        label: "写死颜色（十六进制 / rgba）",
        re: /#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?)\(/g,
    },
];

/** 只对全局样式文件套用「写死颜色」规则，且跳过 :root / .dark 里的 token 定义行。 */
const CSS_ONLY_RULES = new Set(["hardcoded"]);

function walk(dir) {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return walk(path);
        return EXT.test(name) ? [path] : [];
    });
}

function scan() {
    const result = new Map();
    for (const file of walk(SRC)) {
        const rel = relative(ROOT, file).replace(/\\/g, "/");
        const lines = readFileSync(file, "utf8").split("\n");
        const allowLines = IMAGE_OVERLAY_ALLOW.get(rel);
        const allowClasses = OVERLAY_CLASS_ALLOW.get(rel);
        const counts = {};
        let total = 0;
        for (const [index, raw] of lines.entries()) {
            let line = raw;
            for (const allow of ALLOWED) line = line.replace(allow, "");
            if (allowClasses) {
                for (const cls of allowClasses) {
                    line = line.replace(new RegExp(`(?<![\\w/-])${escapeClass(cls)}(?![\\w/-])`, "g"), "");
                }
            }
            for (const rule of RULES) {
                if (CSS_ONLY_RULES.has(rule.id)) continue;
                // 图片叠层豁免只针对裸黑裸白，其他规则照常检查。
                if (rule.id === "blackwhite" && allowLines?.has(index + 1)) continue;
                const n = (line.match(rule.re) || []).length;
                if (!n) continue;
                counts[rule.id] = (counts[rule.id] || 0) + n;
                total += n;
            }
        }
        if (total) result.set(rel, { total, ...counts });
    }
    // 全局样式：写死颜色一律记在 hardcoded 下，token 定义行跳过。
    for (const rel of CSS_GLOBALS) {
        const lines = readFileSync(join(ROOT, rel), "utf8").split("\n");
        let n = 0;
        for (const line of lines) {
            if (CSS_TOKEN_DEFS.test(line)) continue;
            n += (line.match(/#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?)\(/g) || []).length;
        }
        if (!n) continue;
        const prev = result.get(rel) || { total: 0 };
        result.set(rel, { ...prev, total: prev.total + n, hardcoded: (prev.hardcoded || 0) + n });
    }
    return result;
}

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const update = args.includes("--update");
/** 存量入账：基线长期没跟上时一次性记账，只能人工决定后使用，之后仍只许降低。 */
const reseat = args.includes("--reseat");
const current = scan();
const currentTotal = [...current.values()].reduce((sum, v) => sum + v.total, 0);

if (reseat) {
    const next = Object.fromEntries([...current.entries()].sort(([a], [b]) => a.localeCompare(b)));
    let prev = null;
    try {
        prev = JSON.parse(readFileSync(BASELINE, "utf8"));
    } catch {
        // 首次生成。
    }
    writeFileSync(BASELINE, `${JSON.stringify({ total: currentTotal, files: next }, null, 4)}\n`, "utf8");
    console.log(`基线已重置为当前存量：${currentTotal} 处（原 ${prev?.total ?? "无"}）`);
    for (const [file, stat] of Object.entries(next)) {
        const before = prev?.files?.[file]?.total ?? 0;
        if (stat.total !== before) console.log(`  ${file}: ${before} -> ${stat.total}`);
    }
    process.exit(0);
}

if (update) {
    const next = Object.fromEntries([...current.entries()].sort(([a], [b]) => a.localeCompare(b)));
    let prev = null;
    try {
        prev = JSON.parse(readFileSync(BASELINE, "utf8")).files || {};
    } catch {
        // 首次生成：没有旧基线就不做「只允许降低」校验。
    }
    // 只允许降低：任何文件都不许比旧基线更高，防止「改坏了顺手更新基线」。
    const raised = prev ? Object.keys(next).filter((f) => (next[f].total || 0) > (prev[f]?.total || 0)) : [];
    if (raised.length) {
        console.error("基线只允许降低，以下文件比旧基线更多，请先修掉：");
        for (const f of raised) console.error(`  ${f}: ${prev[f]?.total || 0} -> ${next[f].total}`);
        process.exit(1);
    }
    writeFileSync(BASELINE, `${JSON.stringify({ total: currentTotal, files: next }, null, 4)}\n`, "utf8");
    console.log(`基线已更新：${currentTotal} 处`);
    process.exit(0);
}

let baseline;
try {
    baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
} catch {
    console.error("缺少 scripts/check-tokens.baseline.json，先跑一次 --update 生成");
    process.exit(1);
}

const regressions = [];
for (const [file, stat] of current) {
    const allowed = baseline.files[file]?.total ?? 0;
    if (stat.total > allowed) regressions.push({ file, allowed, actual: stat.total, delta: stat.total - allowed });
}

if (asJson) {
    console.log(JSON.stringify({ total: currentTotal, baselineTotal: baseline.total, regressions }, null, 2));
} else if (regressions.length) {
    console.error("设计令牌收口回退：以下文件裸值比基线多\n");
    for (const r of regressions) console.error(`  ${r.file}  ${r.allowed} -> ${r.actual}（+${r.delta}）`);
    console.error("\n按 HANDOFF 第 3 节映射表换成 token，或确属误报时补进脚本的 ALLOWED。");
} else {
    const saved = baseline.total - currentTotal;
    console.log(`设计令牌检查通过：${currentTotal} 处（基线 ${baseline.total}${saved > 0 ? `，已减少 ${saved}` : ""}）`);
}

process.exit(regressions.length ? 1 : 0);
