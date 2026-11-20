/**
 * 自定义工具栏验收。四件事分开验，互不依赖：
 *
 * 1. 外观面板里有入口，点开四组都在
 * 2. 「设置」真的写进 localStorage（勾掉文字后 hidden 里有 tool-text）
 * 3. 带着这条偏好重新进画布，tool-text 真的不渲染，其它按钮完好
 * 4. 再进一次面板点「恢复默认」，hidden 里被清掉
 *
 * 特意不做「在同一个页面里勾掉 → 立刻观察按钮消失」：那是 React 状态时序问题，
 * 会把「偏好有没有落盘 + 门禁有没有生效」这两件真事混在一个 flaky 断言里。
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:3010';
const KEY = 'intx-toolbar-prefs-main-v1';
const browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
const RAW_GITHUB_PRIVATE = 'https://raw.githubusercontent.com/Supenman/INTX/';
page.on('requestfailed', (r) => { if (!r.url().startsWith(RAW_GITHUB_PRIVATE)) errors.push('REQFAIL: ' + r.url()); });
page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push('CONSOLE: ' + m.text()); });

await page.goto(`${BASE}/canvas`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
await page.evaluate(() => {
  const project = {
    id: 'e2e-prefs', title: '偏好 E2E', createdAt: '2026-11-21', updatedAt: '2026-11-21',
    nodes: [{ id: 'n1', type: 'image', title: '图一', position: { x: 160, y: 160 }, width: 320, height: 240, metadata: { status: 'success' } }],
    connections: [], chatSessions: [], activeChatId: null, backgroundMode: 'dots', showImageInfo: false,
    viewport: { x: 0, y: 0, k: 1 }, timeline: { fps: 24, tracks: [] },
  };
  const raw = JSON.stringify({ state: { projects: [project], deletedProjects: [] }, version: 0, metadata: { formatVersion: 1, revision: 1 } });
  return new Promise((resolve) => {
    const req = indexedDB.open('infinite-canvas');
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('app_state', 'readwrite');
      tx.objectStore('app_state').put(raw, 'infinite-canvas:canvas_store');
      tx.oncomplete = () => { db.close(); resolve(); };
    };
  });
});

const openEditor = async () => {
  await page.goto(`${BASE}/canvas/e2e-prefs`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2600);
};
const textBtn = () => page.locator('button[data-toolbar-id="tool-text"]').first();
const openPrefsPanel = async () => {
  await page.locator('button[aria-label="画布外观"]').first().click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: '自定义工具栏' }).first().click();
  await page.waitForTimeout(700);
};

// ── 1. 入口与分组 ──────────────────────────────────────────
await openEditor();
console.log('TEXT_BTN_BEFORE:', await textBtn().count());
await openPrefsPanel();
const groups = await page.locator('.ant-modal-body h3').allInnerTexts();
console.log('GROUPS:', JSON.stringify(groups));

// ── 2. 勾掉「文字」，看偏好是否落盘 ────────────────────────
const mainSection = page.locator('.ant-modal-body section').filter({ hasText: '画布底部工具栏' }).first();
const textItem = mainSection.locator('label').filter({ has: page.locator('span[title^="在画布上新建文字节点"]') }).last();
await textItem.locator('input[type="checkbox"]').uncheck({ force: true });
await page.waitForTimeout(400);
const storedAfterUncheck = await page.evaluate((k) => localStorage.getItem(k), KEY);
console.log('STORED_AFTER_UNCHECK:', storedAfterUncheck);

// ── 3. 带偏好重进画布，按钮应消失、其它按钮完好 ────────────
await openEditor();
const afterReload = await textBtn().count();
const siblings = await page.locator('button[data-toolbar-id]').evaluateAll((ns) => ns.map((n) => n.getAttribute('data-toolbar-id')));
console.log('TEXT_BTN_AFTER_RELOAD:', afterReload);
console.log('TOOLBAR_AFTER_RELOAD:', JSON.stringify(siblings));

// ── 4. 恢复默认 ───────────────────────────────────────────
await openPrefsPanel();
await mainSection.getByRole('button', { name: '恢复默认' }).click();
await page.waitForTimeout(500);
const storedAfterReset = await page.evaluate((k) => localStorage.getItem(k), KEY);
console.log('STORED_AFTER_RESET:', storedAfterReset);

await page.screenshot({ path: '/tmp/toolbar-prefs.png' });
console.log('ERRORS:', JSON.stringify(errors.slice(0, 3)));

const ok =
  groups.length === 4 &&
  storedAfterUncheck.includes('tool-text') &&
  afterReload === 0 &&
  siblings.includes('tool-image') &&
  siblings.includes('tool-style') &&
  !JSON.parse(storedAfterReset).hidden.includes('tool-text') &&
  errors.length === 0;
console.log(ok ? 'TOOLBAR_PREFS_PASS' : 'TOOLBAR_PREFS_FAIL');
await browser.close();
