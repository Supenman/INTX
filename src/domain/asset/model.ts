import { createId } from '../shared/id';
import { err, ok, type Result } from '../shared/result';

/**
 * Asset —— 产物就是文件。
 *
 * 这是与旧架构最根本的差别之一：旧代码把生成结果以 URL 字符串塞进
 * `node.data.result`，删掉节点文件就成孤儿，同一张图被多处引用也存多份。
 * 这里 Asset 是独立实体，有 id、有内容哈希、有自己的生命周期，
 * 节点只持有 `assetId` 引用。
 */

export const ASSET_KINDS = ['image', 'video', 'audio', 'text'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export interface AssetOriginTask {
  type: 'task';
  taskId: string;
}

export interface AssetOriginImport {
  type: 'import';
}

export type AssetOrigin = AssetOriginTask | AssetOriginImport;

export interface Asset {
  id: string;
  kind: AssetKind;
  mime: string;
  /** 相对项目目录的路径，例如 assets/xxx.png */
  path: string;
  bytes: number;
  /** 内容哈希，用于去重。相同内容的图拖两次只存一份。 */
  hash: string;
  width?: number;
  height?: number;
  durationMs?: number;
  createdAt: number;
  origin: AssetOrigin;
  /** 软删除：进了回收站，但文件还在，可恢复 */
  deletedAt?: number;
}

export type AssetErrorCode = 'invalid_mime' | 'empty_content' | 'invalid_origin';

export interface AssetError {
  code: AssetErrorCode;
  message: string;
}

/** kind 与 mime 的对应关系，用于校验而不是"猜"。 */
const MIME_KIND_MAP: Record<string, AssetKind> = {
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'image/avif': 'image',
  'video/mp4': 'video',
  'video/webm': 'video',
  'video/quicktime': 'video',
  'audio/mpeg': 'audio',
  'audio/wav': 'audio',
  'audio/aac': 'audio',
  'audio/ogg': 'audio',
  'text/plain': 'text',
  'text/markdown': 'text',
  'application/json': 'text',
};

export function kindFromMime(mime: string): AssetKind | null {
  return MIME_KIND_MAP[mime.toLowerCase().split(';')[0]!.trim()] ?? null;
}

export function isSupportedMime(mime: string): boolean {
  return kindFromMime(mime) !== null;
}

export interface CreateAssetInput {
  mime: string;
  path: string;
  bytes: number;
  hash: string;
  origin: AssetOrigin;
  width?: number;
  height?: number;
  durationMs?: number;
  now?: number;
  id?: string;
}

/**
 * 创建 Asset。kind 由 mime 推导，不接受外部传入，
 * 避免出现 kind 与 mime 不一致的脏数据。
 */
export function createAsset(input: CreateAssetInput): Result<Asset, AssetError> {
  const kind = kindFromMime(input.mime);
  if (!kind) {
    return err({
      code: 'invalid_mime',
      message: `不支持的媒体类型：${input.mime}`,
    });
  }
  if (!input.hash) {
    return err({ code: 'empty_content', message: '资产缺少内容哈希，无法去重' });
  }
  if (input.origin.type === 'task' && !input.origin.taskId) {
    return err({ code: 'invalid_origin', message: '任务来源缺少 taskId' });
  }

  const asset: Asset = {
    id: input.id ?? createId('as'),
    kind,
    mime: input.mime,
    path: input.path,
    bytes: input.bytes,
    hash: input.hash,
    createdAt: input.now ?? Date.now(),
    origin: input.origin,
  };

  if (typeof input.width === 'number') asset.width = input.width;
  if (typeof input.height === 'number') asset.height = input.height;
  if (typeof input.durationMs === 'number') asset.durationMs = input.durationMs;

  return ok(asset);
}

/** 在资产集合里按内容哈希查找未删除的同内容资产，用于去重复用。 */
export function findByHash(assets: readonly Asset[], hash: string): Asset | undefined {
  return assets.find((a) => a.hash === hash && a.deletedAt === undefined);
}

export function softDeleteAsset(asset: Asset, now = Date.now()): Asset {
  return { ...asset, deletedAt: now };
}

export function restoreAsset(asset: Asset): Asset {
  const { deletedAt: _removed, ...rest } = asset;
  return rest;
}

export function isAlive(asset: Asset): boolean {
  return asset.deletedAt === undefined;
}
