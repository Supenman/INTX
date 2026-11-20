import { chromium } from 'playwright';

const TPS = 120000;
const OUT = '/root/.codebuddy/artifact/2f8a7d30-9c21-4f0b-1d6b-eb5a2a90b000/probe';
const browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

async function injectProject() {
  await page.evaluate((tps) => {
    const node = (id, title, x) => ({ id, type: 'image', title, position: { x, y: 80 }, width: 320, height: 240, metadata: { status: 'success', generationMode: 'image' } });
    const project = {
      id: 'e2e-undo', title: '时间线撤销验收', createdAt: '', updatedAt: '',
      nodes: [node('shot1', '镜头 1', 80), node('shot2', '镜头 2', 460), node('shot3', '镜头 3', 840)],
      connections: [], chatSessions: [], activeChatId: null, backgroundMode: 'dots', showImageInfo: false, viewport: { x: 0, y: 0, k: 1 },
      timeline: { fps: 24, tracks: [{ id: 'vt', kind: 'video', clips: [
        { id: 'c1', nodeId: 'shot1', startTick: 0, durationTick: 3 * tps, sourceStartTick: 0 },
        { id: 'c2', nodeId: 'shot2', startTick: 3 * tps, durationTick: 3 * tps, sourceStartTick: 0 },
        { id: 'c3', nodeId: 'shot3', startTick: 6 * tps, durationTick: 3 * tps, sourceStartTick: 0 },
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

const dialog = page.locator('section[aria-label="时间线"]');
const clipCount = () => dialog.locator('[aria-label^="拖动镜头："]').count();

async function openTimeline() {
  await page.getByLabel('打开画布菜单').click();
  await page.getByRole('menuitem', { name: '时间线' }).click();
  await page.waitForTimeout(350);
}

async function closeTimeline() {
  // 抽屉底部外点一下即可关闭（与菜单开关等价）。
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
}

// 1) 注入 + 加载
await page.goto('http://127.0.0.1:3010/canvas', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(500);
await injectProject();
await page.goto('http://127.0.0.1:3010/canvas/e2e-undo', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);

// 2) 打开时间线，确认 3 段
await openTimeline();
console.log('CLIPS_INITIAL:', await clipCount());

// 3) 移除第一段（可撤销编辑）
await dialog.locator('[aria-label="从时间线移除"]').first().click();
await page.waitForTimeout(500);
console.log('CLIPS_AFTER_REMOVE:', await clipCount());

// 4) 撤销：点工具栏撤销按钮（不关抽屉，工具栏不被遮挡）
const undoDisabled = await page.locator('button[aria-label="撤销"]').isDisabled();
console.log('UNDO_BTN_DISABLED_BEFORE:', undoDisabled);
await page.locator('button[aria-label="撤销"]').click();
await page.waitForTimeout(600);
console.log('CLIPS_AFTER_UNDO:', await clipCount());

// 5) 重做
const redoDisabled = await page.locator('button[aria-label="重做"]').isDisabled();
console.log('REDO_BTN_DISABLED_BEFORE:', redoDisabled);
await page.locator('button[aria-label="重做"]').click();
await page.waitForTimeout(600);
console.log('CLIPS_AFTER_REDO:', await clipCount());

// 6) 再撤销一次并刷新，确认持久化的是撤销后的状态
await page.locator('button[aria-label="撤销"]').click();
await page.waitForTimeout(800);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);
await openTimeline();
console.log('CLIPS_AFTER_UNDO_RELOAD:', await clipCount());

// 7) 拖动是每帧写入：撤销一次必须整段回退，证明 180ms debounce 把连续移动合并成一步
const shot = () => dialog.locator('[aria-label^="拖动镜头："]').first();
const box = await shot().boundingBox();
const leftBefore = await shot().evaluate((el) => el.style.left);
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.waitForTimeout(150);
for (const dx of [25, 50, 75, 100]) {
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2, { steps: 2 });
  await page.waitForTimeout(45);
}
await page.mouse.up();
await page.waitForTimeout(450);
const leftAfterDrag = await shot().evaluate((el) => el.style.left);
await page.locator('button[aria-label="撤销"]').click();
await page.waitForTimeout(600);
const leftAfterUndo = await dialog.locator('[aria-label^="拖动镜头："]').first().evaluate((el) => el.style.left);
console.log('DRAG_LEFT_BEFORE:', leftBefore);
console.log('DRAG_LEFT_AFTER:', leftAfterDrag);
console.log('DRAG_LEFT_AFTER_UNDO:', leftAfterUndo);
console.log('DRAG_UNDO_IS_SINGLE_STEP:', leftAfterUndo === leftBefore && leftAfterDrag !== leftBefore);

console.log('ERRORS_TOTAL:', errors.length);
errors.slice(0, 6).forEach((e) => console.log('  ' + e));
await page.screenshot({ path: OUT + '/undo_timeline.png' });
await browser.close();
