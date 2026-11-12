import { extFromMime } from '@/domain';
import type { AssetEntry } from '@/app/stores/assetStore';
import { selectPrimaryAsset } from '@/app/stores/graphStore';
import { readAssetBytes } from '@/app/useCases/storyboardExport';
import { BlobImage } from '@/ui/common/BlobImage';
import { downloadBytes } from '@/ui/common/download';

/**
 * generate 节点的产物区。从 CanvasNode 拆出守结构预算。
 *
 * 主图仍是 .node-result 内单张（generation e2e 锁 `.node-result img`=1）；
 * 多张时缩略图条放在 .node-result 之外，点击设主图（下游连线取这张）。
 * 另存按钮让普通生成的图拿得出门——以前只能导出整个 .intx。
 */
export interface GenerateResultProps {
  nodeId: string;
  primary: AssetEntry | undefined;
  derived: AssetEntry[];
  title: string;
  onError: (message: string) => void;
}

export function GenerateResult({ nodeId, primary, derived, title, onError }: GenerateResultProps) {
  const savePrimary = async () => {
    if (!primary) return;
    const r = await readAssetBytes(primary.asset.id);
    if (!r.ok) {
      onError(r.message);
      return;
    }
    const safe = title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || '产物';
    downloadBytes(r.bytes, r.mime, `${safe}.${extFromMime(r.mime)}`);
  };

  return (
    <>
      {primary ? (
        <div className="node-result">
          <BlobImage entry={primary} />
          <button
            className="result-save nodrag"
            title="另存这张产物"
            aria-label="另存产物"
            onClick={(e) => {
              e.stopPropagation();
              void savePrimary();
            }}
          >
            ↓
          </button>
        </div>
      ) : (
        // 节点高度固定（出图前后不能变），没产物时给占位框，
        // 否则卡片下半截是一大片说不出所以然的空白。
        <div className="node-result empty">
          <span className="node-empty">还没有产物</span>
        </div>
      )}
      {derived.length > 1 && (
        <div className="result-thumbs" role="group" aria-label="本批产物，点击设为主图">
          {derived.map((entry, i) => (
            <button
              key={entry.asset.id}
              className={`result-thumb nodrag${primary?.asset.id === entry.asset.id ? ' active' : ''}`}
              title={`第 ${i + 1} 张，设为主图（下游连线取这张）`}
              aria-label={`第 ${i + 1} 张，设为主图`}
              onClick={(e) => {
                e.stopPropagation();
                selectPrimaryAsset(nodeId, entry.asset.id);
              }}
            >
              <BlobImage entry={entry} />
            </button>
          ))}
        </div>
      )}
    </>
  );
}
