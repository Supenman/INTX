import { adapterFor } from '@/infra/provider';
import { openIndexedDbBlobStore, localStorageProviderStore, fallbackProviderStore } from './browserStores';
import { openTauriBlobStore, tauriProviderStore, isTauri } from './tauriStores';
import type { BlobStore, ProviderStore } from '@/app/stores/providerStore';
import type { TaskLog } from '@/infra/repository/taskLog';
import { indexedDbTaskLog } from '@/infra/repository/taskLog';
import { tauriTaskLog } from '@/infra/repository/taskLog';

/**
 * 运行时宿主探测与装配。
 *
 * 桌面优先的落地方式：同一个构建产物在 Tauri 里跑就用文件系统，
 * 在浏览器里跑就回退到 IndexedDB。不需要两套构建、两份配置。
 */

export interface Runtime {
  host: 'tauri' | 'browser';
  providers: ProviderStore;
  blobs: BlobStore;
  tasks: TaskLog;
}

let cached: Runtime | null = null;

export async function resolveRuntime(): Promise<Runtime> {
  if (cached) return cached;

  if (isTauri()) {
    cached = {
      host: 'tauri',
      providers: await tauriProviderStore(),
      blobs: await openTauriBlobStore(),
      tasks: await tauriTaskLog(),
    };
  } else {
    cached = {
      host: 'browser',
      providers: fallbackProviderStore(localStorageProviderStore),
      blobs: await openIndexedDbBlobStore(),
      tasks: indexedDbTaskLog,
    };
  }
  return cached;
}

export { adapterFor };
