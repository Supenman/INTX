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

const result = await page.evaluate(async ({ tps, forceWebm }) => {
  // 模拟 WebKitGTK 能力矩阵（无 H.264/AAC，有 VP9/Opus），验证 WebM 降级链路真能出片。
  if (forceWebm) {
    const realVideo = VideoEncoder.isConfigSupported.bind(VideoEncoder);
    const realAudio = AudioEncoder.isConfigSupported.bind(AudioEncoder);
    VideoEncoder.isConfigSupported = async (cfg) => cfg.codec.startsWith('avc1')
      ? { supported: false } : realVideo(cfg);
    AudioEncoder.isConfigSupported = async (cfg) => cfg.codec.startsWith('mp4a')
      ? { supported: false } : realAudio(cfg);
  }
  const { encodeTimeline } = await import('/src/lib/canvas/timeline-export.ts');
  const { setImageBlob } = await import('/src/services/image-storage.ts');

  // 生成纯色图片素材（红/绿/蓝），便于抽帧判定切点。
  async function solid(color, key) {
    const c = document.createElement('canvas');
    c.width = 320; c.height = 180;
    const g = c.getContext('2d');
    g.fillStyle = color; g.fillRect(0, 0, 320, 180);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    await setImageBlob(key, blob);
    return key;
  }
  const red = await solid('#ff0000', 'image:p4-red');
  const green = await solid('#00ff00', 'image:p4-green');
  const blue = await solid('#0000ff', 'image:p4-blue');

  const node = (id, key, title) => ({
    id, type: 'image', title, position: { x: 0, y: 0 }, width: 320, height: 180,
    metadata: { status: 'success', storageKey: key, content: `image:${key}` },
  });
  const nodes = [node('n1', red, '红'), node('n2', green, '绿'), node('n3', blue, '蓝')];
  // 镜头1 0-2s 红；镜头2 2-4s 绿；空档 4-5s；镜头3 5-7s 蓝。总时长 7s。
  const timeline = { fps: 24, tracks: [{
    id: 'video', kind: 'video', clips: [
      { id: 'c1', nodeId: 'n1', startTick: 0, durationTick: 2 * tps, sourceStartTick: 0 },
      { id: 'c2', nodeId: 'n2', startTick: 2 * tps, durationTick: 2 * tps, sourceStartTick: 0 },
      { id: 'c3', nodeId: 'n3', startTick: 5 * tps, durationTick: 2 * tps, sourceStartTick: 0 },
    ],
  }] };

  const progress = [];
  const { blob, container } = await encodeTimeline(nodes, timeline, {
    width: 640, height: 360, fps: 24, onProgress: (v) => progress.push(v),
  });
  const buf = await blob.arrayBuffer();
  // 分块转 base64，避免一次性参数过大。
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { container, size: blob.size, type: blob.type, base64: btoa(binary), progressTail: progress.slice(-3) };
}, { tps: TPS, forceWebm: process.env.FORCE_WEBM === '1' });

console.log('EXPORT_RESULT:', JSON.stringify({ container: result.container, size: result.size, type: result.type, progressTail: result.progressTail }));
const file = `${OUT}/p4_timeline.${result.container}`;
writeFileSync(file, Buffer.from(result.base64, 'base64'));
console.log('WROTE:', file);
console.log('ERRORS_TOTAL:', errors.length, errors.slice(0, 3));
await browser.close();
