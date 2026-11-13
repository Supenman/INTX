/**
 * 任务台账：每次生成落一条 `domain/task` 的 Task，浏览器本地持久化。
 *
 * 边界：
 * - **绝不写 apiKey / baseUrl 全串 / 参考图 dataUrl**。AiConfig 只在进程内存里，
 *   落盘的 GenerationParams 只有 model、prompt、providerId、资产 id 这类可回溯字段。
 * - 所有状态迁移都过 `transition()`，不在这里自己改 status，避免绕过三态语义。
 * - 业务列表按 AGENTS.md 用 localforage，不塞 localStorage。
 */
import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';

import { createTask, recoverPendingResult, transition, type CreateTaskInput, type Task } from '@/domain/task/model';
import { isOk } from '@/domain/shared/result';
import { localForageStorage } from '@/lib/localforage-storage';

export const TASK_LOG_KEY = 'infinite-canvas:intx_task_log';

/** 编排层只依赖这个窄接口，测试可以注入内存实现，不碰浏览器存储。 */
export interface TaskLog {
  create(input: CreateTaskInput): Task;
  update(task: Task): void;
  findByUpstreamRef(ref: string): Task | null;
  list(): readonly Task[];
}

interface TaskLogState {
  tasks: Task[];
  hydrated: boolean;
  create(input: CreateTaskInput): Task;
  replace(id: string, next: Task): void;
  setHydrated(value: boolean): void;
  clear(): void;
}

const taskLogStorage: PersistStorage<TaskLogState> = {
  getItem: async (name) => {
    const value = await localForageStorage.getItem(name);
    return value ? (JSON.parse(value) as StorageValue<TaskLogState>) : null;
  },
  setItem: async (name, value) => {
    await localForageStorage.setItem(name, JSON.stringify(value));
  },
  removeItem: async (name) => {
    await localForageStorage.removeItem(name);
  },
};

export const useTaskLogStore = create<TaskLogState>()(
  persist(
    (set) => ({
      tasks: [],
      hydrated: false,
      create: (input) => {
        const task = createTask(input);
        set((state) => ({ tasks: [task, ...state.tasks] }));
        return task;
      },
      replace: (id, next) =>
        set((state) => ({ tasks: state.tasks.map((t) => (t.id === id ? next : t)) })),
      setHydrated: (value) => set({ hydrated: value }),
      clear: () => set({ tasks: [] }),
    }),
    {
      name: TASK_LOG_KEY,
      storage: taskLogStorage,
      partialize: (state) => ({ tasks: state.tasks }) as StorageValue<TaskLogState>['state'],
      onRehydrateStorage: () => (state) => state?.setHydrated(true),
    },
  ),
);

export const browserTaskLog: TaskLog = {
  create: (input) => useTaskLogStore.getState().create(input),
  update: (task) => useTaskLogStore.getState().replace(task.id, task),
  findByUpstreamRef: (ref) =>
    useTaskLogStore.getState().tasks.find((t) => t.upstreamRef === ref) ?? null,
  list: () => useTaskLogStore.getState().tasks,
};

/** 测试用的内存台账。 */
export function createMemoryTaskLog(): TaskLog {
  const tasks: Task[] = [];
  return {
    create: (input) => {
      const task = createTask(input);
      tasks.unshift(task);
      return task;
    },
    update: (task) => {
      const index = tasks.findIndex((t) => t.id === task.id);
      if (index >= 0) tasks[index] = task;
    },
    findByUpstreamRef: (ref) => tasks.find((t) => t.upstreamRef === ref) ?? null,
    list: () => tasks,
  };
}

/**
 * 把一次迁移结果写回台账。非法迁移直接返回原任务，不静默吞掉——
 * 静默会让「终态被二次改写」这种 bug 藏起来。
 */
export function commit(
  log: TaskLog,
  task: Task,
  to: Parameters<typeof transition>[1],
  opts: Parameters<typeof transition>[2] = {},
): Task {
  const result = transition(task, to, opts);
  if (!isOk(result)) return task;
  log.update(result.value);
  return result.value;
}

/**
 * 凭原任务号取回产物后写回台账。
 *
 * `running`（刷新打断了轮询）走正常迁移；已经是 `failed / provider_result_pending`
 * 的走 `recoverPendingResult` 的受限恢复，其他失败一律不动——那条规则只给
 * 「已收单但没拿到产物」开一个口子。
 */
export function commitRecovered(log: TaskLog, task: Task, resultAssetIds: readonly string[]): Task {
  const result = task.status === 'running' ? transition(task, 'succeeded', { resultAssetIds: [...resultAssetIds] }) : recoverPendingResult(task, { resultAssetIds });
  if (!result.ok) return task;
  log.update(result.value);
  return result.value;
}

/**
 * 本进程里正在跑的任务。它们的状态也是 `running + upstreamRef`，但那是「正在生成」，
 * 不是「刷新打断了轮询、等你来查」——不排掉，设置里会一边出图一边挂出待核实卡片。
 */
const inFlight = new Set<string>();

export function markInFlight(taskId: string, active: boolean): void {
  if (active) inFlight.add(taskId);
  else inFlight.delete(taskId);
}

/**
 * 「已收单但本地没拿到产物」的任务清单，供查单取回或人工去厂商后台核对。
 *
 * 红线：这个清单**不是**重发入口。展示时不能给用户「确认后重发」去查旧单，
 * 那会新提交一张、再扣一次钱。只允许展示任务号 + 查单/去后台核对。
 */
export function resumableTasks(tasks: readonly Task[]): Task[] {
  return tasks.filter((task) => {
    if (!task.upstreamRef || inFlight.has(task.id)) return false;
    if (task.status === 'running') return true;
    return task.status === 'failed' && task.error?.code === 'provider_result_pending';
  });
}
