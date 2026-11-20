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

async function injectProject() {
  await page.evaluate((tps) => {
    const node = (id, title, x) => ({ id, type: 'image', title, position: { x, y: 80 }, width: 320, height: 240, metadata: { status: 'success', generationMode: 'image' } });
    const project = {
      id: 'e2e-p2', title: 'P2 切分验收', createdAt: '', updatedAt: '',
      nodes: [node('shot1', '镜头 1', 80), node('shot2', '镜头 2', 460), node('shot3', '镜头 3', 840)],
      connections: [], chatSessions: [], activeChatId: null, backgroundMode: 'dots', showImageInfo: false, viewport: { x: 0, y: 0, k: 1 },
      timeline: { fps: 24, tracks: [{ id: 'vt', kind: 'video', clips: [
        { id: 'c1', nodeId: 'shot1', startTick: 0, durationTick: 4 * tps, sourceStartTick: 0 },
        { id: 'c2', nodeId: 'shot2', startTick: 4 * tps, durationTick: 3 * tps, sourceStartTick: tps }, // 素材入点 1s
        { id: 'c3', nodeId: 'shot3', startTick: 9 * tps, durationTick: 2 * tps, sourceStartTick: 0 },
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
}
async function readVideoClips() {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('infinite-canvas');
    req.onsuccess = () => {
      const db = req.result;
      const r = db.transaction('app_state', 'readonly').objectStore('app_state').get('infinite-canvas:canvas_store');
      r.onsuccess = () => {
        const p = JSON.parse(r.result).state.projects.find((x) => x.id === 'e2e-p2');
        resolve(p.timeline.tracks.find((t) => t.kind === 'video').clips.map((c) => ({
          id: c.id, start: c.startTick / 120000, dur: c.durationTick / 120000, src: c.sourceStartTick / 120000,
        })));
        db.close();
      };
      r.onerror = () => reject('get failed');
    };
  }));
}

// 1) 注入 + 加载
await page.goto('http://127.0.0.1:3010/canvas', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(500);
await injectProject();
await page.goto('http://127.0.0.1:3010/canvas/e2e-p2', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);
await page.getByLabel('打开画布菜单').click();
await page.waitForTimeout(200);
await page.getByRole('menuitem', { name: '时间线' }).click();
await page.waitForTimeout(600);

const dialog = page.locator('section[aria-label="时间线"]');
console.log('CLIPS_BEFORE:', await dialog.locator('[aria-label^="拖动镜头："]').count());

// 2) 把播放头定位到 5s（镜头2 内部 4..7s）：点击刻度条
const ruler = dialog.locator('div.h-7.border-b').first();
const rulerBox = await ruler.boundingBox();
await page.mouse.click(rulerBox.x + 5 * 48, rulerBox.y + rulerBox.height / 2);
await page.waitForTimeout(200);
console.log('PLAYHEAD:', await dialog.locator('[role="slider"]').getAttribute('aria-valuetext'));

// 3) 点「在播放头处切分」
const splitBtn = dialog.getByLabel('在播放头处切分');
console.log('SPLIT_BTN_DISABLED:', await splitBtn.isDisabled());
await splitBtn.click();
await page.waitForTimeout(600);
console.log('CLIPS_AFTER_SPLIT:', await dialog.locator('[aria-label^="拖动镜头："]').count());
console.log('PERSISTED_AFTER_SPLIT:', JSON.stringify(await readVideoClips()));

// 4) trim：拖右段的入点把手向右 0.5s（24px），验证入点从 source 变化
const startHandle = dialog.locator('[aria-label="镜头 2 入点"]');
console.log('START_HANDLE_COUNT:', await startHandle.count());
// 右段入点把手是第二个（左段是「镜头 1 入点」，右段继承镜头2名字）
const rightStart = dialog.locator('[aria-label="镜头 2 入点"]').nth(1);
const hb = await rightStart.boundingBox();
if (hb) {
  const cx = hb.x + hb.width / 2, cy = hb.y + hb.height / 2;
  await page.evaluate(({ cx, cy }) => {
    document.querySelectorAll('[aria-label="镜头 2 入点"]')[1]
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy }));
  }, { cx, cy });
  await page.waitForTimeout(120);
  for (let step = 1; step <= 10; step++) {
    await page.evaluate(({ cx, cy, step }) => {
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: cx + step * 2.4, clientY: cy }));
    }, { cx, cy, step });
    await page.waitForTimeout(15);
  }
  await page.evaluate(({ cx, cy }) => {
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: cx + 24, clientY: cy }));
  }, { cx, cy });
  await page.waitForTimeout(600);
}
const afterTrim = await readVideoClips();
console.log('PERSISTED_AFTER_TRIM:', JSON.stringify(afterTrim));

// 5) 刷新页面，验证 split + trim 都保持
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);
await page.getByLabel('打开画布菜单').click();
await page.waitForTimeout(200);
await page.getByRole('menuitem', { name: '时间线' }).click();
await page.waitForTimeout(600);
console.log('CLIPS_AFTER_RELOAD:', await dialog.locator('[aria-label^="拖动镜头："]').count());
console.log('PERSISTED_AFTER_RELOAD:', JSON.stringify(await readVideoClips()));
await page.screenshot({ path: OUT + '/p2_split_trim.png' });
console.log('ERRORS:', JSON.stringify(errors.slice(0, 5)));
await browser.close();
