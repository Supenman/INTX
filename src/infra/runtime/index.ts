import { adapterFor } from '@/infra/provider';
import { openIndexedDbBlobStore, localStorageProviderStore, fallbackProviderStore } from './browserStores';
import { openTauriBlobStore, tauriProviderStore, isTauri } from './tauriStores';
import type { BlobStore, ProviderStore } from '@/app/stores/providerStore';

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
}

let cached: Runtime | null = null;

export async function resolveRuntime(): Promise<Runtime> {
  if (cached) return cached;

  if (isTauri()) {
    cached = {
      host: 'tauri',
      providers: await tauriProviderStore(),
      blobs: await openTauriBlobStore(),
    };
  } else {
    cached = {
      host: 'browser',
      providers: fallbackProviderStore(localStorageProviderStore),
      blobs: await openIndexedDbBlobStore(),
    };
  }
  return cached;
}

export { adapterFor };
