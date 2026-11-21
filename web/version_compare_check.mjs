import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:3010';
const OUT = '/root/.codebuddy/artifact/2f8a7d30-9c21-4f0b-1d6b-eb5a2a90b000/probe';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

const browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push('CONSOLE: ' + m.text()); });
const RAW_GITHUB = 'https://raw.githubusercontent.com/Supenman/INTX/';
page.on('requestfailed', (r) => { if (!r.url().startsWith(RAW_GITHUB)) errors.push('REQFAIL: ' + r.url()); });
page.on('response', (r) => { if (r.status() >= 400 && !r.url().startsWith(RAW_GITHUB)) errors.push('HTTP' + r.status() + ': ' + r.url()); });

await page.goto(BASE + '/canvas', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(500);

await page.evaluate((png) => {
  const versionNode = (id, label, primary, title, prompt, x) => ({
    id, type: 'image', title, position: { x, y: 100 }, width: 320, height: 240,
    metadata: { content: png, mimeType: 'image/png', status: 'success', prompt, model: `model-${label}`, size: '1024x1024', versionOfNodeId: 'root', versionLabel: label, versionPrimary: primary },
  });
  const project = {
    id: 'e2e-version', title: '版本对比 E2E', createdAt: '2026-11-21', updatedAt: '2026-11-21',
    nodes: [versionNode('v-a', 'A', false, '初稿', '第一版提示词', 80), versionNode('v-b', 'B', true, '终稿', '第二版提示词', 520)],
    connections: [], chatSessions: [], activeChatId: null,
    backgroundMode: 'dots', showImageInfo: false, viewport: { x: 0, y: 0, k: 1 }, timeline: { fps: 24, tracks: [] },
  };
  const snapshot = { projects: [project], deletedProjects: [] };
  const raw = JSON.stringify({ state: snapshot, version: 0, metadata: { formatVersion: 1, revision: 1 } });
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('infinite-canvas');
    req.onerror = () => reject('open failed');
    req.onsuccess = () => {
      const tx = req.result.transaction('app_state', 'readwrite');
      tx.objectStore('app_state').put(raw, 'infinite-canvas:canvas_store');
      tx.oncomplete = () => { req.result.close(); resolve('written'); };
      tx.onerror = () => reject('put failed');
    };
  });
}, PNG);

await page.goto(BASE + '/canvas/e2e-version', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);

const badgeA = page.locator('[data-version-badge="A"]');
const badgeB = page.locator('[data-version-badge="B"]');
console.log('BADGES:', await badgeA.count(), await badgeB.count());
if ((await badgeA.count()) !== 1 || (await badgeB.count()) !== 1) throw new Error('version badges missing');

await badgeB.click();
await page.waitForTimeout(300);
console.log('DIALOG_COUNTS:', await page.locator('[role="dialog"]').count(), await page.locator('.ant-modal').count(), await page.locator('.ant-modal-content').count());
const modal = page.locator('[role="dialog"]');
await modal.waitFor();
const modalText = await modal.innerText();
console.log('MODAL_TEXT:', JSON.stringify(modalText.slice(0, 400)));
console.log('MODAL_CARDS:', await modal.locator('article').count());
console.log('MODAL_HAS_PROMPTS:', modalText.includes('第一版提示词'), modalText.includes('第二版提示词'));
if (!modalText.includes('版本对比') || (await modal.locator('article').count()) !== 2) throw new Error('version compare modal failed');
await page.screenshot({ path: OUT + '/version_compare_modal.png' });

await modal.getByRole('button', { name: '设为主版本' }).click();
await page.waitForTimeout(200);
const afterPrimary = await modal.innerText();
console.log('PRIMARY_SWITCHED:', afterPrimary.includes('当前主版本'));
if (!afterPrimary.includes('当前主版本')) throw new Error('primary switch failed');

await modal.locator('article').filter({ hasText: '终稿' }).locator('button').first().click();
await page.waitForTimeout(250);
console.log('MODAL_AFTER_FOCUS:', await modal.count());
if ((await modal.count()) !== 0) throw new Error('focus did not close modal');

console.log('ERRORS_TOTAL:', errors.length, errors.slice(0, 3));
if (errors.length) throw new Error('page errors: ' + errors.slice(0, 3).join(' | '));
await browser.close();
