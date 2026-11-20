import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto('http://127.0.0.1:3010/canvas', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(500);
await page.evaluate(() => {
  const project = {
    id: 'e2e-create', title: '添加菜单验收', createdAt: '', updatedAt: '',
    nodes: [], connections: [], chatSessions: [], activeChatId: null, backgroundMode: 'dots', showImageInfo: false, viewport: { x: 0, y: 0, k: 1 },
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
await page.goto('http://127.0.0.1:3010/canvas/e2e-create', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);

// 双击画布空白处打开创建菜单
const canvas = page.locator('[data-canvas-surface], .relative.overflow-hidden').first();
await page.mouse.dblclick(700, 400);
await page.waitForTimeout(600);

const menu = page.locator('[data-canvas-no-zoom]').filter({ hasText: '选择节点' }).first();
const count = await menu.count();
console.log('CREATE_MENU_COUNT:', count);
const labels = count ? await menu.locator('button').allTextContents() : [];
console.log('CREATE_MENU_LABELS:', JSON.stringify(labels));

// 期望包含内置画布节点（图片/文本/视频/音频/组）
const hasImage = labels.some((l) => l.includes('图片'));
const hasText = labels.some((l) => l.includes('文本'));
const hasVideo = labels.some((l) => l.includes('视频'));
const hasAudio = labels.some((l) => l.includes('音频'));
console.log('HAS_CORE_NODES:', { hasImage, hasText, hasVideo, hasAudio });

// 点「文本」应创建文本节点
const textBtn = menu.locator('button').filter({ hasText: '文本' }).first();
if (await textBtn.count()) await textBtn.click();
await page.waitForTimeout(500);
const nodeAfter = await page.locator('[data-node-id]').count();
console.log('NODE_COUNT_AFTER_CREATE:', nodeAfter);

const pass = count === 1 && hasImage && hasText && hasVideo && hasAudio && nodeAfter >= 1 && errors.length === 0;
console.log('CREATE_MENU_' + (pass ? 'PASS' : 'FAIL'));
console.log('ERRORS_TOTAL:', errors.length, errors.slice(0, 3));
await browser.close();
process.exit(pass ? 0 : 1);
