import type { Asset } from '../asset/model';
import type { Task } from '../task/model';
import type { ParamValue } from '../node/definition';

/**
 * 项目文件 schema 与迁移。
 *
 * 旧项目的问题：`node.data` 是无类型开放字典，没有 schemaVersion，
 * 任何字段改名都会让老项目数据半死。
 *
 * 这里每个项目文件带 schemaVersion，迁移是显式的、可测试的函数链。
 * 加版本时：CURRENT_SCHEMA_VERSION + 1，并在 MIGRATIONS 里补一条。
 */

export const CURRENT_SCHEMA_VERSION = 1;

export interface NodePosition {
  x: number;
  y: number;
}

export interface NodeSize {
  width: number;
  height: number;
}

export interface ProjectNode {
  id: string;
  /** 指向 NodeDefinition.kind */
  defKind: string;
  position: NodePosition;
  size: NodeSize;
  params: Record<string, ParamValue>;
  /** 节点展示用产物。关键：只存 id，不内联 URL。 */
  assetId?: string;
  /** 最近一次任务 id，用于展示状态与重跑 */
  lastTaskId?: string;
}

export interface ProjectEdge {
  id: string;
  source: string;
  sourcePort: string;
  target: string;
  /** 连线的语义就落在这里，而不是运行时去猜 */
  targetPort: string;
}

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectFile {
  schemaVersion: number;
  project: ProjectMeta;
  nodes: ProjectNode[];
  edges: ProjectEdge[];
  assets: Asset[];
  /** 只保留最近的 N 条任务，完整日志在 tasks.jsonl */
  tasks: Task[];
  viewport?: { x: number; y: number; zoom: number };
}

const MAX_TASKS_IN_PROJECT = 200;

export interface MigrationIssue {
  code: 'unknown_version' | 'future_version' | 'malformed';
  message: string;
}

type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

/**
 * 迁移表。键是「从哪个版本升上来」。
 * 例如 MIGRATIONS[1] 负责把 v1 文档升到 v2。
 *
 * 当前只有 v1，所以是空的；框架先建好，避免以后临时起意改 schema。
 */
const MIGRATIONS: Record<number, Migration> = {};

export function migrate(raw: unknown): { ok: true; value: ProjectFile } | { ok: false; error: MigrationIssue } {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: { code: 'malformed', message: '项目文件不是一个对象' } };
  }
  let doc = raw as Record<string, unknown>;
  const version = doc.schemaVersion;

  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: { code: 'malformed', message: `项目文件缺少合法的 schemaVersion：${String(version)}` } };
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    return {
      ok: false,
      error: {
        code: 'future_version',
        message: `项目文件版本 v${version} 高于当前支持的 v${CURRENT_SCHEMA_VERSION}，请升级应用`,
      },
    };
  }

  for (let v = version; v < CURRENT_SCHEMA_VERSION; v += 1) {
    const step = MIGRATIONS[v];
    if (!step) {
      return { ok: false, error: { code: 'unknown_version', message: `缺少 v${v} → v${v + 1} 的迁移规则` } };
    }
    doc = step(doc);
    doc.schemaVersion = v + 1;
  }

  const validated = validateProjectFile(doc);
  if (!validated.ok) return validated;
  return { ok: true, value: validated.value };
}

/** 结构校验：只保证读出来的东西形状对，不校验业务完整性（那是 loadUseCase 的事）。 */
export function validateProjectFile(doc: Record<string, unknown>): { ok: true; value: ProjectFile } | { ok: false; error: MigrationIssue } {
  const fail = (message: string) => ({ ok: false as const, error: { code: 'malformed' as const, message } });

  const project = doc.project as Record<string, unknown> | undefined;
  if (!project || typeof project.id !== 'string' || typeof project.name !== 'string') {
    return fail('项目缺少 id 或 name');
  }
  if (!Array.isArray(doc.nodes)) return fail('nodes 不是数组');
  if (!Array.isArray(doc.edges)) return fail('edges 不是数组');
  if (!Array.isArray(doc.assets)) return fail('assets 不是数组');

  const file: ProjectFile = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    project: {
      id: project.id,
      name: project.name,
      createdAt: typeof project.createdAt === 'number' ? project.createdAt : 0,
      updatedAt: typeof project.updatedAt === 'number' ? project.updatedAt : 0,
    },
    nodes: doc.nodes as ProjectNode[],
    edges: doc.edges as ProjectEdge[],
    assets: doc.assets as Asset[],
    tasks: Array.isArray(doc.tasks) ? (doc.tasks as Task[]) : [],
  };

  if (doc.viewport && typeof doc.viewport === 'object') {
    const v = doc.viewport as Record<string, unknown>;
    if (typeof v.x === 'number' && typeof v.y === 'number' && typeof v.zoom === 'number') {
      file.viewport = { x: v.x, y: v.y, zoom: v.zoom };
    }
  }

  return { ok: true, value: file };
}

/** 写入前裁剪：任务只留最近若干条，其余已在 tasks.jsonl 里。 */
export function trimForSave(file: ProjectFile): ProjectFile {
  if (file.tasks.length <= MAX_TASKS_IN_PROJECT) return file;
  const kept = [...file.tasks]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_TASKS_IN_PROJECT);
  return { ...file, tasks: kept };
}

/** 引用完整性检查：连线两端节点是否存在、assetId 是否指向存在的资产。 */
export interface IntegrityIssue {
  code: 'dangling_edge' | 'missing_asset' | 'unknown_node_kind';
  message: string;
}

export interface IntegrityInput {
  file: ProjectFile;
  knownNodeKinds: ReadonlySet<string>;
}

export function checkIntegrity({ file, knownNodeKinds }: IntegrityInput): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const nodeIds = new Set(file.nodes.map((n) => n.id));
  const assetIds = new Set(file.assets.map((a) => a.id));

  for (const edge of file.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      issues.push({
        code: 'dangling_edge',
        message: `连线 ${edge.id} 指向不存在的节点（${edge.source} → ${edge.target}）`,
      });
    }
  }
  for (const node of file.nodes) {
    if (node.assetId && !assetIds.has(node.assetId)) {
      issues.push({
        code: 'missing_asset',
        message: `节点 ${node.id} 引用的资产 ${node.assetId} 不存在`,
      });
    }
    if (!knownNodeKinds.has(node.defKind)) {
      issues.push({
        code: 'unknown_node_kind',
        message: `节点 ${node.id} 的类型「${node.defKind}」未注册`,
      });
    }
  }
  return issues;
}
