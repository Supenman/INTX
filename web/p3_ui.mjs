import { chromium } from 'playwright';

const OUT = '/root/.codebuddy/artifact/2f8a7d30-9c21-4f0b-1d6b-eb5a2a90b000/probe';
const TPS = 120000;

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

await page.goto('http://127.0.0.1:3010/canvas', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(600);

// 注入 3 镜头 + 空档的项目
await page.evaluate((tps) => {
  const node = (id, title, x) => ({
    id, type: 'image', title, position: { x, y: 80 }, width: 320, height: 240,
    metadata: { status: 'success' },
  });
  const project = {
    id: 'e2e-p3', title: 'P3 联动 E2E', createdAt: '2026-11-20', updatedAt: '2026-11-20',
    nodes: [node('shot1', '镜头 1', 80), node('shot2', '镜头 2', 460), node('shot3', '镜头 3', 840)],
    connections: [], chatSessions: [], activeChatId: null,
    backgroundMode: 'dots', showImageInfo: false, viewport: { x: 0, y: 0, k: 1 },
    timeline: { fps: 24, tracks: [{ id: 'video', kind: 'video', clips: [
      { id: 'c1', nodeId: 'shot1', startTick: 0, durationTick: 2 * tps, sourceStartTick: 0 },
      { id: 'c2', nodeId: 'shot2', startTick: 4 * tps, durationTick: 3 * tps, sourceStartTick: 0 },
      { id: 'c3', nodeId: 'shot3', startTick: 9 * tps, durationTick: 2 * tps, sourceStartTick: 0 },
    ] }] },
  };
  const snapshot = { projects: [project], deletedProjects: [] };
  const raw = JSON.stringify({ state: snapshot, version: 0, metadata: { formatVersion: 1, revision: 1 } });
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('infinite-canvas');
    req.onerror = () => reject('open failed');
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('app_state')) { db.close(); reject('no store'); return; }
      const tx = db.transaction('app_state', 'readwrite');
      tx.objectStore('app_state').put(raw, 'infinite-canvas:canvas_store');
      tx.oncomplete = () => { db.close(); resolve('written'); };
      tx.onerror = () => reject('put failed');
    };
  });
}, TPS);

await page.goto('http://127.0.0.1:3010/canvas/e2e-p3', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);

const activeNodes = () => page.locator('[data-node-id][data-timeline-active="true"]').evaluateAll(
  (els) => els.map((e) => e.getAttribute('data-node-id')));

console.log('BEFORE_OPEN_ACTIVE:', JSON.stringify(await activeNodes()));

await page.getByLabel('打开画布菜单').click();
await page.waitForTimeout(250);
await page.getByRole('menuitem', { name: '时间线' }).click();
await page.waitForTimeout(700);

const dialog = page.locator('section[aria-label="时间线"]');
// 刻度条：抽屉内第一个 .h-7 的时间轨道，点击定位播放头（seekTrack 读 clientX）
const ruler = dialog.locator('div.h-7').first();
const rulerBox = await ruler.boundingBox();
console.log('RULER_BOX:', JSON.stringify(rulerBox));

// 在指定秒点击刻度条定位播放头（48 px/s）
async function seek(seconds) {
  const box = await ruler.boundingBox();
  await page.mouse.click(box.x + seconds * 48 + 1, box.y + box.height / 2);
  await page.waitForTimeout(180);
  const label = await dialog.getByRole('slider').getAttribute('aria-valuetext');
  console.log(`SEEK ${seconds}s ->`, label, '| ACTIVE:', JSON.stringify(await activeNodes()));
}

// 镜头1(0-2s)、镜头2(4-7s)、镜头3(9-11s)、空档(3s)
await seek(1);
await seek(5);
await page.screenshot({ path: OUT + '/p3_linkage_active.png' });
await seek(10);
await seek(3);

await page.screenshot({ path: OUT + '/p3_linkage.png' });

// 关闭抽屉：高亮应清除
await dialog.getByRole('button', { name: '关闭时间线' }).click();
await page.waitForTimeout(400);
console.log('AFTER_CLOSE_ACTIVE:', JSON.stringify(await activeNodes()));

console.log('ERRORS_TOTAL:', errors.length, errors.slice(0, 3));
await browser.close();
