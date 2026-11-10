import type { ProjectFile } from '@/domain';
import { collectAssetIndex } from './assetLibrary';
import { resolveRuntime } from '@/infra/runtime';
import { putAsset, useAssetStore } from '@/app/stores/assetStore';
import { clearHistory } from '@/app/stores/historyStore';
import { defaultProviders } from '@/app/stores/providerStore';
import { hydrateProject, snapshotProject } from '@/infra/repository/projectRepository';
import { migrate, CURRENT_SCHEMA_VERSION } from '@/domain';
import { useProviderStore } from '@/app/stores/providerStore';

/**
 * `.intx` 单文件包。
 *
 * 方案 §4.1 把它列为"持久化"的验收项。做法刻意选了 JSON 而不是 zip：
 * - 纯前端不需要额外依赖就能读回来；
 * - 文件是文本，坏了能用编辑器打开看一眼，排障成本低；
 * - 代价是 base64 让体积涨约 33%，但生成产物本来就是压缩过的图片，
 *   一个项目几十张图、几十 MB，本地文件完全够用。
 *
 * 厂商配置**不进包**：里面可能有 API Key，导出给别人等于把 key 送出去。
 * 这一条不是可选项。
 */

export const INTX_FORMAT = 'intx-project';
export const INTX_FORMAT_VERSION = 1;

export interface IntxBlob {
  mime: string;
  /** base64，不带 data: 前缀 */
  data: string;
}

export interface IntxPackage {
  format: typeof INTX_FORMAT;
  formatVersion: number;
  exportedAt: number;
  schemaVersion: number;
  project: ProjectFile;
  /** 键是内容哈希，与 asset.hash / blobKey 一致 */
  blobs: Record<string, IntxBlob>;
}

export function toBase64(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes);
  let bin = '';
  const CHUNK = 0x8000; // 分块，避免 String.fromCharCode(...huge) 爆栈
  for (let i = 0; i < arr.length; i += CHUNK) {
    bin += String.fromCharCode(...arr.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function fromBase64(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** 组装一份完整的项目包（含资产字节）。 */
export async function buildPackage(): Promise<IntxPackage> {
  const runtime = await resolveRuntime();
  const project = snapshotProject();
  project.assets = collectAssetIndex();

  const blobs: Record<string, IntxBlob> = {};
  for (const asset of project.assets) {
    const bytes = await runtime.blobs.get(asset.hash);
    if (!bytes) continue; // 文件丢了的资产跳过，但索引还在，UI 会显示"文件丢失"
    blobs[asset.hash] = { mime: asset.mime, data: toBase64(bytes) };
  }

  return {
    format: INTX_FORMAT,
    formatVersion: INTX_FORMAT_VERSION,
    exportedAt: Date.now(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    project,
    blobs,
  };
}

/** 文本序列化，单独抽出来便于测试往返，不需要浏览器下载 API。 */
export function serializePackage(pkg: IntxPackage): string {
  return JSON.stringify(pkg);
}

export function parsePackageText(text: string): { ok: true; pkg: IntxPackage } | { ok: false; message: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: '文件不是合法的 JSON' };
  }
  const pkg = raw as Partial<IntxPackage>;
  if (pkg.format !== INTX_FORMAT) return { ok: false, message: '这不是 INTX 项目包' };
  if (typeof pkg.formatVersion !== 'number' || pkg.formatVersion > INTX_FORMAT_VERSION) {
    return { ok: false, message: `项目包版本 v${String(pkg.formatVersion)} 高于当前支持的 v${INTX_FORMAT_VERSION}` };
  }
  if (!pkg.project || !pkg.blobs) return { ok: false, message: '项目包缺少 project 或 blobs' };
  return { ok: true, pkg: pkg as IntxPackage };
}

/** 触发浏览器下载。 */
export async function exportProject(): Promise<void> {
  const pkg = await buildPackage();
  const text = JSON.stringify(pkg);
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName(pkg.project.project.name)}.intx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 立刻 revoke 在部分浏览器会打断下载，延后一拍
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || '未命名项目';
}

/** 弹出系统文件选择框。返回 null 表示用户取消。 */
export function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.intx,application/json';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    // 用户关掉选择框时不会触发 change，这里用一次性的 focus 兜底
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

export interface ImportResult {
  ok: boolean;
  message: string;
  nodeCount?: number;
  assetCount?: number;
  issues?: string[];
}

/**
 * 导入并替换当前画布。
 *
 * 顺序很重要：先把字节写进 BlobStore，再装资产索引，最后装画布。
 * 反过来节点会先渲染一次空缩略图，闪一下。
 */
export async function importProject(
  picker: () => Promise<File | null>,
  onMessage?: (msg: string) => void,
): Promise<ImportResult> {
  const file = await picker();
  if (!file) return { ok: false, message: '已取消' };

  const parsed = parsePackageText(await file.text());
  if (!parsed.ok) return { ok: false, message: parsed.message };
  const pkg = parsed.pkg;

  const migrated = migrate(pkg.project);
  if (!migrated.ok) {
    return { ok: false, message: `项目文件无法读取：${migrated.error.message}` };
  }

  if (!window.confirm('导入会替换当前画布（资产库会合并）。继续吗？')) {
    return { ok: false, message: '已取消' };
  }

  const runtime = await resolveRuntime();
  let written = 0;
  for (const [hash, blob] of Object.entries(pkg.blobs)) {
    if (typeof blob?.data !== 'string') continue;
    if (await runtime.blobs.has(hash)) continue; // 内容寻址，同一份不重复写
    await runtime.blobs.put(hash, fromBase64(blob.data), blob.mime || 'application/octet-stream');
    written += 1;
  }

  // 资产索引：先清空再按包里的清单装，避免残留旧项目的孤儿
  useAssetStore.setState({ assets: {}, byHash: {}, ready: true });
  const issues: string[] = [];
  for (const asset of migrated.value.assets) {
    if (!(await runtime.blobs.has(asset.hash))) {
      issues.push(`资产 ${asset.id} 的字节不在包里`);
      continue;
    }
    putAsset({ asset, blobKey: asset.hash });
  }

  const { issues: integrity } = hydrateProject(migrated.value);
  clearHistory();
  issues.push(...integrity.map((i) => i.message));

  const msg = `导入完成：${migrated.value.nodes.length} 个节点、${migrated.value.assets.length} 个资产（新写入 ${written} 个文件）`;
  onMessage?.(msg);
  return {
    ok: true,
    message: msg,
    nodeCount: migrated.value.nodes.length,
    assetCount: migrated.value.assets.length,
    issues,
  };
}

/** 给测试用的纯逻辑：校验一份包是否可读，不碰 IO。 */
export function inspectPackage(raw: unknown): { ok: true; project: ProjectFile } | { ok: false; message: string } {
  const pkg = raw as Partial<IntxPackage> | null;
  if (!pkg || pkg.format !== INTX_FORMAT) return { ok: false, message: '格式不对' };
  if (!pkg.project) return { ok: false, message: '缺少 project' };
  const m = migrate(pkg.project);
  return m.ok ? { ok: true, project: m.value } : { ok: false, message: m.error.message };
}

// 这两个符号被设置页/启动装配用到，集中导出省得各处深挖路径
export { defaultProviders, useProviderStore };
