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
  const node = (id, title, x) => ({ id, type: 'image', title, position: { x, y: 80 }, width: 320, height: 240, metadata: { status: 'success', generationMode: 'image' } });
  const project = {
    id: 'e2e-snap', title: '吸附验收', createdAt: '', updatedAt: '',
    nodes: [node('s1', '镜头 1', 80), node('s2', '镜头 2', 460), node('s3', '镜头 3', 840)],
    connections: [], chatSessions: [], activeChatId: null, backgroundMode: 'dots', showImageInfo: false, viewport: { x: 0, y: 0, k: 1 },
    timeline: { fps: 24, tracks: [{ id: 'vt', kind: 'video', clips: [
      { id: 'c1', nodeId: 's1', startTick: 0, durationTick: 4 * tps, sourceStartTick: 0 },
      { id: 'c2', nodeId: 's2', startTick: 4 * tps, durationTick: 3 * tps, sourceStartTick: 0 },
      { id: 'c3', nodeId: 's3', startTick: 9 * tps, durationTick: 2 * tps, sourceStartTick: 0 },
    ] }] },
  };
  const raw = JSON.stringify({ state: { projects: [project], deletedProjects: [] }, version: 0, metadata: { formatVersion: 1, revision: 1 } });
  return new Promise((resolve) => {
    const req = indexedDB.open('infinite-canvas');
    req.onsuccess = () => { const db = req.result; const tx = db.transaction('app_state', 'readwrite'); tx.objectStore('app_state').put(raw, 'infinite-canvas:canvas_store'); tx.oncomplete = () => { db.close(); resolve(); }; };
  });
}, TPS);
await page.goto('http://127.0.0.1:3010/canvas/e2e-snap', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);
await page.getByLabel('打开画布菜单').click();
await page.waitForTimeout(200);
await page.getByRole('menuitem', { name: '时间线' }).click();
await page.waitForTimeout(600);

const dialog = page.locator('section[aria-label="时间线"]');
const clip3 = dialog.locator('[aria-label="拖动镜头：镜头 3"]');
console.log('C3_LEFT_BEFORE:', await clip3.evaluate((e) => e.style.left)); // 9s*48=432px
const box = await clip3.boundingBox();
if (box) {
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  // 从 9s 拖到 7.1s：左移 1.9s = 91.2px。7.1s 距边缘 7s 仅 0.1s < 0.25s 阈值，应吸附到 7s
  const dx = -91.2;
  await page.evaluate(({ cx, cy }) => {
    document.querySelector('[aria-label="拖动镜头：镜头 3"]')
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy }));
  }, { cx, cy });
  await page.waitForTimeout(120);
  for (let step = 1; step <= 16; step++) {
    await page.evaluate(({ cx, cy, step, dx }) => {
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: cx + dx * step / 16, clientY: cy }));
    }, { cx, cy, step, dx });
    await page.waitForTimeout(12);
  }
  await page.evaluate(({ cx, cy, dx }) => {
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: cx + dx, clientY: cy }));
  }, { cx, cy, dx });
  await page.waitForTimeout(600);
}
const leftAfter = await clip3.evaluate((e) => e.style.left);
console.log('C3_LEFT_AFTER:', leftAfter, '(期望 336px = 7s*48, 紧贴镜头2 末尾 7s)');
const persisted = await page.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open('infinite-canvas');
  req.onsuccess = () => {
    const db = req.result;
    const r = db.transaction('app_state', 'readonly').objectStore('app_state').get('infinite-canvas:canvas_store');
    r.onsuccess = () => {
      const p = JSON.parse(r.result).state.projects.find((x) => x.id === 'e2e-snap');
      resolve(p.timeline.tracks[0].clips.map((c) => ({ id: c.id, start: c.startTick / 120000 })));
      db.close();
    };
  };
}));
console.log('PERSISTED:', JSON.stringify(persisted));
await page.screenshot({ path: OUT + '/snap_edges.png' });
console.log('ERRORS:', JSON.stringify(errors.slice(0, 5)));
await browser.close();
