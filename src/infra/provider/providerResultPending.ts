/**
 * 「上游已经收单、本地却没拿到产物」的结构化错误。
 *
 * 为什么不能用普通 `new Error('...')`：普通错误会被 `normalizeError` 归成
 * `unknown`，三态判定给 `allowed`，失败卡片就写「重置状态，原样重试是合理的」。
 * 真机上这一句等于让用户再买一张图。这里必须把两样东西带出去：
 *
 * 1. `code: provider_result_pending` → 三态 confirm，按钮变「确认后重发」；
 * 2. `taskId` → 写进任务的 `upstreamRef`，用户能拿它去厂商后台查那次单。
 *
 * `rawResponse` 只用于留证（截断 + 脱敏），不参与判定，也不落盘到资产里。
 */

const MAX_RAW = 300;

/** 上游响应里可能夹带回显的凭据，留证前抹掉。 */
function redact(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***')
    // 别只认十六进制：Token 可能含非 hex 字符，漏掉一个就是凭据泄漏
    .replace(/ms-[a-z0-9-]{20,}/gi, '***')
    .slice(0, MAX_RAW);
}

export interface ProviderResultPendingOptions {
  taskId?: string | null;
  rawResponse?: string;
  /** 上游返回的具体失败原因，例如 task_status=FAILED 时的详情 */
  detail?: string;
}

export class ProviderResultPendingError extends Error {
  readonly code = 'provider_result_pending' as const;
  readonly taskId: string | null;
  readonly rawResponse: string;

  constructor(opts: ProviderResultPendingOptions = {}) {
    const id = typeof opts.taskId === 'string' && opts.taskId.trim() ? opts.taskId.trim() : null;
    const where = id ? `拿任务号 ${id} 去厂商后台` : '去厂商后台';
    const detail = opts.detail ? ` 上游说：${redact(opts.detail)}` : '';
    super(
      `上游已经收单，这次可能已经计费，但本地没拿到图。别直接重试，那会再买一张；` +
        `先${where}确认那次有没有出图。${detail}`,
    );
    this.name = 'ProviderResultPendingError';
    this.taskId = id;
    this.rawResponse = opts.rawResponse ? redact(opts.rawResponse) : '';
  }
}

export function isProviderResultPending(e: unknown): e is ProviderResultPendingError {
  return e instanceof ProviderResultPendingError || (e instanceof Error && e.name === 'ProviderResultPendingError');
}
