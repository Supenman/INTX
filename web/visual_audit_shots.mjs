/**
 * 视觉审查截图：浅色 / 深色各一轮，覆盖主要页面。
 * 只截图不改代码，用于人工比对哪里不一致。
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = '/root/.codebuddy/artifact/2f8a7d30-9c21-4f0b-1d6b-eb5a2a90b000/visual';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-gpu'] });

async function seed() {
  return `<script></script>`;
}

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('http://127.0.0.1:3010/canvas', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

// 注入两个画布：一个空，一个带节点，便于同时看空态与编辑态
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
    connections: [],
    chatSessions: [], activeChatId: null, backgroundMode: 'dots', showImageInfo: false,
    viewport: { x: 40, y: 40, k: 0.72 },
    timeline: { fps: 24, tracks: [{ id: 'vt', kind: 'video', clips: [
      { id: 'c1', nodeId: 'b', startTick: 0, durationTick: 360000, sourceStartTick: 0 },
      { id: 'c2', nodeId: 'a', startTick: 360000, durationTick: 240000, sourceStartTick: 0 },
    ] }, { id: 'at', kind: 'audio', clips: [
      { id: 'a1', nodeId: 'd', startTick: 0, durationTick: 600000, sourceStartTick: 0 },
    ] }] },
  };
  const empty = {
    id: 'vis-2', title: '空白画布', createdAt: '2026-11-20', updatedAt: '2026-11-20',
    nodes: [], connections: [], chatSessions: [], activeChatId: null, backgroundMode: 'dots',
    showImageInfo: false, viewport: { x: 0, y: 0, k: 1 }, timeline: { fps: 24, tracks: [] },
  };
  const raw = JSON.stringify({ state: { projects: [filled, empty], deletedProjects: [] }, version: 0, metadata: { formatVersion: 1, revision: 1 } });
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

async function setTheme(theme) {
  const label = theme === 'light' ? '切换到浅色主题' : '切换到深色主题';
  const btn = page.locator(`button[aria-label="${label}"]`).first();
  if (await btn.count()) { await btn.click(); await page.waitForTimeout(900); return true; }
  return false;
}

async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('shot:', name);
}

const targets = [
  { path: '/canvas', name: 'canvas-list' },
  { path: '/canvas/vis-1', name: 'canvas-editor' },
  { path: '/config', name: 'config' },
  { path: '/assets', name: 'assets' },
  { path: '/tasks', name: 'tasks' },
];

for (const theme of ['dark', 'light']) {
  await page.goto('http://127.0.0.1:3010/canvas', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1400);
  const now = await page.evaluate(() => document.documentElement.className);
  const isDark = now.includes('dark');
  if ((theme === 'dark') !== isDark) {
    await setTheme(theme);
  }
  for (const t of targets) {
    await page.goto(`http://127.0.0.1:3010${t.path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2200);
    await shot(`${t.name}-${theme}`);
  }
  // 时间线弹窗单独截（从画布菜单进）
  await page.goto('http://127.0.0.1:3010/canvas/vis-1', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);
  const menu = page.getByLabel('打开画布菜单');
  if (await menu.count()) {
    await menu.click();
    await page.waitForTimeout(500);
    await shot(`canvas-menu-${theme}`);
    const tl = page.getByRole('menuitem', { name: '时间线' });
    if (await tl.count()) {
      await tl.click();
      await page.waitForTimeout(1200);
      await shot(`timeline-${theme}`);
      await page.keyboard.press('Escape');
    }
  }
}

console.log('ERRORS:', errors.length);
await browser.close();
