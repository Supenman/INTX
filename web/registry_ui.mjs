import { chromium } from 'playwright';

/**
 * 第七组 E2E：工具注册表接线后，多选 → 对齐 → 连线的真实 DOM 行为。
 * 断言只读 DOM 与可见行为，不读源码文字。
 */
const browser = await chromium.launch({
  headless: true, executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push('CONSOLE: ' + m.text()); });

// 版本检查读的 VERSION 在本仓库转公开前必然 404（仓库是 private），属已知外部条件，不算回归。
// 只豁免这一条精确 URL，其它 404 仍然算失败。
const RAW_GITHUB_PRIVATE = 'https://raw.githubusercontent.com/Supenman/INTX/';
page.on('requestfailed', (r) => { if (!r.url().startsWith(RAW_GITHUB_PRIVATE)) errors.push('REQFAIL: ' + r.url()); });
page.on('response', (r) => { if (r.status() >= 400 && !r.url().startsWith(RAW_GITHUB_PRIVATE)) errors.push('HTTP' + r.status() + ': ' + r.url()); });

const fail = (msg) => { console.error('FAIL:', msg); process.exitCode = 1; };
const ok = (cond, msg) => { console.log((cond ? 'PASS: ' : 'FAIL: ') + msg); if (!cond) process.exitCode = 1; };

await page.goto('http://127.0.0.1:3010/canvas', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(400);
await page.evaluate(() => {
  const node = (id, title, type, x, y) => ({ id, type, title, position: { x, y }, width: 220, height: 150, metadata: { status: 'success', prompt: '示例提示词' } });
  const project = {
    id: 'e2e-registry', title: '注册表 E2E', createdAt: '2026-11-20', updatedAt: '2026-11-20',
    nodes: [node('a', '节点甲', 'text', 120, 120), node('b', '节点乙', 'text', 520, 320)],
    connections: [], chatSessions: [], activeChatId: null,
    backgroundMode: 'dots', showImageInfo: false, viewport: { x: 0, y: 0, k: 1 },
  };
  const snapshot = { projects: [project], deletedProjects: [] };
  const raw = JSON.stringify({ state: snapshot, version: 0, metadata: { formatVersion: 1, revision: 1 } });
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('infinite-canvas');
    req.onerror = () => reject('open failed');
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('app_state', 'readwrite');
      tx.objectStore('app_state').put(raw, 'infinite-canvas:canvas_store');
      tx.oncomplete = () => { db.close(); resolve('ok'); };
      tx.onerror = () => reject('put failed');
    };
  });
});
await page.goto('http://127.0.0.1:3010/canvas/e2e-registry', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);

const transforms = () => page.locator('[data-node-id]').evaluateAll((els) =>
  Object.fromEntries(els.map((e) => [e.getAttribute('data-node-id'), e.style.transform])));

ok((await page.locator('[data-node-id]').count()) === 2, '注入两个节点并正确渲染');

// 多选：点第一个 + Shift 点第二个
await page.locator('[data-node-id="a"]').click({ position: { x: 10, y: 10 } });
await page.waitForTimeout(120);
await page.locator('[data-node-id="b"]').click({ position: { x: 10, y: 10 }, modifiers: ['Shift'] });
await page.waitForTimeout(200);

const alignCount = await page.locator('button[aria-label="左对齐"]').count();
ok(alignCount === 1, '多选后悬浮栏出现「左对齐」按钮');

// 注册表驱动：少于 3 个节点，等距按钮应禁用
const distributeDisabled = await page.locator('button[aria-label="水平等距"]').isDisabled();
ok(distributeDisabled === true, '两节点时「水平等距」禁用（注册表 disabled 判定生效）');

// 左对齐：b 的 x 应收敛到 a 的 x
const before = await transforms();
await page.locator('button[aria-label="左对齐"]').click();
await page.waitForTimeout(250);
const after = await transforms();
const xOf = (t) => Number((t.match(/translate\(([-\d.]+)px/) || [])[1]);
ok(xOf(after.a) === xOf(after.b), `左对齐后两节点 x 一致（${xOf(before.a)} / ${xOf(before.b)} → ${xOf(after.a)} / ${xOf(after.b)}）`);
ok(Number.isInteger(xOf(after.a)), '对齐结果落在整数坐标');

console.log('CONSOLE_ERRORS:', errors.length, errors.slice(0, 3).join(' | '));
ok(errors.length === 0, '无页面/控制台错误');
await browser.close();
