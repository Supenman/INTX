import { chromium } from 'playwright';

const OUT = '/root/.codebuddy/artifact/2f8a7d30-9c21-4f0b-1d6b-eb5a2a90b000/probe';
const browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto('http://127.0.0.1:3010/canvas-flow-pilot', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);

// 1) 节点是否渲染
const nodeCount = await page.locator('.react-flow__node').count();
console.log('FLOW_NODES:', nodeCount);

// 2) 边是否渲染
const edgeCount = await page.locator('.react-flow__edge').count();
console.log('FLOW_EDGES:', edgeCount);

// 3) 节点内输入框能否打字（关键验证：不被拖拽吞掉）
const input = page.locator('.react-flow__node input').first();
await input.click();
await page.keyboard.type('能打字');
await page.waitForTimeout(200);
console.log('INPUT_TYPED:', await input.inputValue());

// 4) 缩放是否生效
const zoomBefore = await page.locator('.react-flow__viewport').getAttribute('style');
await page.mouse.move(800, 500);
await page.mouse.wheel(0, -240);
await page.waitForTimeout(400);
const zoomAfter = await page.locator('.react-flow__viewport').getAttribute('style');
console.log('ZOOM_CHANGED:', zoomBefore !== zoomAfter);

// 5) 拖动节点位置变化
const node = page.locator('.react-flow__node').first();
const box = await node.boundingBox();
const styleBefore = await node.getAttribute('style');
await page.mouse.move(box.x + box.width / 2, box.y + 30);
await page.mouse.down();
await page.waitForTimeout(120);
for (const dx of [30, 60, 90]) {
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + 30, { steps: 3 });
  await page.waitForTimeout(60);
}
await page.mouse.up();
await page.waitForTimeout(300);
const styleAfter = await page.locator('.react-flow__node').first().getAttribute('style');
console.log('DRAG_CHANGED:', styleBefore !== styleAfter);

// 6) 小地图存在
console.log('MINIMAP:', await page.locator('.react-flow__minimap').count());

await page.screenshot({ path: OUT + '/flow_pilot.png' });
console.log('ERRORS_TOTAL:', errors.length);
errors.slice(0, 5).forEach((e) => console.log('  ' + e));
await browser.close();
