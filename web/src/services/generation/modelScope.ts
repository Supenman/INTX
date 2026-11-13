/**
 * ModelScope API-Inference 异步出图：提交 → 立刻落任务号 → 就地查单取图。
 *
 * 协议（官方模型页 API Inference 示例，openmoss/MOSS-Image-SFT 同款）：
 *   POST {baseUrl}/images/generations
 *        headers: X-ModelScope-Async-Mode: true
 *        body:    { model, prompt }        只发这两个，不塞 n/size/response_format
 *        → 2xx { task_id }                 此刻已收单、通常已计费
 *   GET  {baseUrl}/tasks/{task_id}
 *        headers: X-ModelScope-Task-Type: image_generation
 *        → { task_status: SUCCEED|FAILED|PENDING|RUNNING, output_images: [url] }
 *
 * 设计来源：旧 INTX `infra/provider/modelScope.ts` + `modelScopeTask.ts`，
 * 两轮真机修复后的语义原样继承：
 * - 拿到 task_id 后，任何失败（FAILED/超时/断网/取消）都只抛
 *   ProviderResultPendingError 留住任务号 → confirm，绝不退化成可重试；
 * - 只查这一单，绝不重新 POST（那会再买一张）。
 *
 * 新基座特有：提交 2xx 拿到号的那一刻就把 upstreamRef 写进台账（经
 * `onSubmitted` 回调由 runWithTask 落盘），刷新/崩溃后也能凭号续查。
 *
 * 这里不碰 axios / i18n / React：HTTP 与取图经 `ModelScopeTransport` 注入，
 * 单测用内存实现，零真实请求。
 */
import { ProviderResultPendingError } from './pendingResult';

/** 查单间隔与最长等待。沿用旧 INTX 真机验证过的值（用户 2026-11-13 确认）。 */
export const MODELSCOPE_POLL_INTERVAL_MS = 5_000;
export const MODELSCOPE_MAX_WAIT_MS = 180_000;

/** 官方 API-Inference 域名。前缀必须是 api-inference，社区网页域名不算。 */
export function isModelScopeEndpoint(baseUrl: string): boolean {
  let host = '';
  try {
    host = new URL(baseUrl.trim()).hostname.toLowerCase();
  } catch {
    return false;
  }
  return /^api-inference\.modelscope\.(cn|ai)$/.test(host);
}

/** HTTP 响应的最小视图，便于注入与测试。 */
export interface TransportResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export interface ModelScopeTransport {
  /** 发请求。url 已拼好；实现负责本地代理改写与 signal。 */
  request(
    url: string,
    init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string; signal?: AbortSignal },
  ): Promise<TransportResponse>;
  /** 把上游图片地址下载成画布可用的 dataUrl。 */
  fetchImage(url: string, signal?: AbortSignal): Promise<string>;
  /** 可注入的等待，测试里用假时钟。 */
  sleep?(ms: number, signal?: AbortSignal): Promise<void>;
  now?(): number;
}

export interface ModelScopeRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  /** 参考图数量。协议未声明参考图字段，有就拒绝，不猜字段名。 */
  referenceCount: number;
  signal?: AbortSignal;
  /** 提交 2xx 拿到任务号的那一刻调用，用于立刻落盘 upstreamRef。 */
  onSubmitted?(taskId: string): void;
}

export interface ModelScopeImage {
  dataUrl: string;
}

function joinUrl(base: string, path: string): string {
  const normalized = base.trim().replace(/\/+$/, '');
  return `${normalized}/${path.replace(/^\/+/, '')}`;
}

/**
 * 官方示例里 base_url 是 `https://api-inference.modelscope.cn/`（不带 /v1），
 * 代码自己拼 `v1/images/generations`。所以这里补一次 `/v1`：用户填带不带
 * `/v1` 都能工作，不会拼出 `.../v1/v1/...` 或漏掉版本段。
 */
export function modelScopeApiBase(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  return /\/v1$/i.test(normalized) ? normalized : `${normalized}/v1`;
}

function messageOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const v = value as { message?: unknown };
    if (typeof v.message === 'string') return v.message;
  }
  return '无详情';
}

/** 从非 2xx 响应抽出人能看懂的错，保留 `HTTP <status>` 供 normalizeError 识别。 */
async function httpFailure(res: TransportResponse): Promise<Error> {
  let detail = '';
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text) as { error?: unknown; message?: unknown };
      const err = json.error ?? json.message;
      detail = err === undefined ? text.slice(0, 300) : messageOf(err);
    } catch {
      detail = text.slice(0, 300);
    }
  } catch {
    detail = '';
  }
  return new Error(`HTTP ${res.status}: ${detail || '请求失败'}`.trim());
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error('aborted'));
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
  });
}

interface TaskResponse {
  task_status?: unknown;
  output_images?: unknown;
  images?: unknown;
  error?: unknown;
  message?: unknown;
}

function imageUrls(task: TaskResponse): string[] {
  const raw = task.output_images ?? task.images;
  if (typeof raw === 'string') return raw ? [raw] : [];
  if (Array.isArray(raw)) return raw.filter((u): u is string => typeof u === 'string' && u.length > 0);
  return [];
}

/**
 * 已收单、已有任务号：只查这一单，不重新提交。
 * 任何失败都包成 ProviderResultPendingError 留号，判 confirm。
 */
export async function pollModelScopeTask(
  transport: ModelScopeTransport,
  req: Pick<ModelScopeRequest, 'baseUrl' | 'apiKey' | 'signal'>,
  taskId: string,
): Promise<ModelScopeImage[]> {
  const sleep = transport.sleep ?? defaultSleep;
  const now = transport.now ?? Date.now;
  const deadline = now() + MODELSCOPE_MAX_WAIT_MS;

  try {
    while (true) {
      if (req.signal?.aborted) {
        // 用户取消只停本地轮询；上游那张图照样会跑完、照样计费
        throw new ProviderResultPendingError({
          taskId,
          detail: '本地已取消轮询，但上游任务仍在跑，可能会计费',
        });
      }
      if (now() > deadline) {
        throw new ProviderResultPendingError({ taskId, detail: '轮询超时，任务可能仍在跑' });
      }

      const res = await transport.request(joinUrl(modelScopeApiBase(req.baseUrl), `tasks/${encodeURIComponent(taskId)}`), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${req.apiKey}`,
          'X-ModelScope-Task-Type': 'image_generation',
        },
        signal: req.signal,
      });
      if (!res.ok) throw await httpFailure(res);
      const task = (await res.json()) as TaskResponse;

      if (task.task_status === 'SUCCEED') {
        const urls = imageUrls(task);
        if (urls.length === 0) {
          throw new ProviderResultPendingError({ taskId, detail: '上游说成功但没给图片地址' });
        }
        // 每次只提交一次（用户 2026-11-13 确认），上游给几张就收几张
        const dataUrls = await Promise.all(urls.map((url) => transport.fetchImage(url, req.signal)));
        return dataUrls.map((dataUrl) => ({ dataUrl }));
      }

      if (task.task_status === 'FAILED') {
        throw new ProviderResultPendingError({
          taskId,
          detail: `上游任务失败（${messageOf(task.error ?? task.message)}）`,
        });
      }

      // PENDING / RUNNING / 未知状态：继续等，不编进度
      await sleep(MODELSCOPE_POLL_INTERVAL_MS, req.signal);
    }
  } catch (error) {
    if (error instanceof ProviderResultPendingError) throw error;
    throw new ProviderResultPendingError({ taskId, detail: `轮询中断（${messageOf(error)}）` });
  }
}

/**
 * 提交一次并就地查单取图。只 POST 一次；拿到任务号后绝不再 POST。
 */
export async function generateModelScopeImages(
  transport: ModelScopeTransport,
  req: ModelScopeRequest,
): Promise<ModelScopeImage[]> {
  if (!req.apiKey.trim()) throw new Error('HTTP 401: 未配置 ModelScope Token');
  if (req.referenceCount > 0) {
    // 协议没声明参考图字段，宁可明确拒绝，也不能猜名字让上游误收单
    throw new Error('invalid_params：ModelScope 异步出图暂不支持参考图，请去掉参考图再生成');
  }

  const res = await transport.request(joinUrl(modelScopeApiBase(req.baseUrl), 'images/generations'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${req.apiKey}`,
      'X-ModelScope-Async-Mode': 'true',
    },
    body: JSON.stringify({ model: req.model, prompt: req.prompt }),
    signal: req.signal,
  });
  if (!res.ok) throw await httpFailure(res);

  const submitted = (await res.json()) as { task_id?: unknown; error?: unknown; message?: unknown };
  const taskId = typeof submitted.task_id === 'string' ? submitted.task_id.trim() : '';
  if (!taskId) {
    const rejection = submitted.error;
    if (rejection) throw new Error(messageOf(rejection));
    // POST 已 2xx = 上游收单。没有任务号也不能说「空结果」：钱可能已经扣了
    throw new ProviderResultPendingError({ detail: '提交成功但响应里没有 task_id，无法查单' });
  }

  req.onSubmitted?.(taskId);
  return pollModelScopeTask(transport, req, taskId);
}
