import { chromium } from 'playwright';
import { writeFileSync, readFileSync } from 'node:fs';

const OUT = '/root/.codebuddy/artifact/2f8a7d30-9c21-4f0b-1d6b-eb5a2a90b000/probe';
const TPS = 120000;
const wavA = readFileSync(`${OUT}/tone_a.wav`).toString('base64');
const wavB = readFileSync(`${OUT}/tone_b.wav`).toString('base64');

const browser = await chromium.launch({
  headless: true, executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto('http://127.0.0.1:3010/canvas', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(600);

const result = await page.evaluate(async ({ tps, wavA, wavB }) => {
  const { encodeTimeline } = await import('/src/lib/canvas/timeline-export.ts');
  const { setMediaBlob } = await import('/src/services/file-storage.ts');
  const { setImageBlob } = await import('/src/services/image-storage.ts');

  const b64ToBlob = (b64, type) => {
    const bin = atob(b64); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
  };
  await setMediaBlob('audio:p4-tone-a', b64ToBlob(wavA, 'audio/wav'));
  await setMediaBlob('audio:p4-tone-b', b64ToBlob(wavB, 'audio/wav'));

  const c = document.createElement('canvas');
  c.width = 320; c.height = 180;
  c.getContext('2d').fillRect(0, 0, 320, 180);
  const imgBlob = await new Promise((r) => c.toBlob(r, 'image/png'));
  await setImageBlob('image:p4-bg', imgBlob);

  const nodes = [
    { id: 'v1', type: 'image', title: '底图', position: { x: 0, y: 0 }, width: 320, height: 180,
      metadata: { status: 'success', storageKey: 'image:p4-bg', content: 'image:image:p4-bg' } },
    { id: 'a1', type: 'audio', title: '440Hz', position: { x: 0, y: 0 }, width: 320, height: 180,
      metadata: { status: 'success', storageKey: 'audio:p4-tone-a', content: 'audio:p4-tone-a' } },
    { id: 'a2', type: 'audio', title: '880Hz', position: { x: 0, y: 0 }, width: 320, height: 180,
      metadata: { status: 'success', storageKey: 'audio:p4-tone-b', content: 'audio:p4-tone-b' } },
  ];
  // 总时长 5s：视频铺满；音A 0-2s、音B 3-5s，中间 2-3s 应静音。
  const timeline = { fps: 24, tracks: [
    { id: 'video', kind: 'video', clips: [
      { id: 'cv', nodeId: 'v1', startTick: 0, durationTick: 5 * tps, sourceStartTick: 0 },
    ] },
    { id: 'audio', kind: 'audio', clips: [
      { id: 'ca1', nodeId: 'a1', startTick: 0, durationTick: 2 * tps, sourceStartTick: 0, volume: 1 },
      { id: 'ca2', nodeId: 'a2', startTick: 3 * tps, durationTick: 2 * tps, sourceStartTick: 0, volume: 1 },
    ] },
  ] };
  const { blob, container } = await encodeTimeline(nodes, timeline, { width: 640, height: 360, fps: 24 });
  const buf = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { container, size: blob.size, base64: btoa(binary) };
}, { tps: TPS, wavA, wavB });

const file = `${OUT}/p4_audio.${result.container}`;
writeFileSync(file, Buffer.from(result.base64, 'base64'));
console.log('AUDIO_EXPORT:', result.container, result.size, '->', file);
console.log('ERRORS_TOTAL:', errors.length, errors.slice(0, 3));
await browser.close();
