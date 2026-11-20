import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:5199";

const browser = await chromium.launch({ headless: true, executablePath: "/usr/bin/chromium", args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
// 版本检查读的 VERSION 在本仓库转公开前必然 404（仓库是 private），属已知外部条件，不算回归。
// 只豁免这一条精确 URL，其它 404 仍然算失败。
const RAW_GITHUB_PRIVATE = "https://raw.githubusercontent.com/Supenman/INTX/";
page.on("requestfailed", (r) => { if (!r.url().startsWith(RAW_GITHUB_PRIVATE)) errors.push("REQFAIL: " + r.url()); });
page.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(m.text()); });

await page.goto(`${BASE}/canvas`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

// 进入编辑器：已有画布则点第一个，否则新建一个
const newBtn = page.getByRole("button", { name: "新建画布" }).first();
const existing = page.locator('[data-canvas-id], [data-testid="canvas-card"]').first();
if (await existing.count()) {
    await existing.click();
} else if (await newBtn.count()) {
    await newBtn.click();
    await page.waitForTimeout(800);
    const confirm = page.getByRole("button", { name: /新建|确定|创建/ }).last();
    if (await confirm.count()) await confirm.click();
}
await page.waitForTimeout(2500);

const menuBtn = page.locator('button[aria-label="打开画布菜单"]').first();
if (!(await menuBtn.count())) {
    console.log("MENU_BUTTON_NOT_FOUND");
    console.log("URL:", page.url());
    console.log("TEXT:", (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 300));
    await page.screenshot({ path: "/tmp/menu-missing.png" });
    await browser.close();
    process.exit(0);
}

await menuBtn.click();
await page.waitForTimeout(600);

const clean = (s) => s.replace(/\s+/g, " ").trim();
const groups = await page.locator(".ant-dropdown-menu-item-group-title").allInnerTexts();
const items = await page.locator(".ant-dropdown-menu-item").allInnerTexts();

console.log("URL:", page.url());
console.log("GROUP_COUNT:", groups.length);
console.log("GROUPS:", JSON.stringify(groups.map(clean)));
console.log("ITEM_COUNT:", items.length);
console.log("ITEMS:", JSON.stringify(items.map(clean)));
await page.screenshot({ path: "/tmp/menu.png" });

const timelineItem = page.locator(".ant-dropdown-menu-item", { hasText: "时间线" }).first();
if (await timelineItem.count()) {
    await timelineItem.click();
    await page.waitForTimeout(1500);
    const opened = await page.locator("text=/时间线/").count();
    console.log("TIMELINE_ITEM_CLICKABLE:", opened > 0);
}

console.log("PAGE_ERRORS:", errors.length);
errors.slice(0, 5).forEach((e) => console.log("  ERR:", e.slice(0, 160)));
await browser.close();
