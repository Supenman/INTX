import { create } from 'zustand';
import type { Asset } from '@/domain';

/**
 * 资产索引。
 *
 * 只存元数据，字节在 BlobStore 里（浏览器是 IndexedDB，桌面是文件）。
 * 这样任务只依赖一个可序列化的小对象，刷新后先显示占位、再按需取字节，
 * 不会因为一张 4K 图把首屏卡住。
 */
export interface AssetEntry {
  asset: Asset;
  /** BlobStore 的键，等于 asset.hash */
  blobKey: string;
  /** 用于 <img>/<video> 的临时地址，由 UI 层按需创建 */
  url?: string;
}

export interface AssetState {
  assets: Record<string, AssetEntry>;
  /** 按 hash 索引，用于去重：同一张图被两个节点引用时只存一份 */
  byHash: Record<string, string>;
  ready: boolean;
}

export const useAssetStore = create<AssetState>(() => ({ assets: {}, byHash: {}, ready: false }));

export function putAsset(entry: AssetEntry): void {
  useAssetStore.setState((s) => ({
    ...s,
    assets: { ...s.assets, [entry.asset.id]: entry },
    byHash: { ...s.byHash, [entry.asset.hash]: entry.asset.id },
    ready: true,
  }));
}

export function findAssetByHash(hash: string): AssetEntry | undefined {
  const { byHash, assets } = useAssetStore.getState();
  const id = byHash[hash];
  return id ? assets[id] : undefined;
}

export function getAsset(id: string): AssetEntry | undefined {
  return useAssetStore.getState().assets[id];
}

export function attachUrl(id: string, url: string): void {
  useAssetStore.setState((s) => {
    const e = s.assets[id];
    if (!e) return s;
    return { ...s, assets: { ...s.assets, [id]: { ...e, url } } };
  });
}

/** 软删：索引里标记，字节保留（进了回收站还能恢复）。 */
export function softDelete(ids: readonly string[]): void {
  useAssetStore.setState((s) => {
    const next = { ...s.assets };
    for (const id of ids) {
      const e = next[id];
      if (!e) continue;
      next[id] = { ...e, asset: { ...e.asset, deletedAt: Date.now() } };
    }
    return { ...s, assets: next };
  });
}

export function aliveAssets(): AssetEntry[] {
  return Object.values(useAssetStore.getState().assets).filter((e) => e.asset.deletedAt === undefined);
}

/** 按时间倒序，资产库按这个顺序展示。 */
export function recentAssets(limit = 100): AssetEntry[] {
  return aliveAssets()
    .sort((a, b) => b.asset.createdAt - a.asset.createdAt)
    .slice(0, limit);
}
