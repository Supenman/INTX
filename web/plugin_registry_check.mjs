/**
 * 插件市场端到端验收：清单能不能拉、装了能不能用。
 *
 * 这条链路之前一直是断的——清单地址指向上游作者的仓库，用户装的是别人的插件。
 * 改指自己的 plugins-dist 分支后，这里盯住三件事：
 *
 * 1. 清单请求打到自己仓库的地址，且返回 200
 * 2. 五个官方插件都列出来，每项都有安装按钮
 * 3. 点第一个安装，真的从 CDN 下载到 js，且按钮变成已安装态
 *
 * 依赖：仓库必须是公开的（jsDelivr 不服务私有仓库）。私有时会 404，
 * 本脚本会明确报 REGISTRY_HTTP 便于区分「代码坏了」和「仓库还没转公开」。
 */
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://127.0.0.1:3010";
const EXPECT_PREFIX = "cdn.jsdelivr.net/gh/Supenman/INTX@plugins-dist/";
const EXPECT_PLUGINS = ["Markdown 节点", "SVG 节点", "HTML 节点", "3D 全景节点", "便利贴节点"];

const browser = await chromium.launch({ headless: true, executablePath: "/usr/bin/chromium", args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const registryHits = [];
const pluginJs = [];
const errors = [];
page.on("response", (r) => {
    const u = r.url();
    if (u.includes("official-plugins.json")) registryHits.push({ url: u, status: r.status() });
    if (/\/(markdown|svg|html|panorama|sticky-note)\.js$/.test(u)) pluginJs.push({ name: u.split("/").pop(), status: r.status() });
});
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(m.text()); });

// 进画布：有画布点第一个，没有就新建
await page.goto(`${BASE}/canvas`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
const existing = page.locator('[data-canvas-id], [data-testid="canvas-card"]').first();
if (await existing.count()) {
    await existing.click();
} else {
    await page.getByRole("button", { name: "新建画布" }).first().click();
    await page.waitForTimeout(800);
    const confirm = page.getByRole("button", { name: /新建|确定|创建/ }).last();
    if (await confirm.count()) await confirm.click();
}
await page.waitForTimeout(2500);

await page.getByRole("button", { name: "节点插件" }).first().click();
await page.waitForTimeout(2500);

// 1. 清单请求打到自己仓库
const hit = registryHits.find((h) => h.url.includes(EXPECT_PREFIX));
console.log("REGISTRY_URL_OK:", Boolean(hit));
console.log("REGISTRY_HTTP:", hit ? hit.status : "NO_REQUEST");

// 2. 五个插件都在，都有安装按钮
const modalText = await page.locator(".ant-modal-body").innerText().catch(() => "");
const listed = EXPECT_PLUGINS.filter((n) => modalText.includes(n));
console.log("PLUGINS_LISTED:", listed.length, JSON.stringify(listed));
const installCount = await page.getByRole("button", { name: "安装" }).count();
console.log("INSTALL_BUTTONS:", installCount);

// 3. 装第一个，确认真的下载了 js 并变成已安装态
if (installCount > 0) {
    await page.getByRole("button", { name: "安装" }).first().click();
    await page.waitForTimeout(3000);
    const served = pluginJs.filter((p) => p.status === 200);
    console.log("PLUGIN_JS_SERVED:", JSON.stringify(served));
    const installedToast = await page.locator("text=/已安装/").count();
    console.log("INSTALL_TOAST:", installedToast > 0);
    const afterInstall = await page.getByRole("button", { name: "安装" }).count();
    console.log("INSTALL_BUTTONS_AFTER:", afterInstall, "(应比安装前少 1)");
    await page.screenshot({ path: "/tmp/plugin-registry.png" });
}

console.log("ERRORS:", JSON.stringify(errors.slice(0, 3)));
const pass = Boolean(hit) && hit.status === 200 && listed.length === EXPECT_PLUGINS.length && installCount === EXPECT_PLUGINS.length && pluginJs.some((p) => p.status === 200) && errors.length === 0;
console.log(pass ? "PLUGIN_REGISTRY_PASS" : "PLUGIN_REGISTRY_FAIL");
await browser.close();
