import { chromium } from 'playwright';

const TPS = 120000;
const browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push('CONSOLE: ' + m.text()); });

// 版本检查读的 VERSION 在本仓库转公开前必然 404（仓库是 private），属已知外部条件，不算回归。
// 只豁免这一条精确 URL，其它 404 仍然算失败。
const RAW_GITHUB_PRIVATE = 'https://raw.githubusercontent.com/Supenman/INTX/';
page.on('requestfailed', (r) => { if (!r.url().startsWith(RAW_GITHUB_PRIVATE)) errors.push('REQFAIL: ' + r.url()); });
page.on('response', (r) => { if (r.status() >= 400 && !r.url().startsWith(RAW_GITHUB_PRIVATE)) errors.push('HTTP' + r.status() + ': ' + r.url()); });

await page.goto('http://127.0.0.1:3010/canvas', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(500);
await page.evaluate(() => {
  const node = (id, type, title, x, extra = {}) => ({ id, type, title, position: { x, y: 120 }, width: 320, height: 240, metadata: { status: 'success', ...extra } });
  const project = {
    id: 'e2e-ctx', title: '右键菜单验收', createdAt: '', updatedAt: '',
    nodes: [
      node('img', 'image', '图片节点', 120, { content: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9kAAAAASUVORK5CYII=' }),
      node('txt', 'text', '文本节点', 520, { content: 'HI' }),
    ],
    connections: [], chatSessions: [], activeChatId: null, backgroundMode: 'dots', showImageInfo: false, viewport: { x: 0, y: 0, k: 1 },
    timeline: { fps: 24, tracks: [] },
  };
  const raw = JSON.stringify({ state: { projects: [project], deletedProjects: [] }, version: 0, metadata: { formatVersion: 1, revision: 1 } });
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('infinite-canvas');
    req.onerror = () => reject('open failed');
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('app_state', 'readwrite');
      tx.objectStore('app_state').put(raw, 'infinite-canvas:canvas_store');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject('put failed');
    };
  });
});
await page.goto('http://127.0.0.1:3010/canvas/e2e-ctx', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);

// 右键图片节点
const imgNode = page.locator('[data-node-id="img"]').first();
await imgNode.click({ button: 'right' });
await page.waitForTimeout(400);

const menuButtons = page.locator('div.fixed.z-\\[80\\] button');
const labels = await menuButtons.allTextContents();
console.log('IMAGE_MENU_LABELS:', JSON.stringify(labels));

// 图片节点：应只有 复制 / 删除（无截帧、无提取音频、无分组）
const imageOk = labels.length === 2 && labels.some((l) => l.includes('复制')) && labels.some((l) => l.includes('删除'));
console.log('IMAGE_MENU_OK:', imageOk);

// 点「复制」应生成新节点
await menuButtons.filter({ hasText: '复制' }).first().click();
await page.waitForTimeout(500);
const nodeCount = await page.locator('[data-node-id]').count();
console.log('NODE_COUNT_AFTER_DUPLICATE:', nodeCount);

// 右键文本节点，点删除
await page.locator('[data-node-id="txt"]').first().click({ button: 'right' });
await page.waitForTimeout(300);
const txtLabels = await page.locator('div.fixed.z-\\[80\\] button').allTextContents();
console.log('TEXT_MENU_LABELS:', JSON.stringify(txtLabels));
await page.locator('div.fixed.z-\\[80\\] button').filter({ hasText: '删除' }).first().click();
await page.waitForTimeout(400);
const afterDelete = await page.locator('[data-node-id="txt"]').count();
console.log('TEXT_NODE_REMAIN_AFTER_DELETE:', afterDelete);

const pass = imageOk && nodeCount >= 3 && afterDelete === 0 && errors.length === 0;
console.log('CTX_MENU_' + (pass ? 'PASS' : 'FAIL'));
console.log('ERRORS_TOTAL:', errors.length, errors.slice(0, 3));
await browser.close();
process.exit(pass ? 0 : 1);
