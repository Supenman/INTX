import type { AssetEntry } from '@/app/stores/assetStore';
import { addNode, useGraphStore } from '@/app/stores/graphStore';

/** 把已有资产放到画布：新建素材节点并引用它（字节不复制）。 */
export function placeOnCanvas(entry: AssetEntry): string {
  const id = addNode({
    defKind: 'asset',
    position: { x: 120, y: 120 },
    params: { caption: entry.asset.path.split('/').pop() ?? '' },
  });
  useGraphStore.setState((s) => {
    const n = s.nodes[id];
    if (n) n.assetId = entry.asset.id;
  });
  return id;
}
