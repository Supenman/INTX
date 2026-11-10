import {
  contentPath,
  createAsset,
  cropToPixels,
  sha256Hex,
  type CropRect,
  type NormalizedPoint,
} from '@/domain';
import { findAssetByHash, getAsset, putAsset, type AssetEntry } from '@/app/stores/assetStore';
import { resolveRuntime } from '@/infra/runtime';
import { decodeImage, makeCanvas, toPng } from './imageCanvas';

/**
 * 素材编辑（S4 第二块）：裁切与遮罩。
 *
 * 与「导出下载」不同，这里的产物要**回到资产库**：编辑结果是一张新 Asset，
 * 有自己的内容哈希、能拖回画布、能随项目文件刷新恢复、能被下一次编辑引用。
 * 只在浏览器里下载一张图是不够的——那等于又回到旧代码「结果只活在节点上」。
 *
 * 编辑产物用 origin.type = 'edit' 记住来源资产，形成可追溯的派生链。
 */

export interface MaskStroke {
  /** 归一化坐标，相对原图 */
  points: NormalizedPoint[];
  /** 笔刷半径，相对原图宽度的比例 */
  radius: number;
}

export type EditResult =
  | {
      ok: true;
      blob: Blob;
      filename: string;
      width: number;
      height: number;
      /** 原图尺寸，UI 用来显示「裁掉了多少」 */
      sourceSize: { width: number; height: number };
      assetId: string;
      /** 命中已有哈希，没有重复存字节 */
      reused: boolean;
    }
  | { ok: false; message: string };

type Source =
  | { entry: AssetEntry; img: HTMLImageElement }
  | { error: string };

async function loadSource(assetId: string): Promise<Source> {
  const entry = getAsset(assetId);
  if (!entry) return { error: '资产索引里找不到这张图' };
  if (entry.asset.kind !== 'image') return { error: '只能编辑图片资产' };

  const runtime = await resolveRuntime();
  const bytes = await runtime.blobs.get(entry.blobKey);
  if (!bytes) return { error: '原图文件丢失了' };
  try {
    return { entry, img: await decodeImage(bytes, entry.asset.mime) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : '原图解码失败' };
  }
}

/** 编辑结果按内容哈希落盘，同图只存一份；返回可下载的 Blob。 */
async function persistEdited(
  blob: Blob,
  entry: AssetEntry,
  filename: string,
  width: number,
  height: number,
  img: HTMLImageElement,
): Promise<EditResult> {
  const bytes = await blob.arrayBuffer();
  const hash = await sha256Hex(bytes);
  const sourceSize = { width: img.naturalWidth, height: img.naturalHeight };

  const existing = findAssetByHash(hash);
  if (existing) {
    return { ok: true, blob, filename, width, height, sourceSize, assetId: existing.asset.id, reused: true };
  }

  const created = createAsset({
    mime: 'image/png',
    hash,
    bytes: bytes.byteLength,
    path: contentPath(hash, 'png'),
    origin: { type: 'edit', sourceAssetId: entry.asset.id },
    width,
    height,
  });
  if (!created.ok) return { ok: false, message: created.error.message };

  const runtime = await resolveRuntime();
  await runtime.blobs.put(hash, bytes, 'image/png');
  putAsset({ asset: created.value, blobKey: hash });
  return { ok: true, blob, filename, width, height, sourceSize, assetId: created.value.id, reused: false };
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : '素材编辑失败';
}

/** 按归一化矩形裁切，输出分辨率等于原图像素，不受编辑器显示缩放影响。 */
export async function saveCrop(assetId: string, rect: CropRect): Promise<EditResult> {
  const src = await loadSource(assetId);
  if ('error' in src) return { ok: false, message: src.error };
  const { entry, img } = src;

  try {
    const px = cropToPixels(rect, img.naturalWidth, img.naturalHeight);
    const { canvas, ctx } = makeCanvas(px.width, px.height);
    ctx.drawImage(img, px.x, px.y, px.width, px.height, 0, 0, px.width, px.height);
    const blob = await toPng(canvas);
    return await persistEdited(blob, entry, `裁切-${px.width}x${px.height}.png`, px.width, px.height, img);
  } catch (e) {
    return { ok: false, message: messageOf(e) };
  }
}

/**
 * 导出黑白蒙版：涂抹处白色、其余黑色，尺寸与原图一致。
 *
 * 这是给后续 inpainting / 局部重绘准备的输入，不是把图变透明。
 * 尺寸必须等于原图，否则厂商侧对不上坐标。
 */
export async function saveMask(assetId: string, strokes: readonly MaskStroke[]): Promise<EditResult> {
  if (strokes.length === 0) return { ok: false, message: '还没涂抹遮罩' };
  const src = await loadSource(assetId);
  if ('error' in src) return { ok: false, message: src.error };
  const { entry, img } = src;

  try {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const { canvas, ctx } = makeCanvas(w, h);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const stroke of strokes) {
      const radius = Math.max(2, stroke.radius * w);
      ctx.lineWidth = radius * 2;
      const first = stroke.points[0];
      if (!first) continue;
      if (stroke.points.length === 1) {
        ctx.beginPath();
        ctx.arc(first.x * w, first.y * h, radius, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(first.x * w, first.y * h);
      for (let i = 1; i < stroke.points.length; i += 1) {
        const pt = stroke.points[i]!;
        ctx.lineTo(pt.x * w, pt.y * h);
      }
      ctx.stroke();
    }

    const blob = await toPng(canvas);
    return await persistEdited(blob, entry, `遮罩-${w}x${h}.png`, w, h, img);
  } catch (e) {
    return { ok: false, message: messageOf(e) };
  }
}
