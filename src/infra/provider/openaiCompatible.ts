import {
  normalizeError,
  type GeneratedItem,
  type GenerationHandlers,
  type GenerationRequest,
  type ProviderAdapter,
  type ProviderConfig,
} from '@/domain';
import { failure, fromBase64, joinUrl, materialize } from './providerHttp';
import { pollSubmittedTask } from './modelScopeTask';
import { ProviderResultPendingError } from './providerResultPending';

// 这几个小工具历史上从这里导出，保留出口，避免下游改动扩散。
export { failure, joinUrl, materialize } from './providerHttp';

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

/**
 * 比 pollSubmittedTask 的 180s 上限多留一分钟：万一配置没切到 modelscope
 * 适配器而走了这里的兜底查单，不能让本地超时掐断已经付过费的轮询。
 */
const DEFAULT_TIMEOUT_MS = 240_000;

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

interface ImagesResponse {
  data?: { b64_json?: string; url?: string }[];
  /** 异步服务不回图片数组，只回任务号（ModelScope 即是） */
  task_id?: string;
  task_status?: string;
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

      /**
       * 走到这里说明 POST 已经 2xx（上游收单、通常已计费），只是响应里
       * 没有我们认得的产物。旧代码抛「上游返回了空结果」→ unknown →
       * allowed → 卡片让用户重试再买一张。异步服务（ModelScope 回 task_id）
       * 就是这么被吞掉的，真机上已扣费却报空结果。
       */
      if (items.length === 0) {
        throw new ProviderResultPendingError({ detail: '响应里没有图片数据' });
      }
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

  /**
   * POST 已经 2xx：上游收单了。响应里没有图片数组时不能说「空结果」——
   * 异步服务就是只回 task_id，图要另外轮询取。把任务号带出去，交给
   * ProviderResultPendingError 判成「先确认再重发」，避免再扣一次钱。
   */
  if (data.length === 0) {
    /**
     * 异步服务只回了 task_id：这一单已经收了、通常已计费。旧代码在这里
     * 抛「已收单但没拿到图」，用户只能拿着任务号去厂商后台查，图始终出不来
     * （真机第二次反馈就是卡在这里）。现在就地查这一单把图取回来——
     * 不重新提交，绝不产生第二笔费用。只有连任务号都没有才真的无从查起，
     * 交给 pending 留证，避免被判成「可原样重试」。
     */
    if (json.task_id) {
      return pollSubmittedTask(config, json.task_id, { signal, handlers, count: request.count });
    }
    throw new ProviderResultPendingError({
      rawResponse: JSON.stringify(json),
      detail: '响应里没有 data 数组',
    });
  }
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
