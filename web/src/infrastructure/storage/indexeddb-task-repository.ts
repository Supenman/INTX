import { openDB, type IDBPDatabase, type IDBPTransaction } from 'idb';
import localforage from 'localforage';
import type { StorageError, TaskRepository } from '../../application/ports/taskRepository';
import { err, ok, type Result } from '../../domain/shared/result';
import { changeTask, copyTask, corruptData, decodeTasks, type TaskSnapshot } from './task-storage';

const STORE = 'app_state';
const TASK_KEY = 'infinite-canvas:intx_task_log';

/** 注入项仅用于独立测试库；生产默认沿用现有库和键。 */
export interface IndexedDBTaskRepositoryOptions {
  dbName?: string;
  key?: string;
  localStorage?: Storage;
}

/** IndexedDB 是唯一权威来源；构造时不初始化、不读取任何存储键。 */
export function createIndexedDBTaskRepository(options: IndexedDBTaskRepositoryOptions = {}): TaskRepository {
  const name = options.dbName ?? 'infinite-canvas';
  const key = options.key ?? TASK_KEY;
  let connection: Promise<IDBPDatabase> | undefined;

  function database(): Promise<IDBPDatabase> {
    if (!connection) {
      connection = (async () => {
        // localforage 协调缺失库/仓库的初始化，不用固定库版本，不启用降级驱动。
        const instance = localforage.createInstance({ name, storeName: STORE, driver: localforage.INDEXEDDB });
        await instance.ready();
        const db = await openDB(name, undefined, {
          blocking() { db.close(); connection = undefined; },
          terminated() { connection = undefined; },
        });
        if (!db.objectStoreNames.contains(STORE)) {
          db.close();
          throw new Error('任务对象仓库不可用');
        }
        return db;
      })().catch((e: unknown) => { connection = undefined; throw e; });
    }
    return connection;
  }

  function hasFallback(): boolean {
    // 只枚举键是否存在；不读取、解析或导入旧回退值，也不读取配置。
    const storage = options.localStorage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
    if (!storage) return false;
    for (let i = 0; i < storage.length; i++) if (storage.key(i) === key) return true;
    return false;
  }

  async function transact<T>(
    mode: 'readonly' | 'readwrite',
    action: (snapshot: TaskSnapshot) => Result<T, StorageError>,
  ): Promise<Result<T, StorageError>> {
    let db: IDBPDatabase;
    try { db = await database(); }
    catch { return err({ code: 'unavailable', message: 'IndexedDB 任务存储不可用，未启用备用存储' }); }
    let tx: IDBPTransaction<unknown, [typeof STORE], 'readonly' | 'readwrite'> | undefined;
    let completed: Promise<boolean> | undefined;
    let failure: 'read_failed' | 'write_failed' = 'read_failed';
    try {
      tx = db.transaction(STORE, mode);
      // 立即接住 done 的拒绝，request 成功后晚阶段 abort 同样不能返回成功。
      completed = tx.done.then(() => true, () => false);
      const raw: unknown = await tx.store.get(key);
      const decoded = decodeTasks(raw);
      let result: Result<T, StorageError>;
      if (!decoded.ok) result = decoded;
      else if (raw === undefined && hasFallback()) {
        result = err({ code: 'unsupported_format', message: '检测到旧 localStorage 任务数据，需先处理，已拒绝写入且未导入' });
      } else {
        result = action(decoded.value);
        if (mode === 'readwrite' && result.ok) {
          failure = 'write_failed';
          const writable = tx as IDBPTransaction<unknown, [typeof STORE], 'readwrite'>;
          await writable.store.put(JSON.stringify(decoded.value), key);
        }
      }
      if (!await completed) return err({ code: mode === 'readwrite' ? 'write_failed' : 'read_failed', message: '任务存储事务未完成，数据未确认保存' });
      return result;
    } catch {
      if (tx) {
        try { tx.abort(); } catch { /* 事务可能已关闭。 */ }
        await completed;
      }
      return err({ code: failure, message: failure === 'read_failed' ? '读取任务存储失败，未将错误当作空台账' : '保存任务存储失败，数据未确认保存' });
    }
  }

  return {
    async create(task) {
      const copied = copyTask(task);
      return copied.ok ? transact('readwrite', (s) => changeTask(s, copied.value)) : copied;
    },
    get(id) {
      return transact('readonly', (s) => {
        const task = s.state.tasks.find((t) => t.id === id);
        return ok(task ? { value: task, revision: s.metadata.revisions[id] } : null);
      });
    },
    list() {
      return transact('readonly', (s) => ok(s.state.tasks.map((task) => ({ value: task, revision: s.metadata.revisions[task.id] }))));
    },
    async replace(task, expectedRevision) {
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return err(corruptData());
      const copied = copyTask(task);
      return copied.ok ? transact('readwrite', (s) => changeTask(s, copied.value, expectedRevision)) : copied;
    },
  };
}
