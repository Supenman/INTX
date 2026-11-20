import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const OUT = '/root/.codebuddy/artifact/2f8a7d30-9c21-4f0b-1d6b-eb5a2a90b000/probe';
const TPS = 120000;
const browser = await chromium.launch({
  headless: true, executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto('http://127.0.0.1:3010/canvas', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(600);

const result = await page.evaluate(async ({ tps }) => {
  const { encodeTimeline } = await import('/src/lib/canvas/timeline-export.ts');
  const { setImageBlob } = await import('/src/services/image-storage.ts');

  // 纯黑底图：白字计数不受底色干扰。
  async function solid(color, key) {
    const c = document.createElement('canvas');
    c.width = 320; c.height = 180;
    const g = c.getContext('2d');
    g.fillStyle = color; g.fillRect(0, 0, 320, 180);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    await setImageBlob(key, blob);
    return key;
  }
  const black = await solid('#000000', 'image:p4-black');

  const nodes = [
    { id: 'bg', type: 'image', title: '黑底', position: { x: 0, y: 0 }, width: 320, height: 180,
      metadata: { status: 'success', storageKey: black, content: `image:${black}` } },
    { id: 't1', type: 'text', title: '字幕A', position: { x: 0, y: 0 }, width: 300, height: 60,
      metadata: { status: 'success', content: 'HELLO' } },
    { id: 't2', type: 'text', title: '字幕B', position: { x: 0, y: 0 }, width: 300, height: 60,
      metadata: { status: 'success', content: 'WORLD' } },
  ];
  // 视频 0-6s 黑底；字幕A 1-3s；字幕B 4-6s；3-4s 无字幕。
  const timeline = { fps: 24, tracks: [
    { id: 'video', kind: 'video', clips: [
      { id: 'cv', nodeId: 'bg', startTick: 0, durationTick: 6 * tps, sourceStartTick: 0 },
    ] },
    { id: 'text', kind: 'text', clips: [
      { id: 'ta', nodeId: 't1', startTick: 0, durationTick: 6 * tps, sourceStartTick: 0 },
      { id: 'tb', nodeId: 't2', startTick: 4 * tps, durationTick: 2 * tps, sourceStartTick: 0 },
    ] },
  ] };

  const progress = [];
  const { blob, container } = await encodeTimeline(nodes, timeline, {
    width: 640, height: 360, fps: 24, onProgress: (v) => progress.push(v),
  });
  const buf = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { container, size: blob.size, type: blob.type, base64: btoa(binary), progressTail: progress.slice(-3) };
}, { tps: TPS });

console.log('EXPORT_RESULT:', JSON.stringify({ container: result.container, size: result.size, type: result.type, progressTail: result.progressTail }));
const file = `${OUT}/p4_text_overlap.${result.container}`;
writeFileSync(file, Buffer.from(result.base64, 'base64'));
console.log('WROTE:', file);
console.log('ERRORS_TOTAL:', errors.length, errors.slice(0, 3));
await browser.close();
