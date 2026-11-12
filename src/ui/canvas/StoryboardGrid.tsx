import { parseGrid } from '@/domain';
import type { AssetEntry } from '@/app/stores/assetStore';
import { BlobImage } from '@/ui/common/BlobImage';

/**
 * 分镜宫格。从 CanvasNode 拆出守结构预算。
 *
 * 渲染按当前 grid 的 total 截断：历史存档可能带着缩格 bug 留下的
 * 多余 derived（10 条），这里 slice 一次即自愈，下次 attach 收敛。
 * 每格两个 hover 动作：另存（↓）与单格重发（↻，重新购买 1 张）。
 */
export interface StoryboardGridProps {
  derived: AssetEntry[];
  grid: string;
  busy: boolean;
  onSaveCell: (assetId: string, index: number) => void;
  onRetryCell: (index: number) => void;
}

export function StoryboardGrid({ derived, grid, busy, onSaveCell, onRetryCell }: StoryboardGridProps) {
  if (derived.length === 0) return null;
  const shape = parseGrid(grid);
  const cells = derived.slice(0, shape.total);

  return (
    <div className="node-grid" style={{ gridTemplateColumns: `repeat(${shape.cols}, 1fr)` }}>
      {cells.map((entry, i) => (
        <div className="grid-cell" key={entry.asset.id}>
          <BlobImage entry={entry} />
          <span>{i + 1}</span>
          <button
            className="grid-cell-save nodrag"
            title={`另存第 ${i + 1} 格`}
            aria-label={`另存第 ${i + 1} 格`}
            onClick={(e) => {
              e.stopPropagation();
              onSaveCell(entry.asset.id, i);
            }}
          >
            ↓
          </button>
          <button
            className="grid-cell-retry nodrag"
            title={`重发第 ${i + 1} 格（将重新购买 1 张，其余格不动）`}
            aria-label={`重发第 ${i + 1} 格`}
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              onRetryCell(i);
            }}
          >
            ↻
          </button>
        </div>
      ))}
    </div>
  );
}
