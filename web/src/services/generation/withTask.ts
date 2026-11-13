/**
 * 生成链路的任务层包装。基座 `image.ts` 的每个生成/编辑调用都过这里，
 * 调用点（含 3476 行的 project.tsx）一行都不用改。
 *
 * 硬保证：上游已收单（2xx 但没产物 / 只回 task_id）→ `provider_result_pending`
 * + `upstreamRef` → `readTaskOutcome()` 判 `confirm`，绝不退化成 `allowed`。
 */
import {
  normalizeError,
  type GenerationParams,
  type Task,
  type TaskError,
} from '@/domain/task/model';
import { readTaskOutcome, type TaskOutcome } from '@/domain/task/outcome';
import { ProviderResultPendingError, readTaskIdFromMessage } from './pendingResult';
import { browserTaskLog, commit, type TaskLog } from './taskLog';

export interface RunWithTaskInput<T> {
  /** 提交那一刻冻结的参数快照。不得含 apiKey / baseUrl / 图片 dataUrl。 */
  params: GenerationParams;
  /** 真实 HTTP 提交。这里不再包一层重试——重试由人按三态决定。 */
  submit: () => Promise<T>;
  nodeId?: string | null;
  signal?: AbortSignal;
  log?: TaskLog;
  /** 成功时把产物引用写进任务；缺省为空数组。 */
  resultIds?: (result: T) => string[];
}

export interface TaskRunResult<T> {
  result: T;
  task: Task;
  outcome: TaskOutcome | null;
}

/** 抛给上层（节点错误卡片）的统一错误，带人话文案与三态结论。 */
export class GenerationTaskError extends Error {
  readonly taskId: string;
  readonly upstreamRef: string | null;
  readonly outcome: TaskOutcome | null;
  readonly errorCode: TaskError['code'];

  constructor(opts: {
    message: string;
    task: Task;
    outcome: TaskOutcome | null;
    code: TaskError['code'];
  }) {
    super(opts.message);
    this.name = 'GenerationTaskError';
    this.taskId = opts.task.id;
    this.upstreamRef = opts.task.upstreamRef;
    this.outcome = opts.outcome;
    this.errorCode = opts.code;
  }
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'CanceledError');
}

/**
 * 完整跑一次并回传任务与三态结论。测试用这个；基座薄壳用 `runWithTask`。
 */
export async function inspectRunWithTask<T>(input: RunWithTaskInput<T>): Promise<TaskRunResult<T>> {
  const log = input.log ?? browserTaskLog;
  let task = log.create({
    kind: input.params.kind,
    params: input.params,
    nodeId: input.nodeId ?? null,
  });
  task = commit(log, task, 'running', { phase: 'submitting' });

  try {
    const result = await input.submit();
    const ids = input.resultIds?.(result) ?? [];
    task = commit(log, task, 'succeeded', { resultAssetIds: ids });
    return { result, task, outcome: readTaskOutcome(task) };
  } catch (error) {
    if (isAbort(error, input.signal)) {
      // 用户主动取消 / 请求没发出去：没扣钱，直接重发是安全的
      task = commit(log, task, 'canceled', {
        error: { code: 'unknown', message: '已取消' },
      });
      throw error;
    }

    if (error instanceof ProviderResultPendingError) {
      // 上游明确收单：留任务号，判 confirm。没有任务号也靠 code 保住 confirm。
      task = commit(log, task, 'failed', {
        error: { code: 'provider_result_pending', message: error.message },
        upstreamRef: error.taskId,
      });
      throw new GenerationTaskError({
        message: error.message,
        task,
        outcome: readTaskOutcome(task),
        code: 'provider_result_pending',
      });
    }

    const normalized = normalizeError(error, task.phase);
    // 错误被跨层转成普通 Error 时，文案里仍带着「上游已经收单」和任务号。
    // 这时也要把 upstreamRef 捞回来，否则用户拿不到号去厂商后台查那一单。
    const recoveredRef = normalized.code === 'provider_result_pending'
      ? error instanceof ProviderResultPendingError
        ? error.taskId
        : readTaskIdFromMessage(error instanceof Error ? error.message : String(error))
      : null;
    task = commit(log, task, 'failed', {
      error: normalized,
      ...(recoveredRef ? { upstreamRef: recoveredRef } : {}),
    });
    throw new GenerationTaskError({
      message: normalized.message,
      task,
      outcome: readTaskOutcome(task),
      code: normalized.code,
    });
  }
}

/** 基座薄壳用：签名上等价于原来的生成函数，返回原结果类型。 */
export async function runWithTask<T>(input: RunWithTaskInput<T>): Promise<T> {
  return (await inspectRunWithTask(input)).result;
}
