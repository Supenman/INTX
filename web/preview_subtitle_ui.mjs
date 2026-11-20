import { chromium } from 'playwright';

const TPS = 120000;
const browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto('http://127.0.0.1:3010/canvas', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(500);
await page.evaluate((tps) => {
  // 纯黑底图，预览窗恒定有画面，字幕层叠在其上。
  const node = (id, type, title, x, extra = {}) => ({ id, type, title, position: { x, y: 80 }, width: 320, height: 240, metadata: { status: 'success', generationMode: type, ...extra } });
  const project = {
    id: 'e2e-preview-sub', title: '预览字幕验收', createdAt: '', updatedAt: '',
    nodes: [
      node('bg', 'image', '黑底', 80, { content: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9kAAAAASUVORK5CYII=' }),
      node('t1', 'text', '字幕A', 460, { content: 'HELLO' }),
      node('t2', 'text', '字幕B', 840, { content: 'WORLD' }),
    ],
    connections: [], chatSessions: [], activeChatId: null, backgroundMode: 'dots', showImageInfo: false, viewport: { x: 0, y: 0, k: 1 },
    timeline: { fps: 24, tracks: [
      { id: 'vt', kind: 'video', clips: [{ id: 'cv', nodeId: 'bg', startTick: 0, durationTick: 6 * tps, sourceStartTick: 0 }] },
      { id: 'tt', kind: 'text', clips: [
        { id: 'ta', nodeId: 't1', startTick: 1 * tps, durationTick: 2 * tps, sourceStartTick: 0 },
        { id: 'tb', nodeId: 't2', startTick: 4 * tps, durationTick: 2 * tps, sourceStartTick: 0 },
      ] },
    ] },
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
}, TPS);
await page.goto('http://127.0.0.1:3010/canvas/e2e-preview-sub', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);
await page.getByLabel('打开画布菜单').click();
await page.waitForTimeout(200);
await page.getByRole('menuitem', { name: '时间线' }).click();
await page.waitForTimeout(600);

const dialog = page.locator('section[aria-label="时间线"]');
console.log('DIALOG_COUNT:', await dialog.count());

// 时间标尺：容器里第一条 relative h-7 border-b 的 div。
const ruler = dialog.locator('div.relative.h-7').first();
const box = await ruler.boundingBox();
console.log('RULER_BOX:', JSON.stringify(box));

// pixelsPerSecond 默认 48，标尺左边缘为 0s。
async function subtitlesAt(sec) {
  if (!box) return null;
  await page.mouse.click(box.x + sec * 48 + 1, box.y + box.height / 2);
  await page.waitForTimeout(180);
  const layer = dialog.locator('[aria-label="preview-subtitles"]');
  if (await layer.count() === 0) return [];
  return await layer.locator('span').allTextContents();
}

const results = {};
results['0.5s'] = await subtitlesAt(0.5);   // 空档：无字幕
results['2s']   = await subtitlesAt(2);     // HELLO
results['3.5s'] = await subtitlesAt(3.5);   // 空档：无字幕
results['5s']   = await subtitlesAt(5);     // WORLD
console.log('SUBTITLES:', JSON.stringify(results));

const pass =
  Array.isArray(results['0.5s']) && results['0.5s'].length === 0 &&
  JSON.stringify(results['2s']) === JSON.stringify(['HELLO']) &&
  Array.isArray(results['3.5s']) && results['3.5s'].length === 0 &&
  JSON.stringify(results['5s']) === JSON.stringify(['WORLD']);
console.log('PREVIEW_SUBTITLE_' + (pass ? 'PASS' : 'FAIL'));
console.log('ERRORS_TOTAL:', errors.length, errors.slice(0, 3));
await browser.close();
process.exit(pass && errors.length === 0 ? 0 : 1);
