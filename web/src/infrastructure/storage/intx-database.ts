import { openDB, type IDBPDatabase } from 'idb';
import localforage from 'localforage';

/**
 * 同一 IndexedDB 库里的多仓库事务入口。
 *
 * 任务核销和素材快照在同一个库的两个键上，localforage 每次 setItem 各开一个事务，
 * 做不到「一起成功、一起回滚」。这里用 idb 直连拿同一个库，交给调用方开跨仓库事务。
 * 建库/建仓库仍由 localforage 协调：不固定版本号，避免和现有数据抢升级。
 */
const connections = new Map<string, Promise<IDBPDatabase>>();

export function intxDatabase(name: string, stores: readonly string[]): Promise<IDBPDatabase> {
  const cacheKey = `${name}|${[...stores].sort().join(',')}`;
  let pending = connections.get(cacheKey);
  if (!pending) {
    pending = (async () => {
      for (const storeName of stores) {
        const instance = localforage.createInstance({ name, storeName, driver: localforage.INDEXEDDB });
        await instance.ready();
      }
      const db = await openDB(name, undefined, {
        blocking() { db.close(); connections.delete(cacheKey); },
        terminated() { connections.delete(cacheKey); },
      });
      const missing = stores.filter((store) => !db.objectStoreNames.contains(store));
      if (missing.length) {
        db.close();
        throw new Error(`对象仓库不可用：${missing.join('、')}`);
      }
      return db;
    })().catch((error: unknown) => { connections.delete(cacheKey); throw error; });
    connections.set(cacheKey, pending);
  }
  return pending;
}
