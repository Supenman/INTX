/**
 * 批量导出端到端检查：真上传两张图 → Ctrl+A 全选 → 点「批量下载」→ 接住下载 →
 * 解开 zip 核对文件名与顺序。
 *
 * 只验浏览器通道（file-saver），桌面「另存为」那一段靠真机，这里碰不到。
 * 该证明的是：按钮出现在多选浮栏、选区顺序按画布坐标、命名是 `01_标题.png`、
 * 包里确实是图片字节而不是 0 字节空壳。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { unzipSync } from "fflate";
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://127.0.0.1:3000";
const IMG_DIR = "/tmp/batch-export-imgs";

// 两张不同尺寸的合法 PNG：文件大小不同，能证明装进去的是各自真实字节
if (!existsSync(`${IMG_DIR}/封面.png`) || !existsSync(`${IMG_DIR}/内页.png`)) {
    mkdirSync(IMG_DIR, { recursive: true });
    // 1x1 与 2x2 的合法 PNG（固定字节，无需图像库）
    const oneByOne = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const twoByTwo = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M9Qz8DAwMDAwMDAAAAbBQMBnQ2mQwAAAABJRU5ErkJggg==";
    writeFileSync(`${IMG_DIR}/封面.png`, Buffer.from(oneByOne, "base64"));
    writeFileSync(`${IMG_DIR}/内页.png`, Buffer.from(twoByTwo, "base64"));
}

const browser = await chromium.launch({ headless: true, executablePath: "/usr/bin/chromium", args: ["--no-sandbox", "--disable-gpu"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) errors.push(message.text());
});

await page.goto(`${BASE}/canvas`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

const existing = page.locator("[data-canvas-id], [data-testid=canvas-card]").first();
const create = page.getByRole("button", { name: "新建画布" }).first();
if (await existing.count()) await existing.click();
else if (await create.count()) {
    await create.click();
    await page.waitForTimeout(800);
    const confirm = page.getByRole("button", { name: /新建|确定|创建/ }).last();
    if (await confirm.count()) await confirm.click();
}
await page.waitForTimeout(2500);

const fileInput = page.locator('input[type="file"][multiple][accept*="image"]').first();
if (!(await fileInput.count())) {
    console.log("NO_FILE_INPUT", page.url());
    console.log((await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 200));
    await browser.close();
    process.exit(0);
}

const before = await page.locator("[data-node-id]").count();
await fileInput.setInputFiles([`${IMG_DIR}/封面.png`, `${IMG_DIR}/内页.png`]);
await page.waitForFunction((n) => document.querySelectorAll("[data-node-id]").length >= n + 2, before, { timeout: 30000 });
await page.waitForTimeout(1500);

const nodeCount = await page.locator("[data-node-id]").count();
// 点画布空白处把焦点交回画布，再全选
await page.mouse.click(1000, 820);
await page.waitForTimeout(300);
await page.keyboard.press("Control+a");
await page.waitForTimeout(600);

const button = page.locator('button[aria-label^="批量下载"]').first();
const buttonVisible = await button.count();
console.log("NODES:", nodeCount);
console.log("BUTTON:", buttonVisible ? await button.getAttribute("aria-label") : "NOT_FOUND");
if (!buttonVisible) {
    await page.screenshot({ path: "/tmp/batch-export-missing.png" });
    await browser.close();
    process.exit(0);
}

await page.screenshot({ path: "/tmp/batch-export-toolbar.png" });
const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), button.click()]);
const zipPath = "/tmp/batch-export.zip";
await download.saveAs(zipPath);
const entries = Object.entries(unzipSync(new Uint8Array(readFileSync(zipPath))));
const names = entries.map(([name]) => name);
const sizes = Object.fromEntries(entries.map(([name, data]) => [name, data.byteLength]));

console.log("DOWNLOAD_NAME:", download.suggestedFilename());
console.log("ZIP_ENTRIES:", JSON.stringify(names));
console.log("ZIP_SIZES:", JSON.stringify(sizes));

const expected = ["01_封面.png", "02_内页.png"];
const namesOk = JSON.stringify(names) === JSON.stringify(expected);
const sizesOk = expected.every((name) => (sizes[name] ?? 0) > 0);
const zipNameOk = /^canvas-export-\d{8}-\d{4}\.zip$/.test(download.suggestedFilename());
// antd v6 的 notice 内容节点不再叫 .ant-message-notice-content，只能读整页文本
const toast = await (async () => {
    await page.waitForTimeout(1200);
    return await page.evaluate(() => {
        const text = document.body.innerText || "";
        const match = /已导出 \d+ 个文件/.exec(text);
        return { done: Boolean(match), matched: match?.[0] ?? "", noticeNodes: document.querySelectorAll(".ant-message-notice").length };
    });
})();
console.log("TOAST:", JSON.stringify(toast));
console.log("NAMES_OK:", namesOk);
console.log("SIZES_OK:", sizesOk);
console.log("ZIP_NAME_OK:", zipNameOk);
console.log("PAGE_ERRORS:", JSON.stringify(errors));

await browser.close();
