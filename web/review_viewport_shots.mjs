/**
 * 三档视口观感复核：1280 / 1440 / 1920，浅色主题。
 * 只截图不改代码，用于复核 PageShell 留白统一后的实际观感。
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = '/root/.codebuddy/artifact/2f8a7d30-9c21-4f0b-1d6b-eb5a2a90b000/review-viewport';
fs.mkdirSync(OUT, { recursive: true });

const BASE = 'http://127.0.0.1:3000';
const browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(`${BASE}/canvas`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);

await page.evaluate(() => {
  const node = (id, type, title, x, y, extra = {}) => ({
    id, type, title, position: { x, y }, width: type === 'text' ? 260 : 320, height: type === 'text' ? 120 : 240,
    metadata: { status: 'success', generationMode: type === 'video' ? 'video' : 'image', ...extra },
  });
  const filled = {
    id: 'vis-1', title: '产品短片 · 第三版', createdAt: '2026-11-18', updatedAt: '2026-11-20',
    nodes: [
      node('a', 'image', '开场主视觉', 120, 100),
      node('b', 'video', '镜头 01', 520, 100),
      node('c', 'text', '字幕：限时特惠', 940, 120, { content: '限时特惠' }),
      node('d', 'audio', '旁白轨', 120, 420),
    ],
    connections: [], chatSessions: [], activeChatId: null, backgroundMode: 'dots', showImageInfo: false,
    viewport: { x: 40, y: 40, k: 0.72 },
    timeline: { fps: 24, tracks: [] },
  };
  const raw = JSON.stringify({ state: { projects: [filled], deletedProjects: [] }, version: 0, metadata: { formatVersion: 1, revision: 1 } });
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('infinite-canvas');
    req.onerror = () => reject('open');
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('app_state', 'readwrite');
      tx.objectStore('app_state').put(raw, 'infinite-canvas:canvas_store');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject('put');
    };
  });
});

for (const theme of ['dark', 'light']) {
  await page.goto(`${BASE}/canvas`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const isDark = (await page.evaluate(() => document.documentElement.className)).includes('dark');
  if ((theme === 'dark') !== isDark) {
    const label = theme === 'light' ? '切换到浅色主题' : '切换到深色主题';
    const btn = page.locator(`button[aria-label="${label}"]`).first();
    if (await btn.count()) { await btn.click(); await page.waitForTimeout(800); }
  }
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: width === 1280 ? 800 : 900 });
    for (const t of [
      { path: '/canvas', name: 'canvas-list' },
      { path: '/config', name: 'config' },
      { path: '/canvas/vis-1', name: 'canvas-editor' },
    ]) {
      await page.goto(`${BASE}${t.path}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1600);
      await page.screenshot({ path: `${OUT}/${theme}-${width}-${t.name}.png` });
      console.log('shot:', `${theme}-${width}-${t.name}`);
    }
  }
}
console.log('ERRORS:', errors.length, errors.slice(0, 3));
await browser.close();
