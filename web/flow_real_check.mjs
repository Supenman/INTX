import { chromium } from 'playwright';

const OUT = '/root/.codebuddy/artifact/2f8a7d30-9c21-4f0b-1d6b-eb5a2a90b000/probe';
const browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
page.on('response', (r) => { if (r.status() >= 400) errors.push(r.status() + ': ' + r.url()); });

await page.goto('http://127.0.0.1:3010/canvas-flow-pilot', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

console.log('NODES:', await page.locator('.react-flow__node').count());
console.log('EDGES:', await page.locator('.react-flow__edge').count());
console.log('IMAGES_LOADED:', await page.locator('.react-flow__node img').evaluateAll((els) => els.map((e) => e.naturalWidth > 0)));
console.log('VIDEOS:', await page.locator('.react-flow__node video').count());
console.log('VIDEO_READY:', await page.locator('.react-flow__node video').evaluateAll((els) => els.map((v) => v.readyState)));
console.log('AUDIO:', await page.locator('.react-flow__node audio').count());
console.log('MINIMAP:', await page.locator('.react-flow__minimap').count());

await page.screenshot({ path: OUT + '/flow_real.png' });
console.log('ERRORS_TOTAL:', errors.length);
errors.slice(0, 6).forEach((e) => console.log('  ' + e));
await browser.close();
