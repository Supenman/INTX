import { transition, type Task } from '@/domain';
import { useTaskStore } from '@/app/stores/taskStore';
import { foldEvents, type TaskLog } from '@/infra/repository/taskLog';

/**
 * 任务恢复与日志订阅。
 *
 * 日志是任务状态的权威来源，项目文件里的 tasks 只是最近的展示缓存。
 * 启动时顺序不能反：先装项目，再恢复日志（以日志为准），最后开订阅。
 * 反过来的话恢复出来的状态会被立刻写回日志，形成自我印证。
 */

export interface RecoveryReport {
  /** 日志里恢复出的任务数 */
  restored: number;
  /** 上次没跑完、被收敛成终态的任务数 */
  interrupted: number;
}

export const INTERRUPTED_MESSAGE = '上次运行时应用退出，该任务没有跑完';

/** 把残留的 queued/running 收敛为带原因的 canceled。走 transition，不绕过状态机。 */
export function settleInterrupted(task: Task, now = Date.now()): Task {
  if (task.status !== 'queued' && task.status !== 'running') return task;
  const r = transition(task, 'canceled', {
    now,
    error: { code: 'unknown', message: INTERRUPTED_MESSAGE },
  });
  return r.ok ? r.value : task;
}

export async function restoreTasks(log: TaskLog): Promise<RecoveryReport> {
  const events = await log.readEvents();
  const folded = foldEvents(events);
  const now = Date.now();

  const tasks = folded.map((t) => settleInterrupted(t, now));
  const interrupted = tasks.filter((t, i) => t !== folded[i]).length;

  // 与项目文件里恢复出来的任务合并：日志优先
  useTaskStore.setState((s) => {
    const merged: Record<string, Task> = { ...s.tasks };
    for (const t of tasks) merged[t.id] = t;
    return { ...s, tasks: merged };
  });

  // 被收敛的任务要写回日志，否则下次启动又会当成"还在跑"再处理一遍
  if (interrupted > 0) {
    await log.append(tasks.filter((t) => t.error?.message === INTERRUPTED_MESSAGE));
  }

  return { restored: tasks.length, interrupted };
}

/**
 * 订阅任务状态变化并追加日志。
 *
 * 用引用比较找出真正变化的任务，再防抖批量写 —— 进度更新很频繁，
 * 每帧写一次文件/IndexedDB 会把主线程拖死。
 */
export function startTaskLog(log: TaskLog, debounceMs = 250): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Map<string, Task>();

  const flush = () => {
    timer = undefined;
    if (pending.size === 0) return;
    const batch = [...pending.values()];
    pending.clear();
    void log.append(batch).catch(() => {
      // 日志写失败不该影响正在进行的生成，也不该弹窗打断用户
    });
  };

  const unsub = useTaskStore.subscribe((curr, prev) => {
    if (curr.tasks === prev.tasks) return;
    for (const [id, task] of Object.entries(curr.tasks)) {
      if (prev.tasks[id] !== task) pending.set(id, task);
    }
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  });

  return () => {
    unsub();
    if (timer !== undefined) clearTimeout(timer);
    flush();
  };
}
