/**
 * 主题切换器健壮性回归（对齐 BeefTV 上游三个坑）：
 *  1. 快速连点不被并发锁卡在中间态；
 *  2. 结束态 DOM 的 dark class / colorScheme / 图标三者一致；
 *  3. reduced-motion 偏好下直接切换，不跑 ViewTransition 动画。
 * 用假数据注入画布，不发真实请求。
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-gpu'] });
const errors = [];

async function injectProject(page) {
  const node = (id, type, title, x, y, extra = {}) => ({
    id, type, title, position: { x, y }, width: 320, height: 240,
    metadata: { status: 'success', generationMode: 'image', ...extra },
  });
  const filled = {
    id: 'tt-1', title: '主题切换验证', createdAt: '2026-11-21', updatedAt: '2026-11-21',
    nodes: [node('a', 'image', '开场', 120, 100)], connections: [], chatSessions: [], activeChatId: null,
    backgroundMode: 'dots', showImageInfo: false, viewport: { x: 0, y: 0, k: 1 },
    timeline: { fps: 24, tracks: [] },
  };
  const raw = JSON.stringify({ state: { projects: [filled], deletedProjects: [] }, version: 0, metadata: { formatVersion: 1, revision: 1 } });
  // 等 IndexedDB 建好再注入；用 page.waitForFunction 轮询，避免 evaluate 的 Promise 被 GC。
  await page.waitForFunction(() => indexedDB.databases ? true : true, null, { timeout: 5000 }).catch(() => {});
  await page.evaluate(async (raw) => {
    const open = () => new Promise((resolve, reject) => {
      const req = indexedDB.open('infinite-canvas');
      req.onerror = () => reject('open');
      req.onsuccess = () => resolve(req.result);
    });
    let db = await open();
    // 确保 objectStore 存在
    if (!db.objectStoreNames.contains('app_state')) {
      const v = db.version + 1;
      db.close();
      const up = indexedDB.open('infinite-canvas', v);
      await new Promise((resolve, reject) => {
        up.onupgradeneeded = () => { if (!up.result.objectStoreNames.contains('app_state')) up.result.createObjectStore('app_state'); };
        up.onsuccess = () => resolve();
        up.onerror = () => reject('upgrade');
      });
      db = up.result;
    }
    await new Promise((resolve, reject) => {
      const tx = db.transaction('app_state', 'readwrite');
      tx.objectStore('app_state').put(raw, 'infinite-canvas:canvas_store');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject('put');
    });
    db.close();
  }, raw);
}

const themeState = (page) => page.evaluate(() => ({
  dark: document.documentElement.classList.contains('dark'),
  colorScheme: document.documentElement.style.colorScheme,
  magicuiVt: document.documentElement.dataset.magicuiThemeVt || '',
}));

// ---- 场景 A：普通主题，快速连点 5 次 ----
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push('A:' + String(e)));
  await page.goto('http://127.0.0.1:3010/canvas', { waitUntil: 'domcontentloaded' });
  await injectProject(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  const btn = page.locator('button[aria-label="切换到深色主题"], button[aria-label="切换到浅色主题"]').first();
  const before = await themeState(page);
  // 连点 5 次，中间不等动画完成——并发锁应让前一次动画的 cleanup 生效，主题按最终计数落地。
  for (let i = 0; i < 5; i++) { await btn.click(); }
  await page.waitForTimeout(1400);
  const after = await themeState(page);

  console.log('A_BEFORE:', JSON.stringify(before));
  console.log('A_AFTER:', JSON.stringify(after));
  // 动画追踪属性必须被清理；dark 与 colorScheme 必须一致。
  console.log('A_VT_CLEANED:', after.magicuiVt === '');
  console.log('A_STATE_CONSISTENT:', after.dark === (after.colorScheme === 'dark'));
  // 图标应反映最终态：深色显示 Sun（切浅色），浅色显示 Moon（切深色）。
  const showsSun = await page.locator('button[aria-label^="切换到"] svg.lucide-sun').count();
  const showsMoon = await page.locator('button[aria-label^="切换到"] svg.lucide-moon').count();
  console.log('A_ICON_MATCH:', showsSun === 1 ? after.dark : showsMoon === 1 ? !after.dark : 'none');
  await page.close();
}

// ---- 场景 B：reduced-motion，直接切换不跑动画 ----
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  page.on('pageerror', (e) => errors.push('B:' + String(e)));
  await page.goto('http://127.0.0.1:3010/canvas', { waitUntil: 'domcontentloaded' });
  await injectProject(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  const btn = page.locator('button[aria-label="切换到深色主题"], button[aria-label="切换到浅色主题"]').first();
  const before = await themeState(page);
  await btn.click();
  await page.waitForTimeout(120);
  const after = await themeState(page);
  console.log('B_BEFORE:', JSON.stringify(before));
  console.log('B_AFTER:', JSON.stringify(after));
  // reduced-motion 下立即切换：dark 翻转，且没有留下 ViewTransition 属性。
  console.log('B_IMMEDIATE_FLIP:', before.dark !== after.dark);
  console.log('B_NO_VT:', after.magicuiVt === '');
  await page.close();
}

console.log('PAGE_ERRORS:', errors.length, errors);
await browser.close();
