import { useEffect, useState } from 'react';
import type { AssetEntry } from '@/app/stores/assetStore';
import { resolveRuntime } from '@/infra/runtime';

/**
 * 产物字节 → 可显示的临时 URL。
 *
 * 单独放一个文件是为了让 CanvasNode / AssetLibrary / 预览弹窗共用同一份逻辑，
 * 而不是各自写一遍 createObjectURL（写漏 revoke 就是内存泄漏，
 * 一批视频任务跑下来能把标签页拖死）。
 */
export function BlobImage({ entry, className }: { entry: AssetEntry; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    void (async () => {
      const runtime = await resolveRuntime();
      const bytes = await runtime.blobs.get(entry.blobKey);
      if (cancelled) return;
      if (!bytes) {
        setBroken(true);
        return;
      }
      const u = URL.createObjectURL(new Blob([bytes], { type: entry.asset.mime }));
      revoked = u;
      setUrl(u);
    })();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [entry.blobKey, entry.asset.mime]);

  if (broken) return <span className="muted small">文件丢失</span>;
  if (!url) return <span className="muted small placeholder">…</span>;
  return <img className={className} src={url} alt="" draggable={false} />;
}
