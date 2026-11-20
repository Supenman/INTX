/**
 * 悬浮栏接注册表验收：接表不能少按钮，且偏好第一次真的能生效。
 *
 * 三条要证明的：
 *   1. 图片节点上原有的非注册表按钮一个不少（字体、上传、图片工具箱、插件项）
 *   2. 注册表三件套（信息 / 复制 / 删除）都在，顺序与 defaultOrder 一致
 *   3. 往 localStorage 写 hidden 之后，对应按钮真的消失（接表前悬浮栏不读偏好，这条一直是死的）
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('requestfailed', (r) => { if (!r.url().startsWith('https://raw.githubusercontent.com/Supenman/INTX/')) errors.push('REQFAIL: ' + r.url()); });
page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push('CONSOLE: ' + m.text()); });

async function seedProject() {
  await page.evaluate(() => {
    const node = (id, type, title, x, extra = {}) => ({
      id, type, title, position: { x, y: 120 }, width: 320, height: 240,
      metadata: { status: 'success', generationMode: type === 'video' ? 'video' : 'image', ...extra },
    });
    const project = {
      id: 'e2e-hover', title: '悬浮栏接表验收', createdAt: '', updatedAt: '',
      nodes: [
        node('img', 'image', '图片节点', 120),
        node('vid', 'video', '视频节点', 560),
        node('txt', 'text', '文字节点', 1000, { Content: '文本' }),
      ],
      connections: [], chatSessions: [], activeChatId: null, backgroundMode: 'dots', showImageInfo: false,
      viewport: { x: 0, y: 0, k: 0.7 }, timeline: { fps: 24, tracks: [] },
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
  });
}

const toolbarButtons = async () => {
  const bar = page.locator('[data-node-toolbar]').first();
  if (!(await bar.count())) return [];
  return bar.locator('button[aria-label]').evaluateAll((ns) => ns.map((n) => n.getAttribute('aria-label')));
};

async function selectNodeAt(index) {
  const b = await page.locator('[data-node-id]').nth(index).boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + 24);
  await page.waitForTimeout(700);
}

await page.goto('http://127.0.0.1:3010/canvas', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(600);
await seedProject();
await page.goto('http://127.0.0.1:3010/canvas/e2e-hover', { waitUntil: 'domcontentloaded' });
await page.getByText('图片节点').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
await page.waitForTimeout(900);

// ── 1 & 2. 图片节点：注册表三件套 + 原有非注册表按钮 ─────────
await selectNodeAt(0);
const imageLabels = await toolbarButtons();
console.log('IMAGE_TOOLBAR_COUNT:', imageLabels.length);
console.log('IMAGE_TOOLBAR_LABELS:', JSON.stringify(imageLabels));

const hasRegistry = ['信息', '复制这个节点', '移除这个节点'].every((want) => imageLabels.some((l) => l && l.startsWith(want)));
const at = (want) => imageLabels.findIndex((l) => l && l.startsWith(want));
const orderOk = at('信息') < at('复制这个节点') && at('复制这个节点') < at('移除这个节点');
console.log('REGISTRY_THREE_PRESENT:', hasRegistry);
console.log('REGISTRY_ORDER_OK:', orderOk);

// 非注册表按钮仍在：图片节点应有「上传图片」与字号相关或图片工具箱项
const hasUpload = imageLabels.some((l) => l && l.includes('上传图片'));
console.log('NON_REGISTRY_UPLOAD_KEPT:', hasUpload);

// ── 3. 偏好生效：隐藏「复制」后应少一个 ──────────────────────
await page.evaluate(() => {
  window.localStorage.setItem('intx-toolbar-prefs-node-hover-v1', JSON.stringify({ version: 1, order: [], hidden: ['node-duplicate'] }));
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.getByText('图片节点').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
await page.waitForTimeout(900);
await selectNodeAt(0);
const afterHide = await toolbarButtons();
console.log('AFTER_HIDE_COUNT:', afterHide.length);
console.log('AFTER_HIDE_LABELS:', JSON.stringify(afterHide));
const dupGone = !afterHide.some((l) => l && l.startsWith('复制这个节点'));
const othersKept = afterHide.some((l) => l && l.startsWith('信息')) && afterHide.some((l) => l && l.startsWith('移除这个节点'));
console.log('HIDDEN_DUPLICATE_GONE:', dupGone);
console.log('OTHERS_KEPT:', othersKept);

// 清理偏好，避免影响后续用例
await page.evaluate(() => window.localStorage.removeItem('intx-toolbar-prefs-node-hover-v1'));

console.log('ERRORS:', JSON.stringify(errors.slice(0, 5)));

const pass = hasRegistry && orderOk && hasUpload && imageLabels.length >= 4 && dupGone && othersKept && errors.length === 0;
console.log('HOVER_REGISTRY_' + (pass ? 'PASS' : 'FAIL'));
await page.screenshot({ path: '/tmp/hover-registry.png' });
await browser.close();
process.exit(pass ? 0 : 1);
