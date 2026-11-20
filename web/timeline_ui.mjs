import { chromium } from 'playwright';

const OUT = '/root/.codebuddy/artifact/2f8a7d30-9c21-4f0b-1d6b-eb5a2a90b000/probe';
const TPS = 120000;

const browser = await chromium.launch({
  headless: true, executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

function summarize(errors) {
  const hydration = errors.filter((e) => /cannot be a descendant|cannot appear as a child|hydrat/i.test(e));
  return { hydrationCount: hydration.length, total: errors.length, sample: errors.slice(0, 4) };
}

await page.goto('http://127.0.0.1:3010/canvas', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(600);

const inject = await page.evaluate((tps) => {
  const node = (id, title, type, x, y) => ({
    id, type, title, position: { x, y }, width: 320, height: 240,
    metadata: { status: 'success', generationMode: type },
  });
  const project = {
    id: 'e2e-timeline', title: '时间线 E2E', createdAt: '2026-11-20', updatedAt: '2026-11-20',
    nodes: [
      node('shot1', '镜头 1', 'image', 80, 80),
      node('shot2', '镜头 2', 'image', 460, 80),
      node('shot3', '镜头 3', 'image', 840, 80),
      node('narration', '旁白', 'audio', 80, 400),
    ],
    connections: [], chatSessions: [], activeChatId: null,
    backgroundMode: 'dots', showImageInfo: false, viewport: { x: 0, y: 0, k: 1 },
    timeline: {
      fps: 24,
      tracks: [
        { id: 'vt', kind: 'video', clips: [
          { id: 'c1', nodeId: 'shot1', startTick: 0, durationTick: 2 * tps, sourceStartTick: 0 },
          { id: 'c2', nodeId: 'shot2', startTick: 4 * tps, durationTick: 3 * tps, sourceStartTick: 0 },
          { id: 'c3', nodeId: 'shot3', startTick: 9 * tps, durationTick: 2 * tps, sourceStartTick: 0 },
        ] },
        { id: 'at', kind: 'audio', clips: [
          { id: 'c4', nodeId: 'narration', startTick: 0, durationTick: 6 * tps, sourceStartTick: 0, volume: 1 },
        ] },
      ],
    },
  };
  const snapshot = { projects: [project], deletedProjects: [] };
  const raw = JSON.stringify({ state: snapshot, version: 0, metadata: { formatVersion: 1, revision: 1 } });
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('infinite-canvas');
    req.onerror = () => reject('indexedDB.open failed');
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('app_state')) { db.close(); reject('no app_state store'); return; }
      const tx = db.transaction('app_state', 'readwrite');
      tx.objectStore('app_state').put(raw, 'infinite-canvas:canvas_store');
      tx.oncomplete = () => { db.close(); resolve('written'); };
      tx.onerror = () => reject('put failed');
    };
  });
}, TPS);
console.log('INJECT:', inject);

await page.goto('http://127.0.0.1:3010/canvas/e2e-timeline', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1000);

const badges = await page.locator('[data-sequence-index]').evaluateAll((els) =>
  els.map((e) => ({ idx: e.getAttribute('data-sequence-index'), title: e.getAttribute('title') })));
console.log('BADGES:', JSON.stringify(badges));

await page.getByLabel('打开画布菜单').click();
await page.waitForTimeout(250);
await page.getByRole('menuitem', { name: '时间线' }).click();
await page.waitForTimeout(700);

const dialog = page.locator('section[aria-label="时间线"]');
console.log('DIALOG_COUNT:', await dialog.count());

// 读取视频轨 3 个 clip 的 left / width，验证绝对定位与空档
const clips = await dialog.locator('[aria-label^="拖动镜头："]').evaluateAll((els) =>
  els.map((e) => ({ label: e.getAttribute('aria-label'), left: e.style.left, width: e.style.width })));
console.log('VIDEO_CLIPS:', JSON.stringify(clips));
// 48 px/s 下：镜头1 left=0(0s)、镜头2 left=192(4s)、镜头3 left=432(9s)

// 拖动镜头2：从 4s 拖到 2.5s（左移 72px）。需在 down 后留时间给 React 挂载 pointermove effect。
const before = clips[1]?.left;
const clip2 = dialog.locator('[aria-label="拖动镜头：镜头 2"]');
const box = await clip2.boundingBox();
if (box) {
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.evaluate(({ cx, cy }) => {
    document.querySelector('[aria-label="拖动镜头：镜头 2"]')
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy }));
  }, { cx, cy });
  await page.waitForTimeout(120);
  for (let step = 1; step <= 10; step++) {
    await page.evaluate(({ cx, cy, step }) => {
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: cx - step * 7.2, clientY: cy }));
    }, { cx, cy, step });
    await page.waitForTimeout(15);
  }
  await page.evaluate(({ cx, cy }) => {
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: cx - 72, clientY: cy }));
  }, { cx, cy });
  await page.waitForTimeout(400);
}
const after = await dialog.locator('[aria-label="拖动镜头：镜头 2"]').evaluate((e) => e.style.left);
console.log('DRAG_CLIP2_LEFT:', before, '->', after, before !== after ? 'CHANGED_OK' : 'UNCHANGED_FAIL');

// 从 IndexedDB 读回持久化后的 timeline（等待写队列 flush）
await page.waitForTimeout(800);
const persisted = await page.evaluate(() => new Promise((resolve, reject) => {
  const req = indexedDB.open('infinite-canvas');
  req.onerror = () => reject('open failed');
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction('app_state', 'readonly');
    const r = tx.objectStore('app_state').get('infinite-canvas:canvas_store');
    r.onsuccess = () => {
      const state = JSON.parse(r.result).state.projects.find((p) => p.id === 'e2e-timeline');
      resolve(state.timeline.tracks.find((t) => t.kind === 'video').clips.map((c) => ({ id: c.id, startSec: c.startTick / 120000 })));
      db.close();
    };
    r.onerror = () => reject('get failed');
  };
}));
console.log('PERSISTED_VIDEO_CLIPS:', JSON.stringify(persisted));

await page.screenshot({ path: OUT + '/timeline_full.png' });
console.log('ERRORS:', JSON.stringify(summarize(errors)));
await browser.close();
