import { chromium } from 'playwright';
const TPS = 120000;
const OUT = '/root/.codebuddy/artifact/2f8a7d30-9c21-4f0b-1d6b-eb5a2a90b000/probe';
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
await page.evaluate((tps) => {
  const node = (id, type, title, x, extra = {}) => ({ id, type, title, position: { x, y: 80 }, width: 320, height: 240, metadata: { status: 'success', generationMode: type, ...extra } });
  const project = {
    id: 'e2e-text', title: '文字轨验收', createdAt: '', updatedAt: '',
    nodes: [
      node('s1', 'image', '镜头 1', 80),
      node('txt', 'text', '片头字幕', 460, { content: '第一幕 · 开场' }),
    ],
    connections: [], chatSessions: [], activeChatId: null, backgroundMode: 'dots', showImageInfo: false, viewport: { x: 0, y: 0, k: 1 },
    timeline: { fps: 24, tracks: [{ id: 'vt', kind: 'video', clips: [
      { id: 'c1', nodeId: 's1', startTick: 0, durationTick: 6 * tps, sourceStartTick: 0 },
    ] }] },
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
}, TPS);
await page.goto('http://127.0.0.1:3010/canvas/e2e-text', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);
await page.getByLabel('打开画布菜单').click();
await page.waitForTimeout(200);
await page.getByRole('menuitem', { name: '时间线' }).click();
await page.waitForTimeout(600);

const dialog = page.locator('section[aria-label="时间线"]');
const addSelect = dialog.getByLabel('添加字幕');
console.log('ADD_SELECT_COUNT:', await addSelect.count());
console.log('TEXT_TRACK_LABEL:', await dialog.getByText('字幕', { exact: true }).count());

// 用下拉添加「片头字幕」
await addSelect.click();
await page.waitForTimeout(300);
console.log('OPTIONS:', JSON.stringify(await page.locator('.ant-select-item-option').allTextContents()));
const opt = page.locator('.ant-select-item-option').filter({ hasText: '片头字幕' }).first();
console.log('OPT_COUNT:', await opt.count());
if (await opt.count()) await opt.click();
await page.waitForTimeout(500);

const textClips = dialog.locator('div.bg-amber-700');
console.log('TEXT_CLIPS_AFTER_ADD:', await textClips.count());
console.log('TEXT_CLIP_LABEL:', await textClips.first().innerText());

// 持久化读回
const persisted = await page.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open('infinite-canvas');
  req.onsuccess = () => {
    const db = req.result;
    const r = db.transaction('app_state', 'readonly').objectStore('app_state').get('infinite-canvas:canvas_store');
    r.onsuccess = () => {
      const p = JSON.parse(r.result).state.projects.find((x) => x.id === 'e2e-text');
      const text = p.timeline.tracks.find((t) => t.kind === 'text');
      resolve(text ? text.clips.map((c) => ({ id: c.id, nodeId: c.nodeId, start: c.startTick / 120000, dur: c.durationTick / 120000 })) : null);
      db.close();
    };
  };
}));
console.log('PERSISTED_TEXT_TRACK:', JSON.stringify(persisted));

// 刷新验证
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);
await page.getByLabel('打开画布菜单').click();
await page.waitForTimeout(200);
await page.getByRole('menuitem', { name: '时间线' }).click();
await page.waitForTimeout(600);
console.log('TEXT_CLIPS_AFTER_RELOAD:', await page.locator('section[aria-label="时间线"] div.bg-amber-700').count());
await page.screenshot({ path: OUT + '/text_track.png' });
console.log('ERRORS:', JSON.stringify(errors.slice(0, 5)));
await browser.close();
