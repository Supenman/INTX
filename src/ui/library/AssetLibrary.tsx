import { useMemo, useState } from 'react';
import { recentAssets, softDelete, useAssetStore, type AssetEntry } from '@/app/stores/assetStore';
import { BlobImage } from '@/ui/common/BlobImage';
import { placeOnCanvas } from '@/ui/common/placeOnCanvas';

/**
 * 资产库。
 *
 * 旧代码里"生成结果"只活在节点上：删掉节点，图就找不回来了；
 * 想复用一张图，只能重新生成一次。
 *
 * 这里资产是独立实体，有自己的列表、预览和引用关系。
 * 拖回画布 = 新建一个素材节点并引用同一份字节（内容哈希相同 → 不重复存）。
 */
export function AssetLibrary() {
  // 订阅整个 assets 字典：数量与删除状态都会影响列表
  const assets = useAssetStore((s) => s.assets);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- assets 是订阅信号，不是参数
  const list = useMemo(() => recentAssets(60), [assets]);
  const [preview, setPreview] = useState<AssetEntry | null>(null);

  if (list.length === 0) {
    return (
      <>
        <h3>资产库</h3>
        <p className="muted small pad">生成的图片会出现在这里，可拖回画布重复使用。</p>
      </>
    );
  }

  return (
    <>
      <h3>
        资产库 <span className="count">{list.length}</span>
      </h3>
      <div className="asset-grid">
        {list.map((e) => (
          <AssetThumb key={e.asset.id} entry={e} onOpen={() => setPreview(e)} />
        ))}
      </div>
      {preview && (
        <div className="panel-mask" onClick={() => setPreview(null)}>
          <div className="preview" onClick={(ev) => ev.stopPropagation()}>
            <BlobImage entry={preview} />
            <div className="preview-bar">
              <span className="mono small">{preview.asset.hash.slice(0, 10)}</span>
              <button
                className="btn small"
                onClick={() => {
                  placeOnCanvas(preview);
                  setPreview(null);
                }}
              >
                放到画布
              </button>
              <button
                className="btn ghost small danger"
                onClick={() => {
                  softDelete([preview.asset.id]);
                  setPreview(null);
                }}
              >
                移到回收站
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function AssetThumb({ entry, onOpen }: { entry: AssetEntry; onOpen: () => void }) {
  return (
    <button className="asset-thumb" onClick={onOpen} title={entry.asset.path}>
      <BlobImage entry={entry} />
    </button>
  );
}


