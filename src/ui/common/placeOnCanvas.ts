import type { AssetEntry } from '@/app/stores/assetStore';
import { addNode, useGraphStore } from '@/app/stores/graphStore';

/** 把已有资产放到画布指定位置：新建素材节点并引用它（字节不复制）。 */
export function placeAssetAt(entry: AssetEntry, position: { x: number; y: number }): string {
  const id = addNode({
    defKind: 'asset',
    position,
    params: { caption: entry.asset.path.split('/').pop() ?? '' },
  });
  useGraphStore.setState((s) => {
    const n = s.nodes[id];
    if (n) n.assetId = entry.asset.id;
  });
  return id;
}

/** 按钮入口：落在默认位置。拖拽入口用 placeAssetAt 落在指针处。 */
export function placeOnCanvas(entry: AssetEntry): string {
  return placeAssetAt(entry, { x: 120, y: 120 });
}
