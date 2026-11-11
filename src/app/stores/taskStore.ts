import { create } from 'zustand';
import {
  createTask,
  normalizeError,
  setProgress,
  transition,
  type CostRecord,
  type GenerationParams,
  type Task,
  type TaskError,
  type TaskKind,
  type TaskPhase,
} from '@/domain';

/**
 * 任务状态。
 *
 * 关键约束：所有状态迁移都走 domain 的 `transition()`，
 * 这里不自己拼对象。终态不可逆转、非法迁移被拒绝这两条靠领域层保证。
 *
 * 进度：`upstreamProgress` 为 null 表示"不确定"，UI 用不确定态动画。
 * 没有假进度条。
 */

export interface TaskState {
  tasks: Record<string, Task>;
}

/**
 * 注意：Task 是可序列化的只读快照（params 里有 readonly 字段），
 * 与 immer 的 WritableDraft 不兼容，所以这里不用 immer，直接换引用。
 * 任务数量在百级，浅拷贝成本可以忽略。
 */
export const useTaskStore = create<TaskState>()(() => ({ tasks: {} }));

export interface SubmitInput {
  nodeId: string | null;
  kind: TaskKind;
  params: GenerationParams;
}

export function submitTask(input: SubmitInput): string {
  const task = createTask({ kind: input.kind, params: input.params, nodeId: input.nodeId });
  useTaskStore.setState((s) => ({ ...s, tasks: { ...s.tasks, [task.id]: task } }));
  return task.id;
}

function patchTask(id: string, fn: (t: Task) => Task): void {
  useTaskStore.setState((s) => {
    const current = s.tasks[id];
    if (!current) return s;
    return { ...s, tasks: { ...s.tasks, [id]: fn(current) } };
  });
}

export function markRunning(id: string, opts: { upstreamRef?: string | null } = {}): void {
  patchTask(id, (t) => {
    const r = transition(t, 'running', { phase: 'submitting', upstreamRef: opts.upstreamRef });
    return r.ok ? r.value : t;
  });
}

export function markPhase(id: string, phase: TaskPhase): void {
  patchTask(id, (t) => (t.status === 'running' ? { ...t, phase } : t));
}

export function markProgress(id: string, value: number | null): void {
  patchTask(id, (t) => {
    const r = setProgress(t, value);
    return r.ok ? r.value : t;
  });
}

export function markSucceeded(id: string, resultAssetIds: string[], cost?: CostRecord | null): void {
  patchTask(id, (t) => {
    const r = transition(t, 'succeeded', { resultAssetIds, cost });
    return r.ok ? r.value : t;
  });
}

export function markFailed(id: string, error: unknown): void {
  patchTask(id, (t) => {
    const normalized: TaskError = isTaskError(error) ? error : normalizeError(error);
    const r = transition(t, 'failed', { error: normalized });
    return r.ok ? r.value : t;
  });
}

export function markCanceled(id: string): void {
  patchTask(id, (t) => {
    const r = transition(t, 'canceled');
    return r.ok ? r.value : t;
  });
}

/** 重试：回到队列，attempt 递增，参数快照保留。 */
export function retryTask(id: string): boolean {
  const current = useTaskStore.getState().tasks[id];
  if (!current) return false;
  const r = transition(current, 'queued');
  if (!r.ok) return false;
  patchTask(id, () => r.value);
  return true;
}

export function isTaskError(v: unknown): v is TaskError {
  return (
    typeof v === 'object' &&
    v !== null &&
    'code' in v &&
    'retryable' in v &&
    typeof (v as TaskError).retryable === 'boolean'
  );
}

/** 某节点最近一次任务。 */
export function latestTaskForNode(tasks: Record<string, Task>, nodeId: string): Task | undefined {
  let best: Task | undefined;
  for (const t of Object.values(tasks)) {
    if (t.nodeId !== nodeId) continue;
    // 同一毫秒内创建的任务 createdAt 相同，用 id 兜底比较避免前后不一致
    if (!best || t.createdAt > best.createdAt || (t.createdAt === best.createdAt && t.id > best.id)) {
      best = t;
    }
  }
  return best;
}
