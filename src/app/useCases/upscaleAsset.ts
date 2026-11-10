import {
  contentPath,
  createAsset,
  isUpscaleScale,
  sha256Hex,
  type UpscaleScale,
  type UpscaleUnavailable,
} from '@/domain';
import { findAssetByHash, getAsset, putAsset } from '@/app/stores/assetStore';
import { resolveRuntime } from '@/infra/runtime';
import { selectUpscaler } from '@/infra/upscale';

/**
 * 超分用例：把一张图片资产放大并存成**新资产**。
 *
 * 与素材编辑同一条原则：产物要回到资产库，不是只在浏览器里下载一张图。
 * 后端由注册表决定（本地 ONNX 优先、参考重采样兜底），用例本身不关心
 * 推理跑在哪，也不假装知道进度——本地放大要么没开始，要么已经完成。
 */

export interface UpscaleSuccess {
  ok: true;
  blob: Blob;
  filename: string;
  width: number;
  height: number;
  sourceSize: { width: number; height: number };
  assetId: string;
  /** 命中已有哈希，没有重复存字节 */
  reused: boolean;
  backendLabel: string;
  backendAi: boolean;
  /** 是否退到了非首选实现 */
  fallback: boolean;
  /** 未就绪后端的补齐说明，UI 用来显示「正式路线还差什么」 */
  missing: string[];
  elapsedMs: number;
}

export type UpscaleResult =
  | UpscaleSuccess
  | { ok: false; message: string; hint?: string };

function describeMissing(
  probes: Awaited<ReturnType<typeof selectUpscaler>>['probes'],
): string[] {
  const out: string[] = [];
  for (const p of probes) {
    if (p.availability.ok) continue;
    const m: UpscaleUnavailable = p.availability.missing;
    out.push(`${p.adapter.label}：${m.message}${m.hint ? `（${m.hint}）` : ''}`);
  }
  return out;
}

export async function upscaleAsset(
  assetId: string,
  scale: UpscaleScale,
  opts: { signal?: AbortSignal } = {},
): Promise<UpscaleResult> {
  if (!isUpscaleScale(scale)) {
    return { ok: false, message: `不支持的放大倍率：${String(scale)}` };
  }
  const entry = getAsset(assetId);
  if (!entry) return { ok: false, message: '资产索引里找不到这张图' };
  if (entry.asset.kind !== 'image') return { ok: false, message: '只能放大图片资产' };

  // 先探测后端：条件不具备时不要去读字节、也不要假装会成功。
  const selection = await selectUpscaler();
  if (!selection.adapter) {
    return { ok: false, message: '没有可用的放大后端', hint: describeMissing(selection.probes).join('；') };
  }
  const started = Date.now();

  const runtime = await resolveRuntime();
  const bytes = await runtime.blobs.get(entry.blobKey);
  if (!bytes) return { ok: false, message: '原图文件丢失了' };

  const r = await selection.adapter.upscale({
    bytes,
    mime: entry.asset.mime,
    scale,
    sourcePath: entry.asset.path,
    signal: opts.signal,
  });
  if (!r.ok) {
    return { ok: false, message: r.error.message, hint: r.error.hint };
  }
  if (opts.signal?.aborted) return { ok: false, message: '已取消放大' };

  const image = r.value;
  const hash = await sha256Hex(image.bytes);
  const filename = `放大-${scale}x-${image.width}x${image.height}.png`;
  const blob = new Blob([image.bytes], { type: image.mime });
  const sourceSize = { width: entry.asset.width ?? image.width / scale, height: entry.asset.height ?? image.height / scale };
  const common = {
    blob,
    filename,
    width: image.width,
    height: image.height,
    sourceSize,
    backendLabel: selection.adapter.label,
    backendAi: selection.adapter.ai,
    fallback: selection.fallback,
    missing: describeMissing(selection.probes),
    elapsedMs: Date.now() - started,
  };

  const existing = findAssetByHash(hash);
  if (existing) {
    return { ok: true, ...common, assetId: existing.asset.id, reused: true };
  }

  const created = createAsset({
    mime: image.mime,
    hash,
    bytes: image.bytes.byteLength,
    path: contentPath(hash, 'png'),
    origin: {
      type: 'upscale',
      sourceAssetId: entry.asset.id,
      scale,
      backend: selection.adapter.id,
    },
    width: image.width,
    height: image.height,
  });
  if (!created.ok) return { ok: false, message: created.error.message };

  await runtime.blobs.put(hash, image.bytes, image.mime);
  putAsset({ asset: created.value, blobKey: hash });
  return { ok: true, ...common, assetId: created.value.id, reused: false };
}
