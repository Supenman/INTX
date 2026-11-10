import {
  LEGACY_CANVAS_KEY,
  LEGACY_PROJECT_INDEX_KEY,
  LEGACY_PROJECT_PREFIX,
  migrateLegacy,
  parseLegacyText,
  type LegacyDocument,
  type LegacyMigration,
  type LegacyReport,
  type LegacySourceKind,
} from '@/domain';
import { hydrateProject } from '@/infra/repository/projectRepository';
import { clearHistory } from '@/app/stores/historyStore';

/**
 * 旧版数据导入用例（S5）。
 *
 * 边界：domain 层只做纯解析与映射，这里负责宿主 IO（localStorage / 文件）
 * 和装载。扫描是**只读**的——绝不删旧 key，迁移失败用户还能重来。
 *
 * 导入会替换当前画布，但资产库保持原样：旧数据里没有可还原的产物字节，
 * 为了"看起来干净"去清空用户已有的资产是不可逆的破坏。
 */

export interface LegacyStorage {
  getItem(key: string): string | null;
}

export interface LegacySource {
  id: string;
  label: string;
  detail: string;
  /** 原始 JSON 文本，保留下来供预览与导入各解析一次 */
  text: string;
  source: LegacySourceKind;
  name: string;
}

export type LegacyPreview = { ok: true; report: LegacyReport } | { ok: false; message: string };

export interface LegacyImportResult {
  ok: boolean;
  message: string;
  report?: LegacyReport;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function safeGet(storage: LegacyStorage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null; // 隐私模式 / 权限受限时当作没有旧数据，不炸页面
  }
}

function toSource(id: string, label: string, text: string, doc: LegacyDocument): LegacySource {
  const when = doc.updatedAt > 0 ? new Date(doc.updatedAt).toLocaleString() : '时间未知';
  return {
    id,
    label,
    detail: `${doc.nodes.length} 个节点 · ${doc.edges.length} 条连线 · ${when}`,
    text,
    source: doc.source,
    name: doc.name,
  };
}

/**
 * 扫描本机 localStorage 里的旧数据。
 *
 * 两种来源都认：`beasttv-canvas` 老单画布，以及
 * `beasttv-projects` 索引指向的 `beasttv-project-<id>` 项目数据。
 * 索引条目损坏、对应数据缺失、或数据本身不是旧格式的，都安静跳过。
 */
export function scanLegacySources(storage: LegacyStorage): LegacySource[] {
  const out: LegacySource[] = [];

  const canvas = safeGet(storage, LEGACY_CANVAS_KEY);
  if (canvas) {
    const label = '本地存储 · 旧单画布';
    const parsed = parseLegacyText(canvas, { source: 'canvas', label });
    if (parsed.ok) out.push(toSource('canvas', label, canvas, parsed.value));
  }

  const indexText = safeGet(storage, LEGACY_PROJECT_INDEX_KEY);
  if (!indexText) return out;
  let entries: unknown;
  try {
    entries = JSON.parse(indexText);
  } catch {
    return out;
  }
  if (!Array.isArray(entries)) return out;

  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.id !== 'string') continue;
    const raw = safeGet(storage, LEGACY_PROJECT_PREFIX + entry.id);
    if (!raw) continue;
    const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name : '未命名旧项目';
    const label = `项目 · ${name}`;
    const parsed = parseLegacyText(raw, { source: 'project', label, name });
    if (parsed.ok) out.push(toSource(`project:${entry.id}`, label, raw, parsed.value));
  }
  return out;
}

/** 弹出系统文件选择框，只收 JSON。返回 null 表示用户取消。 */
export function pickLegacyFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

export async function readLegacyFile(picker: () => Promise<File | null> = pickLegacyFile): Promise<LegacySource | null> {
  const file = await picker();
  if (!file) return null;
  return {
    id: `file:${file.name}`,
    label: `文件 · ${file.name}`,
    detail: `${file.size} 字节`,
    text: await file.text(),
    source: 'file',
    name: file.name.replace(/\.json$/i, '') || '旧版 JSON 文件',
  };
}

function buildMigration(source: LegacySource): { ok: true; migration: LegacyMigration } | { ok: false; message: string } {
  const parsed = parseLegacyText(source.text, {
    source: source.source,
    label: source.label,
    name: source.name,
  });
  if (!parsed.ok) return { ok: false, message: parsed.error };
  return { ok: true, migration: migrateLegacy(parsed.value, { now: Date.now() }) };
}

/** 只出报告，不碰任何 store —— 用户先看清会丢什么再决定导入。 */
export function previewLegacy(source: LegacySource): LegacyPreview {
  const built = buildMigration(source);
  return built.ok ? { ok: true, report: built.migration.report } : { ok: false, message: built.message };
}

/** 确认后装载。资产库不动，历史清空（导入不属于可撤销的一次编辑）。 */
export async function applyLegacy(source: LegacySource): Promise<LegacyImportResult> {
  const built = buildMigration(source);
  if (!built.ok) return { ok: false, message: built.message };

  const { file, report } = built.migration;
  const { issues } = hydrateProject(file);
  clearHistory();

  const notes = [
    ...report.notes,
    ...issues.map((i) => ({ level: 'warn' as const, code: 'edge_dropped' as const, message: i.message })),
  ];
  return {
    ok: true,
    message: `已导入「${report.name}」：${report.nodeCount} 个节点、${report.edgeCount} 条连线`,
    report: { ...report, notes },
  };
}
