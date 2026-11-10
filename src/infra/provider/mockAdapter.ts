import type { GeneratedItem, ProviderAdapter } from '@/domain';

/**
 * 演示适配器：不联网，本地画图。
 *
 * 存在的理由不是"占位"，而是让整条链路（题目解析 → 参数快照 → 任务状态机
 * → 产物落盘 → 资产库 → 画布渲染）在没有 API Key 的机器上也能跑通，
 * 也让 E2E 测试不依赖任何外部服务。
 *
 * 注意它**照样走完整状态机**：不确定进度 → 真实进度 → 完成。
 * 这些步骤是真实耗时的，不是 setTimeout 假装。
 */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 用 canvas 画一张带文字的图，返回 PNG 字节。 */
async function drawCard(text: string, index: number, aspect: string): Promise<ArrayBuffer> {
  const [w, h] = aspect === '9:16' ? [540, 960] : aspect === '16:9' ? [960, 540] : [700, 700];
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前环境不支持 canvas');

  const hue = (index * 47 + 18) % 360;
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, `hsl(${hue} 62% 26%)`);
  grad.addColorStop(1, `hsl(${(hue + 60) % 360} 52% 12%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // 一点几何装饰，避免看起来像纯色块
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = Math.max(2, w / 220);
  for (let i = 0; i < 6; i += 1) {
    ctx.beginPath();
    ctx.arc(w * 0.78, h * 0.22, (i + 1) * (w / 16), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.font = `700 ${Math.round(w / 13)}px -apple-system, "PingFang SC", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  wrap(ctx, text, w / 2, h / 2, w * 0.78, Math.round(w / 11));

  ctx.font = `500 ${Math.round(w / 30)}px ui-monospace, monospace`;
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText(`INTX · 演示产物 #${index + 1}`, w / 2, h - h * 0.08);

  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error('生成 PNG 失败');
  return blob.arrayBuffer();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, maxW: number, lh: number): void {
  const chars = [...text];
  const lines: string[] = [];
  let line = '';
  for (const ch of chars) {
    const next = line + ch;
    if (ctx.measureText(next).width > maxW && line !== '') {
      lines.push(line);
      line = ch;
    } else {
      line = next;
    }
    if (lines.length >= 4) break;
  }
  if (line && lines.length < 5) lines.push(line);

  const startY = cy - ((lines.length - 1) * lh) / 2;
  lines.forEach((l, i) => ctx.fillText(l, cx, startY + i * lh));
}

export const mockAdapter: ProviderAdapter = {
  kind: 'mock',

  async test(config) {
    return { ok: true, models: config.models.map((m) => m.id) };
  },

  async generate(config, request, handlers): Promise<GeneratedItem[]> {
    handlers.onPhase?.('submitting');
    // 提交阶段真实存在，而且确实拿不到进度
    handlers.onProgress?.(null);
    await sleep(400);
    if (request.signal?.aborted) throw request.signal.reason;

    handlers.onPhase?.('generating');
    // 前半程"不确定"：这就是真实厂商最常见的状态
    await sleep(900);
    if (request.signal?.aborted) throw request.signal.reason;

    for (const p of [0.18, 0.4, 0.63, 0.82]) {
      await sleep(260);
      if (request.signal?.aborted) throw request.signal.reason;
      handlers.onProgress?.(p);
    }

    handlers.onPhase?.('downloading');
    handlers.onProgress?.(null);

    const n = Math.max(1, Math.min(request.count, 9));
    const items: GeneratedItem[] = [];
    for (let i = 0; i < n; i += 1) {
      // 演示错误分支：提示词含 fail 时走失败路径，方便验证错误 UI
      if (request.prompt.toLowerCase().includes('fail')) {
        throw new Error('429 rate limit exceeded');
      }
      items.push({
        mime: 'image/png',
        bytes: await drawCard(request.prompt || config.name, i, request.aspectRatio ?? '1:1'),
      });
    }
    handlers.onProgress?.(1);
    return items;
  },
};
