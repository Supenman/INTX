import { openDB, type IDBPDatabase, type IDBPTransaction } from 'idb';
import localforage from 'localforage';
import type { AssetRepository, ProjectRepository } from '../../application/ports/snapshotRepositories';
import type { StorageError, Stored } from '../../application/ports/taskRepository';
import { err, type Result } from '../../domain/shared/result';
import { assetSnapshotCodec, encodeSnapshot, nextSnapshot, projectSnapshotCodec, snapshotCorruptData, validRevision, type SnapshotCodec } from './snapshot-storage';

const STORE = 'app_state';
/** Injections are for isolated synthetic tests; production retains the existing database/key. */
export interface IndexedDBSnapshotRepositoryOptions { dbName?: string; key?: string; localStorage?: Storage }

function repository<T>(codec: SnapshotCodec<T>, defaultKey: string, options: IndexedDBSnapshotRepositoryOptions) {
  const name = options.dbName ?? 'infinite-canvas';
  const key = options.key ?? defaultKey;
  let connection: Promise<IDBPDatabase> | undefined;
  function database(): Promise<IDBPDatabase> {
    if (!connection) connection = (async () => {
      const instance = localforage.createInstance({ name, storeName: STORE, driver: localforage.INDEXEDDB });
      await instance.ready();
      const db = await openDB(name, undefined, {
        blocking() { db.close(); connection = undefined; },
        terminated() { connection = undefined; },
      });
      if (!db.objectStoreNames.contains(STORE)) { db.close(); throw new Error('对象仓库不可用'); }
      return db;
    })().catch((e: unknown) => { connection = undefined; throw e; });
    return connection;
  }
  function hasFallback(): boolean {
    const storage = options.localStorage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
    if (!storage) return false;
    // Only presence enumeration, never read/parse/import/delete fallback or configuration values.
    for (let i = 0; i < storage.length; i++) if (storage.key(i) === key) return true;
    return false;
  }
  async function transact(value?: T, expectedRevision?: number): Promise<Result<Stored<T>, StorageError>> {
    const writing = expectedRevision !== undefined;
    let db: IDBPDatabase;
    try { db = await database(); }
    catch { return err({ code: 'unavailable', message: 'IndexedDB 快照存储不可用，未启用备用存储' }); }
    let tx: IDBPTransaction<unknown, [typeof STORE], 'readonly' | 'readwrite'> | undefined;
    let completed: Promise<boolean> | undefined;
    let failure: 'read_failed' | 'write_failed' = 'read_failed';
    try {
      tx = db.transaction(STORE, writing ? 'readwrite' : 'readonly');
      completed = tx.done.then(() => true, () => false);
      const raw: unknown = await tx.store.get(key);
      let result = codec.decode(raw);
      if (result.ok && raw === undefined && hasFallback()) result = err({ code: 'unsupported_format', message: '检测到旧 localStorage 集合数据，需先处理，已拒绝写入且未导入' });
      if (result.ok && writing) {
        result = nextSnapshot(value as T, expectedRevision, result.value.revision);
        if (result.ok) {
          failure = 'write_failed';
          await (tx as IDBPTransaction<unknown, [typeof STORE], 'readwrite'>).store.put(encodeSnapshot(result.value), key);
        }
      }
      if (!await completed) return err({ code: writing ? 'write_failed' : 'read_failed', message: '快照存储事务未完成，数据未确认保存' });
      return result;
    } catch {
      if (tx) { try { tx.abort(); } catch { /* Already closed. */ } await completed; }
      return err({ code: failure, message: failure === 'read_failed' ? '读取快照存储失败，未将错误当作空集合' : '保存快照存储失败，数据未确认保存' });
    }
  }
  return {
    load: () => transact(),
    async save(value: T, expectedRevision: number) {
      if (!validRevision(expectedRevision)) return err(snapshotCorruptData());
      const copied = codec.copy(value);
      return copied.ok ? transact(copied.value, expectedRevision) : copied;
    },
  };
}
/** Construction is lazy; no database or storage key is touched until load/save. */
export function createIndexedDBProjectRepository(options: IndexedDBSnapshotRepositoryOptions = {}): ProjectRepository {
  return repository(projectSnapshotCodec, 'infinite-canvas:canvas_store', options);
}
export function createIndexedDBAssetRepository(options: IndexedDBSnapshotRepositoryOptions = {}): AssetRepository {
  return repository(assetSnapshotCodec, 'infinite-canvas:asset_store', options);
}
