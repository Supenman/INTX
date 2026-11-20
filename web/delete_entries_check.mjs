/**
 * 删除入口收敛验收：4 处 → 3 处，且功能一个不丢。
 *
 * 要证明的不是「按钮少了」，而是「少了之后每条路径都还通」：
 *   - 悬浮栏不再有删除（砍掉的是误触风险最高、位置最挤的那个）
 *   - 右键菜单仍能删单个
 *   - 底部工具栏仍能删选中
 *   - Delete 键仍能删
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('requestfailed', (r) => { if (!r.url().startsWith('https://raw.githubusercontent.com/Supenman/INTX/')) errors.push('REQFAIL: ' + r.url()); });
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push('CONSOLE: ' + m.text());
});

async function injectProject() {
  await page.evaluate(() => {
    const node = (id, title, x) => ({ id, type: 'image', title, position: { x, y: 80 }, width: 320, height: 240, metadata: { status: 'success', generationMode: 'image' } });
    const project = {
      id: 'e2e-del', title: '删除入口验收', createdAt: '', updatedAt: '',
      nodes: [node('n1', '节点 1', 120), node('n2', '节点 2', 560), node('n3', '节点 3', 1000), node('n4', '节点 4', 1440)],
      connections: [], chatSessions: [], activeChatId: null, backgroundMode: 'dots', showImageInfo: false,
      viewport: { x: 0, y: 0, k: 0.7 }, timeline: { fps: 24, tracks: [] },
    };
    const raw = JSON.stringify({ state: { projects: [project], deletedProjects: [] }, version: 0, metadata: { formatVersion: 1, revision: 1 } });
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('infinite-canvas');
      req.onerror = () => reject('open failed');
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('app_state')) { db.close(); reject('no store'); return; }
        const tx = db.transaction('app_state', 'readwrite');
        tx.objectStore('app_state').put(raw, 'infinite-canvas:canvas_store');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject('put failed');
      };
    });
  });
}

const nodeCount = () => page.locator('[data-node-id]').count();
const firstBox = async () => page.locator('[data-node-id]').first().boundingBox();
const centerOf = (b) => ({ x: b.x + b.width / 2, y: b.y + 24 });

await page.goto('http://127.0.0.1:3010/canvas', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(600);
await injectProject();
await page.goto('http://127.0.0.1:3010/canvas/e2e-del', { waitUntil: 'domcontentloaded' });
await page.getByText('节点 1').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
await page.waitForTimeout(800);

const start = await nodeCount();
console.log('NODES_START:', start);

// ── 1. 悬浮栏：应当没有删除按钮，但仍有信息按钮 ──────────────
// 悬浮栏由「单选节点」驱动（project.tsx: toolbarNode = toolbarNodeId || singleSelectedNodeId），
// 不必依赖 mouseover，点一下选中即可稳定复现。
const b1 = await firstBox();
const c1 = centerOf(b1);
await page.mouse.click(c1.x, c1.y);
await page.waitForTimeout(800);
const infoBtn = page.locator('button[aria-label="查看节点信息"]');
const hoverVisible = (await infoBtn.count()) > 0;
let hoverLabels = [];
if (hoverVisible) {
  hoverLabels = await infoBtn.first().locator('xpath=..').locator('button[aria-label]').evaluateAll((ns) => ns.map((n) => n.getAttribute('aria-label')));
}
const hoverHasDelete = hoverLabels.some((l) => l && l.includes('移除节点'));
console.log('HOVER_VISIBLE:', hoverVisible);
console.log('HOVER_HAS_DELETE:', hoverHasDelete);
console.log('HOVER_HAS_INFO:', hoverLabels.some((l) => l && l.includes('信息')));

// ── 2. 右键菜单：仍能删单个 ──────────────────────────────────
await page.mouse.move(b1.x + b1.width / 2, b1.y + b1.height / 2);
await page.mouse.click(b1.x + b1.width / 2, b1.y + b1.height / 2, { button: 'right' });
await page.waitForTimeout(600);
const ctxDelete = page.getByText('删除', { exact: true }).first();
const ctxDeleteCount = await ctxDelete.count();
if (ctxDeleteCount) {
  await ctxDelete.click();
  await page.waitForTimeout(800);
}
const afterCtx = await nodeCount();
console.log('CTX_DELETE_VISIBLE:', ctxDeleteCount > 0);
console.log('NODES_AFTER_CTX_DELETE:', afterCtx, `(${start}→${afterCtx})`);

// ── 3. Delete 键：仍能删 ────────────────────────────────────
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const b2 = await firstBox();
const c2 = centerOf(b2);
await page.mouse.click(c2.x, c2.y);
await page.waitForTimeout(400);
const selectedForKeys = (await page.locator('button[aria-label="删除选中"]').count()) > 0;
await page.keyboard.press('Delete');
await page.waitForTimeout(800);
const afterKey = await nodeCount();
console.log('SELECTED_BEFORE_KEY_DELETE:', selectedForKeys);
console.log('NODES_AFTER_KEY_DELETE:', afterKey, `(${afterCtx}→${afterKey})`);

// ── 4. 底部工具栏：选中后仍能删 ─────────────────────────────
const b3 = await firstBox();
const c3 = centerOf(b3);
await page.mouse.click(c3.x, c3.y);
await page.waitForTimeout(500);
const toolbarDelete = page.locator('button[aria-label="删除选中"]');
const toolbarDeleteCount = await toolbarDelete.count();
const beforeToolbar = await nodeCount();
if (toolbarDeleteCount) {
  await toolbarDelete.first().click();
  await page.waitForTimeout(800);
}
const afterToolbar = await nodeCount();
console.log('TOOLBAR_DELETE_VISIBLE_WHEN_SELECTED:', toolbarDeleteCount > 0);
console.log('NODES_AFTER_TOOLBAR_DELETE:', afterToolbar, `(${beforeToolbar}→${afterToolbar})`);

console.log('ERRORS:', JSON.stringify(errors.slice(0, 5)));

const pass =
  start === 4 &&
  hoverVisible &&
  !hoverHasDelete &&
  ctxDeleteCount > 0 &&
  afterCtx === 3 &&
  selectedForKeys &&
  afterKey === 2 &&
  toolbarDeleteCount > 0 &&
  afterToolbar === 1 &&
  errors.length === 0;
console.log('DELETE_ENTRIES_' + (pass ? 'PASS' : 'FAIL'));
await page.screenshot({ path: '/tmp/delete-entries.png' });
await browser.close();
process.exit(pass ? 0 : 1);
