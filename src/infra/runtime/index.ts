import { adapterFor } from '@/infra/provider';
import { openIndexedDbBlobStore, localStorageProviderStore, fallbackProviderStore } from './browserStores';
import { openTauriBlobStore, tauriProviderStore, isTauri, ensureAppData } from './tauriStores';
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
  /** 桌面端 $APPDATA 是否建好。false 意味着写文件大概率会失败，UI 可以提示。 */
  storageReady: boolean;
}

let cached: Runtime | null = null;

export async function resolveRuntime(): Promise<Runtime> {
  if (cached) return cached;

  if (isTauri()) {
    // 先建目录再装配：否则第一次保存 config.json / tasks.jsonl 会失败。
    const storageReady = await ensureAppData();
    if (!storageReady) console.warn('INTX: 无法创建 $APPDATA，桌面存储可能不可用');
    cached = {
      host: 'tauri',
      providers: await tauriProviderStore(),
      blobs: await openTauriBlobStore(),
      tasks: await tauriTaskLog(),
      storageReady,
    };
  } else {
    cached = {
      host: 'browser',
      providers: fallbackProviderStore(localStorageProviderStore),
      blobs: await openIndexedDbBlobStore(),
      tasks: indexedDbTaskLog,
      storageReady: true, // IndexedDB 由浏览器托管，不需要建目录
    };
  }
  return cached;
}

export { adapterFor };
