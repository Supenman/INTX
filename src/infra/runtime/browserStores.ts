import type { ProviderConfig } from '@/domain';
import type { BlobStore, ProviderStore } from '@/app/stores/providerStore';
import { defaultProviders } from '@/app/stores/providerStore';

/**
 * 浏览器宿主下的存储实现。
 *
 * 这里刻意不用 localStorage 存项目画布（旧代码就栽在这：5 MB 上限，
 * 写失败只 console.warn）。项目走 IndexedDB，只有几百字节的厂商配置
 * 放 localStorage —— 它小、同步、读写快，放这里合适。
 */

const PROVIDER_KEY = 'intx.providers.v1';

export function fallbackProviderStore(inner: ProviderStore): ProviderStore {
  return {
    async load() {
      try {
        const list = await inner.load();
        if (list.length > 0) return list;
      } catch {
        // 读失败就当没配过，用默认配置，不要让应用起不来
      }
      return defaultProviders();
    },
    save: (configs) => inner.save(configs),
  };
}

export const localStorageProviderStore: ProviderStore = {
  async load() {
    const raw = localStorage.getItem(PROVIDER_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ProviderConfig[]) : [];
  },
  async save(configs) {
    localStorage.setItem(PROVIDER_KEY, JSON.stringify(configs));
  },
};

const DB = 'intx-blobs';
const STORE = 'blobs';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
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

export async function openIndexedDbBlobStore(): Promise<BlobStore> {
  return {
    async put(key, bytes, mime) {
      await run('readwrite', (s) => s.put(new Blob([bytes], { type: mime }), key) as IDBRequest<IDBValidKey>);
    },
    async get(key) {
      const blob = await run<Blob | undefined>('readonly', (s) => s.get(key) as IDBRequest<Blob | undefined>);
      return blob ? blob.arrayBuffer() : null;
    },
    async remove(key) {
      await run('readwrite', (s) => s.delete(key) as IDBRequest<undefined>);
    },
    async has(key) {
      const k = await run<IDBValidKey | undefined>('readonly', (s) => s.getKey(key) as IDBRequest<IDBValidKey | undefined>);
      return k !== undefined;
    },
  };
}
