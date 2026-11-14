/** 任务写入完成才进入下一阶段；此层从不重试付费请求。 */
import { normalizeError, type GenerationParams, type Task, type TaskError } from '@/domain/task/model';
import { readTaskOutcome, type TaskOutcome } from '@/domain/task/outcome';
import { evidenceStore } from './taskEvidence';
import { ProviderResultPendingError, readTaskIdFromMessage } from './pendingResult';
import { browserTaskLog, commit, markInFlight, retainTaskWriteFailure, TaskPersistenceError, type LoggedTask, type TaskLog } from './taskLog';

export interface RunWithTaskInput<T> {
  params: GenerationParams;
  submit: (hooks: SubmitHooks) => Promise<T>;
  nodeId?: string | null;
  signal?: AbortSignal;
  log?: TaskLog;
  resultIds?: (result: T) => string[];
}
export interface SubmitHooks { onSubmitted(upstreamRef: string): Promise<void> }
export interface TaskRunResult<T> { result: T; task: LoggedTask; outcome: TaskOutcome | null }

export class GenerationTaskError extends Error {
  readonly taskId: string;
  readonly upstreamRef: string | null;
  readonly outcome: TaskOutcome | null;
  readonly errorCode: TaskError['code'];
  constructor(opts: { message: string; task: Task; outcome: TaskOutcome | null; code: TaskError['code'] }) {
    super(opts.message);
    this.name = 'GenerationTaskError';
    this.taskId = opts.task.id;
    this.upstreamRef = opts.task.upstreamRef;
    this.outcome = opts.outcome;
    this.errorCode = opts.code;
  }
}
export function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted) || (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && (error.name === 'AbortError' || error.name === 'CanceledError'));
}

export async function inspectRunWithTask<T>(input: RunWithTaskInput<T>): Promise<TaskRunResult<T>> {
  const log = input.log ?? browserTaskLog;
  let task: LoggedTask;
  // 纯本地失败不进入 normalizeError('submitting')，此处从未调用厂商。
  try {
    task = await log.create({ kind: input.params.kind, params: input.params, nodeId: input.nodeId ?? null });
    task = await commit(log, task, 'running', { phase: 'submitting' });
  } catch (error) {
    if (error instanceof TaskPersistenceError && error.task) throw retainTaskWriteFailure(log, error, error.task, false);
    throw error;
  }
  markInFlight(task.id, true);
  let submitted = false;
  const hooks: SubmitHooks = {
    async onSubmitted(upstreamRef) {
      const ref = upstreamRef.trim();
      if (!ref) return;
      // 先留内存证据：落盘失败也不能丢掉已经知道的任务号。
      task = { ...task, upstreamRef: ref, phase: 'generating' };
      // 2.2b：响应到达这一刻先落本机证据，主台账确认后再清。
      // 请求已经发出，证据写失败绝不能中断后续流程、把本地故障伪装成提交失败。
      try {
        await evidenceStore().put({ taskId: task.id, upstreamRef: ref, desired: task, savedAt: Date.now() });
      } catch { /* 退回当前进程内存证据；不能承诺重启一定找回。 */ }
      task = await log.update(task);
      // 主台账已确认这个号，本机证据完成使命；清理失败时下次启动会按「已确认」再清一次。
      void evidenceStore().remove(task.id).catch(() => {});
    },
  };
  try {
    // 保存等待期间也可能被取消：真正提交前再次检查，不能仍用函数入口快照。
    if (input.signal?.aborted) {
      task = await commit(log, task, 'canceled', { error: { code: 'unknown', message: '已取消，尚未提交' } });
      throw new DOMException('Aborted', 'AbortError');
    }
    submitted = true;
    const result = await input.submit(hooks);
    task = await commit(log, task, 'succeeded', { resultAssetIds: input.resultIds?.(result) ?? [] });
    return { result, task, outcome: readTaskOutcome(task) };
  } catch (error) {
    if (error instanceof TaskPersistenceError) {
      throw retainTaskWriteFailure(log, error, error.task ?? task, submitted);
    }
    if (!submitted) throw error;
    const pending = error instanceof ProviderResultPendingError ? error : task.upstreamRef && isAbort(error, input.signal)
      ? new ProviderResultPendingError({ taskId: task.upstreamRef, detail: '本地已取消轮询，但上游任务仍在跑，可能会计费' }) : null;
    const normalized = pending ? { code: 'provider_result_pending' as const, message: pending.message } : normalizeError(error, task.phase);
    const ref = pending?.taskId ?? (normalized.code === 'provider_result_pending' ? readTaskIdFromMessage(error instanceof Error ? error.message : String(error)) : null);
    try {
      task = await commit(log, task, 'failed', { error: normalized, ...(ref ? { upstreamRef: ref } : {}) });
    } catch (saveError) {
      if (saveError instanceof TaskPersistenceError) throw retainTaskWriteFailure(log, saveError, saveError.task ?? task, true);
      throw saveError;
    }
    throw new GenerationTaskError({ message: normalized.message, task, outcome: readTaskOutcome(task), code: normalized.code });
  } finally {
    markInFlight(task.id, false);
  }
}
export async function runWithTask<T>(input: RunWithTaskInput<T>): Promise<T> {
  return (await inspectRunWithTask(input)).result;
}
