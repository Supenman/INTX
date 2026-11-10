import {
  normalizeError,
  type GeneratedItem,
  type GenerationHandlers,
  type GenerationRequest,
  type ProviderAdapter,
  type ProviderConfig,
} from '@/domain';

/**
 * OpenAI 兼容适配器。
 *
 * 为什么先做这一家：目前绝大多数"能出图"的服务都兼容 OpenAI 的
 * `/v1/images/generations` 与 `/v1/chat/completions`（官方、Azure、各类中转、本地 vLLM）。
 * 一个适配器覆盖一大片，比旧代码按厂商名写死十几条分支更划算；
 * 真遇到不兼容的协议，再加 adapter 类型，不必改上层。
 *
 * 三条硬规则：
 * 1. 超时必须有。旧代码一个视频任务把连接挂死 5 分钟，前端只能干等。
 * 2. 错误必须分类。抛出去的 Error 会经 domain 的 normalizeError 收敛成
 *    TaskError（auth_failed / rate_limited / …），UI 才能给出下一步动作。
 * 3. 不编进度。这个接口不提供进度，就一律回调 null。
 */

const DEFAULT_TIMEOUT_MS = 180_000;

function withTimeout(signal: AbortSignal | undefined, ms: number): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('timeout: 请求超时')), ms);
  const onAbort = () => ctrl.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: ctrl.signal,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/** 从响应里抽出人能看懂的错。不要把整段 HTML 错误页塞进任务里。 */
async function failure(res: Response): Promise<Error> {
  let detail = '';
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
      detail =
        typeof json.error === 'string'
          ? json.error
          : json.error?.message ?? json.message ?? text.slice(0, 300);
    } catch {
      detail = text.slice(0, 300);
    }
  } catch {
    detail = res.statusText;
  }
  return new Error(`HTTP ${res.status} ${detail}`.trim());
}

/** 把参考图拼进 chat 消息体。多张时按顺序，第一张是主参考。 */
function chatContent(prompt: string, refs: GenerationRequest['referenceImages']) {
  if (refs.length === 0) return prompt;
  return [
    { type: 'text' as const, text: prompt },
    ...refs.map((r) => ({
      type: 'image_url' as const,
      image_url: { url: `data:${r.mime};base64,${toBase64(r.bytes)}` },
    })),
  ];
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function fromBase64(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** data URL 与远程 URL 都要能处理：有的服务只回 b64，有的只回链接。 */
async function materialize(
  item: { b64_json?: string; url?: string },
  signal: AbortSignal,
  handlers: GenerationHandlers,
): Promise<GeneratedItem> {
  if (item.b64_json) {
    return { mime: 'image/png', bytes: fromBase64(item.b64_json) };
  }
  if (!item.url) throw new Error('上游既没返回图片数据也没返回链接');

  handlers.onPhase?.('downloading');
  handlers.onProgress?.(null);
  const res = await fetch(item.url, { signal });
  if (!res.ok) throw await failure(res);
  return {
    mime: res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png',
    bytes: await res.arrayBuffer(),
    sourceUrl: item.url,
  };
}

interface ImagesResponse {
  data?: { b64_json?: string; url?: string }[];
  error?: { message?: string };
}

interface ChatResponse {
  choices?: {
    message?: {
      content?: string | null;
      images?: { image_url?: { url?: string } }[];
    };
  }[];
  error?: { message?: string };
}

export const openAiCompatibleAdapter: ProviderAdapter = {
  kind: 'openai-compatible',

  async test(config) {
    const t = withTimeout(undefined, 15_000);
    try {
      const res = await fetch(joinUrl(config.baseUrl, 'models'), {
        headers: { Authorization: `Bearer ${config.apiKey}` },
        signal: t.signal,
      });
      if (!res.ok) return { ok: false, message: (await failure(res)).message };
      const body = (await res.json()) as { data?: { id?: string }[] };
      return { ok: true, models: (body.data ?? []).map((m) => m.id ?? '').filter(Boolean) };
    } catch (e) {
      const err = normalizeError(e);
      return { ok: false, message: err.message };
    } finally {
      t.done();
    }
  },

  async generate(config, request, handlers) {
    if (!config.apiKey && !config.baseUrl.includes('127.0.0.1') && !config.baseUrl.includes('localhost')) {
      throw new Error('401 未配置 API Key');
    }

    const t = withTimeout(request.signal, DEFAULT_TIMEOUT_MS);
    handlers.onPhase?.('submitting');
    handlers.onProgress?.(null);

    try {
      let items: GeneratedItem[];

      if (request.capability === 'image') {
        handlers.onPhase?.('generating');
        // 这个接口没有进度回报。如实说"不知道"，而不是假装 30%。
        items = await generateImages(config, request, t.signal, handlers);
      } else {
        handlers.onPhase?.('generating');
        items = await generateChat(config, request, t.signal, handlers);
      }

      if (items.length === 0) throw new Error('上游返回了空结果');
      handlers.onProgress?.(1);
      return items;
    } finally {
      t.done();
    }
  },
};

async function generateImages(
  config: ProviderConfig,
  request: GenerationRequest,
  signal: AbortSignal,
  handlers: GenerationHandlers,
): Promise<GeneratedItem[]> {
  const body: Record<string, unknown> = {
    model: request.model,
    prompt: request.prompt,
    n: Math.max(1, Math.min(request.count, 4)),
    size: sizeFromAspect(request.aspectRatio),
    response_format: 'b64_json',
  };
  // 参考图走图生图（gpt-image 系与多数兼容实现都认 image 字段）
  if (request.referenceImages.length === 1) {
    const ref = request.referenceImages[0]!;
    body.image = `data:${ref.mime};base64,${toBase64(ref.bytes)}`;
  }

  const res = await fetch(joinUrl(config.baseUrl, 'images/generations'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw await failure(res);

  const json = (await res.json()) as ImagesResponse;
  if (json.error?.message) throw new Error(json.error.message);
  const data = json.data ?? [];
  return Promise.all(data.map((d) => materialize(d, signal, handlers)));
}

async function generateChat(
  config: ProviderConfig,
  request: GenerationRequest,
  signal: AbortSignal,
  handlers: GenerationHandlers,
): Promise<GeneratedItem[]> {
  const res = await fetch(joinUrl(config.baseUrl, 'chat/completions'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: request.model,
      messages: [{ role: 'user', content: chatContent(request.prompt, request.referenceImages) }],
      modalities: request.capability === 'image' ? ['image', 'text'] : undefined,
    }),
    signal,
  });
  if (!res.ok) throw await failure(res);

  const json = (await res.json()) as ChatResponse;
  if (json.error?.message) throw new Error(json.error.message);

  const msg = json.choices?.[0]?.message;
  const out: GeneratedItem[] = [];

  for (const img of msg?.images ?? []) {
    const url = img.image_url?.url;
    if (!url) continue;
    if (url.startsWith('data:')) {
      const [meta, b64] = url.split(',');
      out.push({
        mime: meta?.split(':')[1]?.split(';')[0] ?? 'image/png',
        bytes: fromBase64(b64 ?? ''),
      });
    } else {
      out.push(await materialize({ url }, signal, handlers));
    }
  }

  // 纯文本任务（视频参数解析、分镜拆分）走这里
  if (out.length === 0 && msg?.content) {
    const enc = new TextEncoder().encode(msg.content);
    out.push({ mime: 'text/markdown', bytes: enc.buffer as ArrayBuffer });
  }
  return out;
}

/** 宽高比 → 像素尺寸。官方支持的档位有限，就近取。 */
export function sizeFromAspect(aspect?: string): string {
  switch (aspect) {
    case '16:9':
      return '1536x864';
    case '9:16':
      return '864x1536';
    case '4:3':
      return '1280x960';
    case '3:4':
      return '960x1280';
    default:
      return '1024x1024';
  }
}

/** 给测试与设置页用的模型清单（不联网，只是常见型号的标注）。 */
export const KNOWN_OPENAI_COMPATIBLE_MODELS = [
  { id: 'gpt-image-1', label: 'gpt-image-1', capabilities: ['image'] as const },
  { id: 'dall-e-3', label: 'dall-e-3', capabilities: ['image'] as const },
  { id: 'gpt-4o-mini', label: 'gpt-4o-mini', capabilities: ['text'] as const },
];
