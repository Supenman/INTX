/**
 * 视频任务：提交即落 upstreamRef，查单/取回独立可恢复。
 *
 * 基座 `waitForVideoGenerationTask` 是 120×2.5s 的内存阻塞循环，刷新页面
 * 任务就没了（上游还在跑、钱已经付了）。这里不新增任何超时/次数边界：
 * 轮询循环仍由基座负责，我们只在「提交后」和「每次查单后」把任务落到台账。
 * 重启后 `videoHandleFromTask()` 能从台账重建查单句柄接着查。
 *
 * provider / model 存在 params.providerId / params.model 里（都是非敏感字段），
 * 不落 config —— AiConfig 里有 apiKey，绝不写盘。
 */
import { normalizeError, type GenerationParams, type Task } from '@/domain/task/model';
import { readTaskOutcome } from '@/domain/task/outcome';
import { browserTaskLog, commit, resumableTasks, type TaskLog } from './taskLog';

export type VideoProvider = 'openai' | 'gemini' | 'plugin';

/** 与 `services/api/video.ts` 的 VideoGenerationTask 结构一致，避免测试拉起 axios。 */
export interface VideoTaskHandle {
  id: string;
  provider: VideoProvider;
  model: string;
}

export interface VideoConfigView {
  model?: string;
  videoModel?: string;
  apiFormat?: string;
  size?: string;
  videoSeconds?: string;
  count?: string;
}

export interface VideoTransport {
  submit(config: VideoConfigView, prompt: string, signal?: AbortSignal): Promise<VideoTaskHandle>;
}

export type VideoPollState =
  | { status: 'pending' }
  | { status: 'completed' }
  | { status: 'failed'; error: string };

/** 只取可回溯的非敏感字段，config 里的 apiKey / baseUrl / 参考图一律不进快照。 */
export function videoTaskParams(config: VideoConfigView, prompt: string, handle?: VideoTaskHandle): GenerationParams {
  const params: GenerationParams = {
    kind: 'video',
    prompt,
    model: handle?.model || config.model || config.videoModel || '',
    providerId: handle?.provider || config.apiFormat || 'unknown',
    inputAssetIds: [],
  };
  if (config.size) params.aspectRatio = config.size;
  if (config.videoSeconds) params.durationSec = Number(config.videoSeconds) || undefined;
  if (config.count) params.count = Number(config.count) || undefined;
  return params;
}

/**
 * 提交视频任务。POST 之前先落一条 queued（含参数快照），拿到任务号后立刻
 * 补 upstreamRef 并进入 running/generating。**不在这里等待出片**。
 */
export async function submitVideoTask(input: {
  config: VideoConfigView;
  prompt: string;
  transport: VideoTransport;
  signal?: AbortSignal;
  nodeId?: string | null;
  log?: TaskLog;
}): Promise<{ handle: VideoTaskHandle; task: Task }> {
  const log = input.log ?? browserTaskLog;
  let task = log.create({
    kind: 'video',
    params: videoTaskParams(input.config, input.prompt),
    nodeId: input.nodeId ?? null,
  });
  // 先进入 submitting，失败时才能合法迁移到 failed（queued → failed 是非法迁移）。
  task = commit(log, task, 'running', { phase: 'submitting' });

  try {
    const handle = await input.transport.submit(input.config, input.prompt, input.signal);
    // POST 已收单：这一刻起任务号必须在盘上，刷新/崩溃后可凭它续查。
    // params 里的 model/provider 也只有拿到 handle 才知道，一并冻结进快照。
    const finalTask: Task = {
      ...task,
      params: videoTaskParams(input.config, input.prompt, handle),
      upstreamRef: handle.id,
      phase: 'generating',
    };
    log.update(finalTask);
    return { handle, task: finalTask };
  } catch (error) {
    // 提交阶段失败走 normalizeError：超时/5xx 判 submission_uncertain → confirm，
    // 连接被拒这种「没离开本机」才 allowed。
    task = commit(log, task, 'failed', {
      error: normalizeError(error, 'submitting'),
    });
    throw error;
  }
}

/**
 * 单次查单后把结论落到台账。循环由基座负责，这里不引入新的重试边界。
 *
 * 轮询被中断时**不标 canceled**：上游任务还在跑、钱已付，标 canceled 会
 * 让 readTaskOutcome 判 `not_charged/allowed`，诱导用户再提交一张。
 * 保持 running + upstreamRef，交给 resumableVideoTasks() 恢复。
 */
export function noteVideoPoll(
  state: VideoPollState,
  task: Task,
  log: TaskLog = browserTaskLog,
): Task {
  if (state.status === 'pending') return task;
  if (state.status === 'completed') {
    return commit(log, task, 'succeeded', { resultAssetIds: [] });
  }
  return commit(log, task, 'failed', {
    error: normalizeError(new Error(state.error), 'generating'),
  });
}

/** 从台账重建查单句柄（重启后接着查那一单，不重新提交）。 */
export function videoHandleFromTask(task: Task): VideoTaskHandle | null {
  if (task.kind !== 'video' || !task.upstreamRef) return null;
  const provider = task.params.providerId;
  if (provider !== 'openai' && provider !== 'gemini' && provider !== 'plugin') return null;
  return { id: task.upstreamRef, provider, model: task.params.model };
}

export function resumableVideoTasks(log: TaskLog = browserTaskLog) {
  return resumableTasks(log.list())
    .filter((task) => task.kind === 'video')
    .map((task) => ({
      task,
      handle: videoHandleFromTask(task),
      outcome: readTaskOutcome(task),
    }))
    .filter((entry) => entry.handle !== null);
}
