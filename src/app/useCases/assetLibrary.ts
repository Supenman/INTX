import type { Asset, ProviderCapability } from '@/domain';
import type { Runtime } from '@/infra/runtime';
import { putAsset, useAssetStore } from '@/app/stores/assetStore';
import { useProviderStore } from '@/app/stores/providerStore';
import { loadProjectFile } from './projectFile';

/**
 * 资产索引的恢复与持久化。
 *
 * 只恢复**索引**（id/kind/mime/path/hash/尺寸），字节按需从 BlobStore 取。
 * 这样打开一个大项目不会先把几百兆图全拉进内存。
 *
 * 这里还有一个必要的清理动作：项目里记录过、但 BlobStore 里已经没有字节的资产，
 * 属于"文件丢了"。不静默跳过，而是记进 missing，让 UI 能提示用户
 * ——旧代码在这种情况下会渲染出一片空白，连报错都没有。
 */
let hydratingCount = 0;

/**
 * 启动装载期间的 putAsset 不该触发自动保存。
 *
 * 这个 effect 与项目恢复的 effect 是并行的：恢复流程一旦标记「就绪」，
 * 资产还在逐条 await blobs.has() 的时候，每条 putAsset 都会唤醒保存订阅，
 * 而那时画布可能还没 hydrate —— 一次防抖写回就会把空画布盖掉存档。
 */
export function isHydratingAssets(): boolean {
  return hydratingCount > 0;
}

export async function hydrateAssetsFromProject(runtime: Runtime): Promise<{ missing: string[] }> {
  const project = await loadProjectIndex();
  return hydrateAssetList(runtime, project);
}

/** 拆出可单测的装载循环：单测不必碰 IndexedDB 也能验证门控标志。 */
export async function hydrateAssetList(
  runtime: Runtime,
  project: readonly Asset[],
): Promise<{ missing: string[] }> {
  hydratingCount += 1;
  try {
    const missing: string[] = [];
    for (const asset of project) {
      const ok = await runtime.blobs.has(asset.hash);
      if (!ok) {
        missing.push(asset.id);
        continue;
      }
      putAsset({ asset, blobKey: asset.hash });
    }
    return { missing };
  } finally {
    hydratingCount -= 1;
  }
}

/**
 * 项目里的资产清单来源。
 *
 * 目前项目文件（IndexedDB）里带着 assets 数组，直接读它。
 * 单独抽成函数是为了将来换成 Tauri 的 assets/index.json 时只改这里。
 */
async function loadProjectIndex(): Promise<Asset[]> {
  const file = await loadProjectFile();
  return file?.assets ?? [];
}

/** 把资产索引写回项目文件（跟随画布的自动保存一起落盘）。 */
export function collectAssetIndex(): Asset[] {
  return Object.values(useAssetStore.getState().assets).map((e) => e.asset);
}

/** 某能力下当前可用的模型数量，用于设置页与提示。 */
export function availableModels(capability: ProviderCapability): number {
  return useProviderStore
    .getState()
    .configs.reduce((n, c) => n + c.models.filter((m) => m.capabilities.includes(capability)).length, 0);
}
