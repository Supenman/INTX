/** 视频提交与查单的可等待任务写入，不改变轮询/厂商协议。 */
import { normalizeError, type GenerationParams, type Task } from '@/domain/task/model';
import { readTaskOutcome } from '@/domain/task/outcome';
import { evidenceStore } from './taskEvidence';
import { browserTaskLog, commit, resumableTasks, retainTaskWriteFailure, TaskPersistenceError, type LoggedTask, type TaskLog } from './taskLog';

export type VideoProvider = 'openai' | 'gemini' | 'plugin' | 'runninghub';
export interface VideoTaskHandle { id: string; provider: VideoProvider; model: string }
export interface VideoConfigView { model?: string; videoModel?: string; apiFormat?: string; size?: string; videoSeconds?: string; count?: string }
export interface VideoTransport { submit(config: VideoConfigView, prompt: string, signal?: AbortSignal): Promise<VideoTaskHandle> }
export type VideoPollState = { status: 'pending' } | { status: 'completed' } | { status: 'failed'; error: string };

export function videoTaskParams(config: VideoConfigView, prompt: string, handle?: VideoTaskHandle): GenerationParams {
  const params: GenerationParams = {
    kind: 'video', prompt, model: handle?.model || config.model || config.videoModel || '',
    providerId: handle?.provider || config.apiFormat || 'unknown', inputAssetIds: [],
  };
  if (config.size) params.aspectRatio = config.size;
  if (config.videoSeconds) params.durationSec = Number(config.videoSeconds) || undefined;
  if (config.count) params.count = Number(config.count) || undefined;
  return params;
}

export async function submitVideoTask(input: {
  config: VideoConfigView; prompt: string; transport: VideoTransport; signal?: AbortSignal;
  nodeId?: string | null; log?: TaskLog;
}): Promise<{ handle: VideoTaskHandle; task: LoggedTask }> {
  const log = input.log ?? browserTaskLog;
  let task: LoggedTask;
  try {
    task = await log.create({ kind: 'video', params: videoTaskParams(input.config, input.prompt), nodeId: input.nodeId ?? null });
    task = await commit(log, task, 'running', { phase: 'submitting' });
  } catch (error) {
    if (error instanceof TaskPersistenceError && error.task) throw retainTaskWriteFailure(log, error, error.task, false);
    throw error;
  }
  let submitted = false;
  try {
    if (input.signal?.aborted) {
      task = await commit(log, task, 'canceled', { error: { code: 'unknown', message: '已取消，尚未提交' } });
      throw new DOMException('Aborted', 'AbortError');
    }
    submitted = true;
    const handle = await input.transport.submit(input.config, input.prompt, input.signal);
    task = { ...task, params: videoTaskParams(input.config, input.prompt, handle), upstreamRef: handle.id, phase: 'generating' };
    // 2.2b：视频也是提交即收单，同样在响应到达时先落本机证据；请求已发出，写失败不中断流程。
    try {
      await evidenceStore().put({ taskId: task.id, upstreamRef: handle.id, desired: task, savedAt: Date.now() });
    } catch { /* 退回当前进程内存证据；不能承诺重启一定找回。 */ }
    task = await log.update(task);
    void evidenceStore().remove(task.id).catch(() => {});
    return { handle, task };
  } catch (error) {
    if (error instanceof TaskPersistenceError) throw retainTaskWriteFailure(log, error, error.task ?? task, submitted);
    if (!submitted) throw error;
    try { task = await commit(log, task, 'failed', { error: normalizeError(error, 'submitting') }); }
    catch (saveError) {
      if (saveError instanceof TaskPersistenceError) throw retainTaskWriteFailure(log, saveError, saveError.task ?? task, true);
      throw saveError;
    }
    throw error;
  }
}

/** 当前版本由调用方读取；非法迁移/保存失败不能假报成功。 */
export async function noteVideoPoll(state: VideoPollState, task: LoggedTask, log: TaskLog = browserTaskLog): Promise<LoggedTask> {
  // 原单已经确认成功时，只返回查到的结果，不再次迁移终态。
  if (state.status === 'pending' || (state.status === 'completed' && task.status === 'succeeded')) return task;
  try {
    return await commit(log, task, state.status === 'completed' ? 'succeeded' : 'failed', state.status === 'completed'
      ? { resultAssetIds: [] } : { error: normalizeError(new Error(state.error), 'generating') });
  } catch (error) {
    if (error instanceof TaskPersistenceError) throw retainTaskWriteFailure(log, error, error.task ?? task, true);
    throw error;
  }
}
export function videoHandleFromTask(task: Task): VideoTaskHandle | null {
  if (task.kind !== 'video' || !task.upstreamRef) return null;
  const provider = task.params.providerId;
  return provider === 'openai' || provider === 'gemini' || provider === 'plugin' || provider === 'runninghub'
    ? { id: task.upstreamRef, provider, model: task.params.model } : null;
}
export async function resumableVideoTasks(log: TaskLog = browserTaskLog) {
  return resumableTasks(await log.list()).filter((task) => task.kind === 'video').map((task) => ({ task, handle: videoHandleFromTask(task), outcome: readTaskOutcome(task) })).filter((entry) => entry.handle !== null);
}
