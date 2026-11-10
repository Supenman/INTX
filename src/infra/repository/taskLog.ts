import type { Task } from '@/domain';
import { loadFs } from '../runtime/tauriStores';

/**
 * 任务日志。
 *
 * 项目文件里只留最近 200 条任务（见 trimForSave），完整历史在这里。
 * 但真正要解决的不是"审计"，而是一个很具体的故障：
 *
 *   旧代码把任务放在进程内存字典里，应用一崩，内存没了；
 *   前端下次打开却还从 localStorage 里读到 `status: running`，
 *   于是卡片永远转圈"生成中"，用户只能手动刷新甚至清数据。
 *
 * 追加式日志让我们在启动时知道"哪些任务没跑完"，把它们收敛成
 * 明确的终态并给出可重试的提示，而不是假装还在跑。
 */

export interface TaskLogEvent {
  at: number;
  task: Task;
}

export interface TaskLog {
  /** 批量追加。同一任务的多次状态变化各占一条，读时按时间取最后一条。 */
  append(tasks: readonly Task[]): Promise<void>;
  /** 返回全部事件（时间升序），恢复时按 task.id 折叠。 */
  readEvents(): Promise<TaskLogEvent[]>;
  clear(): Promise<void>;
}

/** 折叠日志：每个任务只保留最后一次状态。 */
export function foldEvents(events: readonly TaskLogEvent[]): Task[] {
  const latest = new Map<string, TaskLogEvent>();
  for (const ev of events) {
    const prev = latest.get(ev.task.id);
    if (!prev || ev.at >= prev.at) latest.set(ev.task.id, ev);
  }
  return [...latest.values()]
    .sort((a, b) => a.task.createdAt - b.task.createdAt)
    .map((e) => e.task);
}

const DB = 'intx-tasks';
const STORE = 'events';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'seq', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const indexedDbTaskLog: TaskLog = {
  async append(tasks) {
    if (tasks.length === 0) return;
    const now = Date.now();
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(STORE, 'readwrite');
      const store = t.objectStore(STORE);
      tasks.forEach((task, i) => store.add({ at: now + i, task }));
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  },
  async readEvents() {
    return run<TaskLogEvent[]>('readonly', (s) => s.getAll() as IDBRequest<TaskLogEvent[]>);
  },
  async clear() {
    await run('readwrite', (s) => s.clear() as IDBRequest<undefined>);
  },
};

const LOG_PATH = 'tasks.jsonl';

export async function tauriTaskLog(): Promise<TaskLog> {
  const fs = await loadFs();
  const opt = fs ? { baseDir: fs.BaseDirectory.AppData } : undefined;

  return {
    async append(tasks) {
      if (!fs || !opt || tasks.length === 0) return;
      const now = Date.now();
      const lines = tasks.map((task, i) => JSON.stringify({ at: now + i, task })).join('\n') + '\n';
      let previous = '';
      if (await fs.exists(LOG_PATH, opt)) previous = await fs.readTextFile(LOG_PATH, opt);
      await fs.writeTextFile(LOG_PATH, previous + lines, opt);
    },
    async readEvents() {
      if (!fs || !opt || !(await fs.exists(LOG_PATH, opt))) return [];
      const text = await fs.readTextFile(LOG_PATH, opt);
      const out: TaskLogEvent[] = [];
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line) as TaskLogEvent;
          if (ev.task && typeof ev.at === 'number') out.push(ev);
        } catch {
          // 半截的一行（写到一半崩溃）直接跳过，不能让整个恢复失败
        }
      }
      return out;
    },
    async clear() {
      if (!fs || !opt) return;
      await fs.writeTextFile(LOG_PATH, '', opt);
    },
  };
}
