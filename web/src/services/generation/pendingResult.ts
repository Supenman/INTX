/**
 * 「上游已收单、本地没拿到产物」的判定与留证。
 *
 * 真机教训（旧 INTX，两轮修复）：ModelScope API-Inference 异步出图 POST 2xx
 * 只回 `{ task_id }`，同步适配器把「响应里没有 data 数组」当成空结果，
 * 归成 unknown → 三态 allowed → 卡片写「重置状态，原样重试是合理的」，
 * 用户点一下就再买一张。所以 **HTTP 2xx 且没有图，一律按已收单处理**，
 * 留任务号、判 confirm，绝不退化成 allowed。
 *
 * 这里只做「分类 + 留证」，不做查单取图。查单协议由第 3 步的
 * ModelScope 适配器移植负责，别在这里偷偷再发一次请求。
 */

/** 上游明确收单但本地没拿到产物。message 以固定前缀开头，供 normalizeError 兜底识别。 */
export class ProviderResultPendingError extends Error {
  readonly code = 'provider_result_pending' as const;
  readonly taskId: string | null;
  readonly rawResponse: string;

  constructor(opts: { taskId?: string | null; rawResponse?: string; detail?: string }) {
    const taskId = opts.taskId?.trim() || null;
    const detail = opts.detail || '异步服务只回了任务号，图要轮询取';
    super(
      taskId
        ? `上游已经收单，这次可能已经计费，但本地没拿到图。别直接重试，那会再买一张；先拿任务号 ${taskId} 去厂商后台确认那次有没有出图。上游说：${detail}`
        : `上游已经收单，这次可能已经计费，但本地没拿到图。别直接重试，那会再买一张；先去厂商后台确认那次有没有出图。上游说：${detail}`,
    );
    this.name = 'ProviderResultPendingError';
    this.taskId = taskId;
    this.rawResponse = opts.rawResponse || '';
  }
}

/** 响应里可能放任务号的位置。只认明确的异步字段，不把普通响应 id 当任务号。 */
const TASK_ID_KEYS = ['task_id', 'taskId', 'job_id', 'request_id'] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function readUpstreamTaskId(payload: unknown): string | null {
  const root = asRecord(payload);
  if (!root) return null;
  for (const key of TASK_ID_KEYS) {
    const value = readString(root[key]);
    if (value) return value;
  }
  for (const nestedKey of ['task', 'output', 'data', 'result']) {
    const nested = asRecord(root[nestedKey]);
    if (!nested) continue;
    for (const key of TASK_ID_KEYS) {
      const value = readString(nested[key]);
      if (value) return value;
    }
    // Gemini / 部分厂商把操作名放 name 里，只有明确带异步状态时才认
    if (readString(nested.name) && (nested.status || nested.done !== undefined || nested.task_status)) {
      return readString(nested.name);
    }
  }
  return null;
}

const IMAGE_LIST_KEYS = ['data', 'images', 'results', 'output_images'] as const;

/** 2xx 响应里有没有可直接落地的图。output_images 里的 URL 也算出图线索。 */
export function hasImageData(payload: unknown): boolean {
  const root = asRecord(payload);
  if (!root) return false;
  for (const key of IMAGE_LIST_KEYS) {
    const list = root[key];
    if (Array.isArray(list) && list.length > 0) return true;
  }
  return false;
}

/** 上游明确拒绝（业务错误码 / error 字段）——这类不是「已收单」，交给 normalizeError 分类。 */
export function isExplicitRejection(payload: unknown): boolean {
  const root = asRecord(payload);
  if (!root) return false;
  if (typeof root.code === 'number' && root.code !== 0) return true;
  if (root.error) return true;
  return false;
}

export type ImagePayloadVerdict = 'ready' | 'rejected' | 'pending';

export function classifyImagePayload(payload: unknown): ImagePayloadVerdict {
  if (isExplicitRejection(payload)) return 'rejected';
  if (hasImageData(payload)) return 'ready';
  return 'pending';
}

/**
 * 脱敏留证：只记字段名和极短的标量值，绝不写 base64 / dataUrl / 完整 URL /
 * Authorization。留给用户看的是「上游回了什么形状」，不是把响应体整个搬进本地库。
 */
export function describePayload(payload: unknown): string {
  const root = asRecord(payload);
  if (!root) return `[${typeof payload}]`;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(root)) {
    if (Array.isArray(value)) {
      parts.push(`${key}:[${value.length}]`);
    } else if (asRecord(value)) {
      parts.push(`${key}:{${Object.keys(asRecord(value)!).join(',')}}`);
    } else if (typeof value === 'string') {
      parts.push(`${key}:${value.length > 48 ? `<${value.length} chars>` : value}`);
    } else {
      parts.push(`${key}:${String(value)}`);
    }
    if (parts.length >= 20) break;
  }
  return `{${parts.join(', ')}}`;
}

/**
 * 从「上游已经收单」的人话文案里把任务号捞回来。
 *
 * 错误对象跨层（例如被 axios 包一层、或被 JSON 序列化）后只剩 message，
 * 但真机最要紧的就是这个号：用户要拿它去厂商后台查那一单有没有出图。
 * 捞不到就返回 null，绝不猜一个。
 */
export function readTaskIdFromMessage(message: string): string | null {
  const match = /任务号\s+([^\s，。；]+)\s+去厂商后台/.exec(message);
  return match?.[1]?.trim() || null;
}

/** 已收单但没产物的响应统一转成留证错误。 */
export function pendingResultFrom(payload: unknown): ProviderResultPendingError {
  return new ProviderResultPendingError({
    taskId: readUpstreamTaskId(payload),
    rawResponse: describePayload(payload),
    detail: readUpstreamTaskId(payload)
      ? '异步服务只回了任务号，图要轮询取'
      : '响应 2xx 但没有任何图片数据（可能是异步受理，也可能计费后没返回）',
  });
}
