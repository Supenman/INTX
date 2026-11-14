/** 任务 repository 的应用适配：Promise 成功才表示本地事务提交，Zustand 只保存视图。 */
import { create } from 'zustand';

import { createTask, recoverPendingResult, transition, type CreateTaskInput, type Task, type TaskTransitionError, type RecoveryError } from '@/domain/task/model';
import { readTaskOutcome } from '@/domain/task/outcome';
import type { StorageError, TaskRepository, Stored } from '@/application/ports/taskRepository';
import { createIndexedDBTaskRepository } from '@/infrastructure/storage/indexeddb-task-repository';
import { createMemoryTaskRepository } from '@/infrastructure/storage/memory-task-repository';
import { evidenceStore, type TaskEvidence } from './taskEvidence';

export const TASK_LOG_KEY = 'infinite-canvas:intx_task_log';
export type LoggedTask = Task & { revision: number };
export type TaskWriteError = StorageError | TaskTransitionError | RecoveryError;

export class TaskPersistenceError extends Error {
  readonly name = 'TaskPersistenceError';
  constructor(readonly detail: TaskWriteError, public task?: LoggedTask) {
    super('message' in detail ? detail.message : '任务版本冲突，本地保存未完成，请重新读取后核对');
  }
  get taskId(): string | undefined { return this.task?.id; }
  get upstreamRef(): string | null { return this.task?.upstreamRef ?? null; }
  get outcome() { return this.task ? readTaskOutcome(this.task) : null; }
}

export interface TaskLog {
  create(input: CreateTaskInput): Promise<LoggedTask>;
  update(task: LoggedTask): Promise<LoggedTask>;
  get(id: string): Promise<LoggedTask | null>;
  findByUpstreamRef(ref: string): Promise<LoggedTask | null>;
  list(): Promise<readonly LoggedTask[]>;
}

const logged = ({ value, revision }: Stored<Task>): LoggedTask => ({ ...value, revision });
const payload = ({ revision: _revision, ...task }: LoggedTask): Task => task;

/** 不吞 repository 错误；每次写入只发布事务已经确认的任务。 */
export function createTaskLog(repository: TaskRepository, saved?: (task: LoggedTask) => void): TaskLog {
  const accept = (result: Awaited<ReturnType<TaskRepository['create']>>, attempted?: LoggedTask) => {
    if (!result.ok) throw new TaskPersistenceError(result.error, attempted);
    const task = logged(result.value);
    saved?.(task);
    return task;
  };
  const log: TaskLog = {
    async create(input) {
      const task = createTask(input);
      return accept(await repository.create(task), { ...task, revision: 0 });
    },
    async update(task) {
      return accept(await repository.replace(payload(task), task.revision), task);
    },
    async get(id) {
      const result = await repository.get(id);
      if (!result.ok) throw new TaskPersistenceError(result.error);
      return result.value ? logged(result.value) : null;
    },
    async list() {
      const result = await repository.list();
      if (!result.ok) throw new TaskPersistenceError(result.error);
      return result.value.map(logged);
    },
    async findByUpstreamRef(ref) {
      return (await log.list()).find((task) => task.upstreamRef === ref) ?? null;
    },
  };
  return log;
}

export interface UnsavedTask { desired: LoggedTask; evidence: LoggedTask; error: string }
interface RecoveredAssets { upstreamRef: string; assetIds: string[] }
interface TaskLogState {
  tasks: LoggedTask[];
  hydrated: boolean;
  loading: boolean;
  loadError: string | null;
  unsaved: Record<string, UnsavedTask>;
  recovered: Record<string, RecoveredAssets>;
  inFlightIds: string[];
}
export const useTaskLogStore = create<TaskLogState>(() => ({
  tasks: [], hydrated: false, loading: false, loadError: null, unsaved: {}, recovered: {}, inFlightIds: [],
}));

/** 同一进程内已取回、但任务尚未核销的产物素材；重试只补任务，不重新查单或重复创建素材。 */
export function recoveredAssetIds(taskId: string, upstreamRef: string | null): string[] {
  const entry = useTaskLogStore.getState().recovered[taskId];
  return entry && entry.upstreamRef === (upstreamRef ?? "") ? entry.assetIds : [];
}
export function rememberRecoveredAssets(taskId: string, upstreamRef: string | null, assetIds: readonly string[]): void {
  useTaskLogStore.setState((state) => ({ recovered: { ...state.recovered, [taskId]: { upstreamRef: upstreamRef ?? "", assetIds: [...assetIds] } } }));
}
export function forgetRecoveredAssets(taskId: string): void {
  if (!useTaskLogStore.getState().recovered[taskId]) return;
  useTaskLogStore.setState((state) => {
    const recovered = { ...state.recovered };
    delete recovered[taskId];
    return { recovered };
  });
}

export const browserTaskLog = createTaskLog(createIndexedDBTaskRepository(), (task) => {
  // 主台账已确认这个任务号，本机证据可以清掉；清理失败不影响已确认的台账。
  if (task.upstreamRef) void evidenceStore().remove(task.id).catch(() => {});
  useTaskLogStore.setState((state) => {
    const unsaved = { ...state.unsaved };
    delete unsaved[task.id];
    const previous = state.tasks.find((item) => item.id === task.id);
    // 异步响应晚到不能让订阅视图回退到旧 revision。
    const tasks = previous && previous.revision > task.revision ? state.tasks
      : [task, ...state.tasks.filter((item) => item.id !== task.id)].sort((a, b) => b.createdAt - a.createdAt);
    return { tasks, unsaved };
  });
});
export const createMemoryTaskLog = (): TaskLog => createTaskLog(createMemoryTaskRepository());

let loading: Promise<void> | null = null;

/** 重启后把未确认的本机证据还原成「只重试本地保存」，绝不退化成可重发。 */
export function restoreUnsaved(tasks: readonly LoggedTask[], evidences: readonly TaskEvidence[]): Record<string, UnsavedTask> {
  const out: Record<string, UnsavedTask> = {};
  for (const entry of evidences) {
    const saved = tasks.find((task) => task.id === entry.taskId);
    if (saved?.upstreamRef) continue;
    const desired = { ...entry.desired, upstreamRef: entry.upstreamRef };
    const evidence: LoggedTask = {
      ...desired, status: 'failed', phase: null,
      error: { code: 'provider_result_pending', message: '上游已收单，但任务台账未确认；只重试本地保存，不要重新提交' },
    };
    out[entry.taskId] = { desired, evidence, error: '本机已保留任务号，但任务台账未确认；只重试本地保存，不要重新提交' };
  }
  return out;
}

export function loadTaskLog(): Promise<void> {
  if (loading) return loading;
  useTaskLogStore.setState({ loading: true, loadError: null });
  loading = Promise.all([browserTaskLog.list(), evidenceStore().list()]).then(([tasks, evidences]) => {
    const restored = restoreUnsaved(tasks, evidences);
    useTaskLogStore.setState((state) => {
      const merged = new Map(tasks.map((task) => [task.id, task]));
      for (const task of state.tasks) {
        if ((merged.get(task.id)?.revision ?? -1) < task.revision) merged.set(task.id, task);
      }
      // 当前进程里的内存证据比磁盘证据更新，同 id 时以内存为准。
      return {
        tasks: [...merged.values()].sort((a, b) => b.createdAt - a.createdAt),
        hydrated: true,
        unsaved: { ...restored, ...state.unsaved },
      };
    });
    for (const entry of evidences) {
      if (tasks.some((task) => task.id === entry.taskId && task.upstreamRef)) void evidenceStore().remove(entry.taskId).catch(() => {});
    }
  }).catch((error: unknown) => {
    useTaskLogStore.setState({ loadError: error instanceof Error ? error.message : '任务读取失败', hydrated: false });
  }).finally(() => {
    loading = null;
    useTaskLogStore.setState({ loading: false });
  });
  return loading;
}

/** 未提交的存储错误不送进网络分类；已提交的错误保留内存证据，绝不能变 allowed。 */
export function retainTaskWriteFailure(log: TaskLog, error: TaskPersistenceError, desired: LoggedTask, submitted: boolean): TaskPersistenceError {
  const evidence: LoggedTask = submitted ? {
    ...desired, status: 'failed', phase: null,
    error: desired.resultAssetIds.length ? { code: 'local_save_failed', message: '产物已返回，但任务记录保存失败；只重试本地保存，不要重新生成' }
      : desired.upstreamRef ? { code: 'provider_result_pending', message: '上游已经收单，但任务号未能保存；请复制任务号，只重试本地保存' }
      : { code: 'submission_uncertain', message: '请求可能已提交，但任务记录保存失败；不要重新提交' },
  } : desired;
  error.task = evidence;
  error.message = submitted ? `${error.message}；${evidence.error?.message ?? '上游可能已收单，不要重新提交'}${evidence.upstreamRef ? `（任务号：${evidence.upstreamRef}）` : ''}`
    : `${error.message}；尚未提交，请先处理本地保存`;
  if (log === browserTaskLog) useTaskLogStore.setState((state) => ({
    unsaved: { ...state.unsaved, [desired.id]: { desired, evidence, error: error.message } },
  }));
  return error;
}

/** 仅补写内存里已经知道的快照；不调用任何 transport，不覆盖冲突的新版本。 */
export async function retryTaskSave(id: string): Promise<void> {
  let pending = useTaskLogStore.getState().unsaved[id];
  if (!pending) return;
  try {
    const current = await browserTaskLog.get(id);
    if (current) await browserTaskLog.update(pending.desired);
    else {
      const { revision: _revision, ...value } = pending.desired;
      const created = await browserTaskLog.create({ id: value.id, kind: value.kind, params: value.params, nodeId: value.nodeId, now: value.createdAt });
      // 创建已经提交：后续补写失败必须保留这个确认过的新 revision。
      const advanced = { ...pending, desired: { ...value, revision: created.revision } };
      pending = advanced;
      useTaskLogStore.setState((state) => ({ unsaved: { ...state.unsaved, [id]: advanced } }));
      await browserTaskLog.update(pending.desired);
    }
    forgetRecoveredAssets(id);
  } catch (error) {
    useTaskLogStore.setState((state) => ({ unsaved: { ...state.unsaved, [id]: { ...pending, error: error instanceof Error ? error.message : '任务保存失败' } } }));
    throw error;
  }
}

export async function commit(log: TaskLog, task: LoggedTask, to: Parameters<typeof transition>[1], opts: Parameters<typeof transition>[2] = {}): Promise<LoggedTask> {
  const result = transition(task, to, opts);
  if (!result.ok) throw new TaskPersistenceError(result.error, task);
  return log.update({ ...result.value, revision: task.revision });
}

export async function commitRecovered(log: TaskLog, task: LoggedTask, resultAssetIds: readonly string[]): Promise<LoggedTask> {
  const result = task.status === 'running' ? transition(task, 'succeeded', { resultAssetIds: [...resultAssetIds] }) : recoverPendingResult(task, { resultAssetIds });
  if (!result.ok) throw new TaskPersistenceError(result.error, task);
  if (!task.upstreamRef || !resultAssetIds.length) throw new TaskPersistenceError({ code: 'not_recoverable', message: '缺少原任务号或产物，不能确认恢复成功' }, task);
  const desired = { ...result.value, revision: task.revision };
  try {
    const saved = await log.update(desired);
    forgetRecoveredAssets(desired.id);
    return saved;
  } catch (error) {
    if (error instanceof TaskPersistenceError) throw retainTaskWriteFailure(log, error, desired, true);
    throw error;
  }
}

const inFlight = new Set<string>();
export function markInFlight(taskId: string, active: boolean): void {
  if (active) inFlight.add(taskId); else inFlight.delete(taskId);
  useTaskLogStore.setState({ inFlightIds: [...inFlight] });
}
export function resumableTasks(tasks: readonly Task[]): Task[] {
  return tasks.filter((task) => !inFlight.has(task.id) && Boolean(task.upstreamRef) && (
    task.status === 'running' || (task.status === 'failed' && task.error?.code === 'provider_result_pending')
  ));
}
