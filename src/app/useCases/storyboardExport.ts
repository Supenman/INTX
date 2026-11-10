import { gridLayout } from '@/domain';
import { useAssetStore, type AssetEntry } from '@/app/stores/assetStore';
import { useGraphStore } from '@/app/stores/graphStore';
import { resolveRuntime } from '@/infra/runtime';
import { decodeImage, makeCanvas, toPng } from './imageCanvas';

/**
 * 分镜产物导出（S4 第一块）。
 *
 * 分镜生成是「一段文本 → N 张独立图」，那 N 张图一直只活在资产库里，
 * 用户没法拿走。这里做两件事：拼成一张大图、以及单独取某一格的原始字节。
 *
 * 刻意只产出 Blob / 字节，不直接触发下载 —— 下载是宿主能力，
 * 交给 UI 层的 download.ts，app 层不反向依赖 ui。
 */

/** 格间距。留一点缝，拼图才看得出是「分格」而不是一张被切开的大图。 */
export const GRID_GAP = 8;

export type StoryboardPng =
  | { ok: true; blob: Blob; filename: string; width: number; height: number; cells: number }
  | { ok: false; message: string };

export type AssetBytes =
  | { ok: true; bytes: ArrayBuffer; mime: string }
  | { ok: false; message: string };

/** 从 BlobStore 取某一格的原始字节，供「另存单格」用。 */
export async function readAssetBytes(assetId: string): Promise<AssetBytes> {
  const entry = useAssetStore.getState().assets[assetId];
  if (!entry) return { ok: false, message: '资产索引里找不到这一格' };
  const runtime = await resolveRuntime();
  const bytes = await runtime.blobs.get(entry.blobKey);
  if (!bytes) return { ok: false, message: '这一格的文件丢失了' };
  return { ok: true, bytes, mime: entry.asset.mime || 'application/octet-stream' };
}

/**
 * 把节点的分格按 gridLayout 拼成一张 PNG。
 *
 * 每格都拉伸到统一的 cell 尺寸 —— 不同厂商返回的图可能有几像素差异，
 * 不统一的话拼出来会歪。格数不足时缺位留背景色，不拿已有的图去补位。
 */
export async function buildStoryboardPng(nodeId: string): Promise<StoryboardPng> {
  const node = useGraphStore.getState().nodes[nodeId];
  if (!node) return { ok: false, message: '节点不存在' };
  if (node.defKind !== 'storyboard') return { ok: false, message: '只有分镜节点能导出拼图' };

  const ids = node.derivedAssetIds ?? [];
  if (ids.length === 0) return { ok: false, message: '还没有分格可导出' };

  const { assets } = useAssetStore.getState();
  const entries: AssetEntry[] = [];
  for (const id of ids) {
    const found = assets[id];
    if (found) entries.push(found);
  }
  if (entries.length === 0) return { ok: false, message: '分格资产已丢失' };

  try {
    const runtime = await resolveRuntime();
    const images: HTMLImageElement[] = [];
    for (const entry of entries) {
      const bytes = await runtime.blobs.get(entry.blobKey);
      if (!bytes) return { ok: false, message: `第 ${images.length + 1} 格的文件丢失了` };
      images.push(await decodeImage(bytes, entry.asset.mime));
    }

    const first = images[0]!;
    const layout = gridLayout(String(node.params.grid ?? '2x2'), first.naturalWidth, first.naturalHeight, GRID_GAP);

    const { canvas, ctx } = makeCanvas(layout.width, layout.height);
    ctx.fillStyle = '#0a0a09';
    ctx.fillRect(0, 0, layout.width, layout.height);
    const drawn = Math.min(images.length, layout.cells.length);
    for (let i = 0; i < drawn; i += 1) {
      const rect = layout.cells[i]!;
      ctx.drawImage(images[i]!, rect.x, rect.y, rect.width, rect.height);
    }

    return {
      ok: true,
      blob: await toPng(canvas),
      filename: `分镜-${layout.rows}x${layout.cols}-${drawn}格.png`,
      width: layout.width,
      height: layout.height,
      cells: drawn,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '拼图导出失败' };
  }
}
