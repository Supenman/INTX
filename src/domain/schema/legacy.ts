import { createId } from '../shared/id';
import { err, ok, type Result } from '../shared/result';
import { assetNode, generateNode, storyboardNode, textInputNode } from '../node/builtins';
import { defaultParams, findPort, type NodeDefinition, type ParamValue } from '../node/definition';
import { validateConnection, type ExistingEdge, type PortType } from '../node/port';
import { defaultNodeSize } from '../node/size';
import { CURRENT_SCHEMA_VERSION, type ProjectEdge, type ProjectFile, type ProjectNode } from './project';

/**
 * 旧 BeastTV / INTX 数据迁移（S5）。
 *
 * 旧格式不是猜的，逐条核实自旧仓库源码：
 * - `src/utils/canvasStorage.js`：`beasttv-canvas` 存
 *   `{ nodes, edges, nodeIdCounter, nodeStates, savedAt }`
 * - `src/utils/projectStorage.js`：`beasttv-projects` 是项目索引，
 *   `beasttv-project-<id>` 存同形状的项目数据（多 id / name / createdAt / updatedAt）
 * - `src/domain/nodeTypes.jsx`：节点类型冻结为
 *   image / text / video / source-{text,image,video,audio,markdown}
 * - 旧边只有 `source` / `target`，传什么内容是运行时靠节点类型猜的
 *
 * 迁移原则和项目其余部分一致（不编造、失败可见）：
 * 1. 只迁移能确证含义的字段：id / position / type / data 里的文本。
 * 2. 旧产物一律不迁移。旧代码把结果 URL 埋在 `node.data`，多为临时地址、
 *    没有内容哈希；硬塞进新 Asset 只会造出一批指向空气的资产。
 * 3. 无法识别的节点不静默丢弃：落成「文字输入」占位，把原始 data 以文本快照保留。
 * 4. 连线按新端口语义补全，并用 `validateConnection()` 校验；不合法的进报告而不是硬写。
 *
 * 这一层不碰 localStorage / 文件 IO，是纯函数，可在 node 环境直接单测。
 */

export const LEGACY_CANVAS_KEY = 'beasttv-canvas';
export const LEGACY_PROJECT_INDEX_KEY = 'beasttv-projects';
export const LEGACY_PROJECT_PREFIX = 'beasttv-project-';
export const LEGACY_CURRENT_KEY = 'beasttv-current-project';

export type LegacySourceKind = 'canvas' | 'project' | 'file';

export interface LegacyNode {
  id?: unknown;
  type?: unknown;
  position?: unknown;
  data?: unknown;
  [key: string]: unknown;
}

export interface LegacyEdge {
  id?: unknown;
  source?: unknown;
  target?: unknown;
  sourceHandle?: unknown;
  targetHandle?: unknown;
  [key: string]: unknown;
}

export interface LegacyDocument {
  source: LegacySourceKind;
  label: string;
  name: string;
  nodes: LegacyNode[];
  edges: LegacyEdge[];
  nodeStates: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  /** 顶层存在但本导入器不消费的字段，如实列进报告 */
  unusedTopLevelFields: string[];
}

export interface LegacyParseOptions {
  source?: LegacySourceKind;
  label?: string;
  name?: string;
}

/** 顶层字段白名单：这些字段要么被消费，要么其含义已明确（计数器/时间戳）。 */
const KNOWN_TOP_LEVEL = new Set([
  'nodes', 'edges', 'nodeIdCounter', 'nodeStates', 'savedAt',
  'id', 'name', 'createdAt', 'updatedAt', 'source', 'label',
]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function parseLegacyText(text: string, opts: LegacyParseOptions = {}): Result<LegacyDocument, string> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return err('文件不是合法的 JSON');
  }
  if (!isRecord(raw)) return err('旧项目文件应当是一个 JSON 对象');

  // 用户拿错文件时给明确指引，而不是报一句看不懂的结构错误
  if (raw.format === 'intx-project') return err('这是新版 .intx 项目包，请用「导入 .intx」');
  if (typeof raw.schemaVersion === 'number') return err('这是新版项目文件（带 schemaVersion），不是旧格式');
  if (!Array.isArray(raw.nodes)) return err('找不到旧画布的 nodes 数组');

  const unusedTopLevelFields = Object.keys(raw)
    .filter((k) => !KNOWN_TOP_LEVEL.has(k))
    .sort();

  return ok({
    source: opts.source ?? 'file',
    label: opts.label ?? '旧版 JSON 文件',
    name: opts.name ?? (typeof raw.name === 'string' && raw.name.trim() ? raw.name : '未命名旧项目'),
    nodes: raw.nodes as LegacyNode[],
    edges: Array.isArray(raw.edges) ? (raw.edges as LegacyEdge[]) : [],
    nodeStates: isRecord(raw.nodeStates) ? raw.nodeStates : {},
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
    updatedAt:
      typeof raw.updatedAt === 'number'
        ? raw.updatedAt
        : typeof raw.savedAt === 'number'
          ? raw.savedAt
          : 0,
    unusedTopLevelFields,
  });
}

// —— 类型映射 ——

interface TypeMapping {
  defKind: string;
  summary: string;
}

const TYPE_MAP: Record<string, TypeMapping> = {
  image: { defKind: 'generate', summary: '产出类型设为图片，提示词保留' },
  video: { defKind: 'generate', summary: '产出类型设为视频，提示词保留' },
  text: { defKind: 'text-input', summary: '旧的文字生成 / 模型配置不迁移' },
  'source-text': { defKind: 'text-input', summary: '源文本 → 文字输入' },
  'source-markdown': { defKind: 'text-input', summary: '只保留纯文本，Markdown 渲染不迁移' },
  'source-image': { defKind: 'asset', summary: '原始文件字节不迁移' },
  'source-video': { defKind: 'asset', summary: '原始文件字节不迁移' },
  'source-audio': { defKind: 'asset', summary: '原始文件字节不迁移' },
};

const DEF_BY_KIND: Record<string, NodeDefinition> = {
  'text-input': textInputNode,
  asset: assetNode,
  generate: generateNode,
  storyboard: storyboardNode,
};

const TEXT_KEYS = ['prompt', 'content', 'text', 'value', 'label', 'title', 'caption'] as const;

function extractText(data: Record<string, unknown>): { value: string; key: string | null } {
  for (const k of TEXT_KEYS) {
    const v = data[k];
    if (typeof v === 'string') return { value: v, key: k };
  }
  return { value: '', key: null };
}

function paramsFor(
  defKind: string,
  legacyType: string,
  data: Record<string, unknown>,
): { params: Record<string, ParamValue>; consumedKey: string | null; localConsumed: Set<string> } {
  const def = DEF_BY_KIND[defKind] ?? textInputNode;
  const params = defaultParams(def);
  const { value, key } = extractText(data);
  const localConsumed = new Set<string>();
  if (key) localConsumed.add(key);

  if (defKind === 'generate') {
    params.prompt = value;
    params.outputKind = legacyType === 'video' ? 'video' : 'image';
  } else if (defKind === 'text-input') {
    params.content = value;
  } else if (defKind === 'asset') {
    params.caption = value;
  }
  return { params, consumedKey: key, localConsumed };
}

function safeSnapshot(data: Record<string, unknown>): string {
  try {
    return (JSON.stringify(data, null, 2) ?? '{}').slice(0, 2000);
  } catch {
    return '[原始 data 无法序列化]';
  }
}

function readPosition(raw: unknown): { x: number; y: number } {
  const p = isRecord(raw) ? raw : {};
  return {
    x: typeof p.x === 'number' && Number.isFinite(p.x) ? p.x : 0,
    y: typeof p.y === 'number' && Number.isFinite(p.y) ? p.y : 0,
  };
}

/** id 一律转成字符串；缺失则新造，重复则加后缀，并如实记一条。 */
function normalizeId(raw: unknown, prefix: string, used: Set<string>, notes: LegacyNote[]): string {
  const base = raw === undefined || raw === null || raw === '' ? createId(prefix) : String(raw);
  let id = base;
  let n = 2;
  while (used.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  if (id !== base) {
    notes.push({ level: 'warn', code: 'id_normalized', message: `重复的旧 id「${base}」被改成「${id}」` });
  }
  used.add(id);
  return id;
}

// —— 报告 ——

export type LegacyNoteCode =
  | 'source'
  | 'type_mapped'
  | 'type_fallback'
  | 'edge_mapped'
  | 'edge_dropped'
  | 'field_dropped'
  | 'id_normalized'
  | 'no_assets';

export interface LegacyNote {
  level: 'info' | 'warn';
  code: LegacyNoteCode;
  message: string;
}

export interface LegacyReport {
  source: LegacySourceKind;
  label: string;
  name: string;
  nodeCount: number;
  edgeCount: number;
  mappedNodes: number;
  fallbackNodes: number;
  droppedEdges: number;
  consumedFields: string[];
  ignoredFields: string[];
  droppedEdgeReasons: string[];
  notes: LegacyNote[];
}

export interface LegacyMigration {
  file: ProjectFile;
  report: LegacyReport;
}

export interface LegacyMigrateOptions {
  now?: number;
  projectId?: string;
}

/** 旧边的端口语义：按目标节点的输入口反推，源类型只用来区分提示词口和参考口。 */
function edgePorts(
  sourceKind: string,
  targetKind: string,
  sourceType: PortType,
): { sourcePort: string; targetPort: string } | null {
  const sourcePort = sourceKind === 'text-input' ? 'text' : 'out';
  let targetPort: string | null = null;
  if (targetKind === 'generate') {
    targetPort = sourceType === 'text' ? 'prompt' : 'reference';
  } else if (targetKind === 'storyboard') {
    targetPort = sourceType === 'text' ? 'script' : sourceType === 'image' ? 'reference' : null;
  }
  return targetPort ? { sourcePort, targetPort } : null;
}

export function migrateLegacy(doc: LegacyDocument, opts: LegacyMigrateOptions = {}): LegacyMigration {
  const now = opts.now ?? Date.now();
  const notes: LegacyNote[] = [
    { level: 'info', code: 'source', message: `来源：${doc.label}` },
  ];

  const usedNodeIds = new Set<string>();
  const usedEdgeIds = new Set<string>();
  const idMap = new Map<string, string>();
  const kindById = new Map<string, string>();
  const sourceTypeById = new Map<string, PortType>();
  const consumed = new Set<string>();
  const ignored = new Set<string>();
  const mappedCounts = new Map<string, number>();
  const fallbackCounts = new Map<string, number>();
  let fallbackTotal = 0;

  const nodes: ProjectNode[] = [];

  for (const raw of doc.nodes) {
    const data = isRecord(raw.data) ? raw.data : {};
    const legacyType = typeof raw.type === 'string' ? raw.type : '';
    const mapping = TYPE_MAP[legacyType];
    const defKind = mapping ? mapping.defKind : 'text-input';
    const fallback = !mapping;

    let params: Record<string, ParamValue>;
    const localConsumed = new Set<string>();

    if (fallback) {
      const label = legacyType || '未标注';
      params = {
        ...defaultParams(textInputNode),
        content: `[旧节点类型「${label}」未识别]\n${safeSnapshot(data)}`,
      };
      for (const k of Object.keys(data)) localConsumed.add(k); // 整体快照保留
      fallbackCounts.set(label, (fallbackCounts.get(label) ?? 0) + 1);
      fallbackTotal += 1;
    } else {
      const built = paramsFor(defKind, legacyType, data);
      params = built.params;
      for (const k of built.localConsumed) localConsumed.add(k);
      mappedCounts.set(legacyType, (mappedCounts.get(legacyType) ?? 0) + 1);
    }

    for (const k of Object.keys(data)) {
      if (fallback || localConsumed.has(k)) continue;
      ignored.add(k);
    }
    for (const k of localConsumed) consumed.add(k);

    const oldId = raw.id == null ? null : String(raw.id);
    const id = normalizeId(raw.id, 'nd', usedNodeIds, notes);
    if (oldId !== null) idMap.set(oldId, id);

    let sourceType: PortType = 'image';
    if (defKind === 'text-input') {
      sourceType = 'text';
    } else if (defKind === 'generate') {
      const k = params.outputKind;
      sourceType = k === 'video' ? 'video' : k === 'text' ? 'text' : 'image';
    }

    nodes.push({
      id,
      defKind,
      position: readPosition(raw.position),
      size: defaultNodeSize(defKind),
      params,
    });
    kindById.set(id, defKind);
    sourceTypeById.set(id, sourceType);
  }

  // —— 连线：补全端口并校验 ——
  const edges: ProjectEdge[] = [];
  const existing: ExistingEdge[] = [];
  const droppedReasons: string[] = [];

  for (const raw of doc.edges) {
    const oldSource = raw.source == null ? null : String(raw.source);
    const oldTarget = raw.target == null ? null : String(raw.target);
    const source = oldSource === null ? undefined : idMap.get(oldSource);
    const target = oldTarget === null ? undefined : idMap.get(oldTarget);
    const pair = `${oldSource ?? '?'} → ${oldTarget ?? '?'}`;

    if (!source || !target) {
      droppedReasons.push(`${pair}：两端有节点没被迁移过来`);
      continue;
    }
    const sourceKind = kindById.get(source) ?? 'text-input';
    const targetKind = kindById.get(target) ?? 'text-input';
    const sourceType = sourceTypeById.get(source) ?? 'image';
    const ports = edgePorts(sourceKind, targetKind, sourceType);
    if (!ports) {
      droppedReasons.push(`${pair}：目标「${targetKind}」没有可用的输入口`);
      continue;
    }

    const sourceDef = DEF_BY_KIND[sourceKind] ?? textInputNode;
    const targetDef = DEF_BY_KIND[targetKind] ?? textInputNode;
    const issues = validateConnection({
      intent: {
        sourceNodeId: source,
        sourcePortId: ports.sourcePort,
        targetNodeId: target,
        targetPortId: ports.targetPort,
      },
      sourcePort: findPort(sourceDef.outputPorts, ports.sourcePort),
      targetPort: findPort(targetDef.inputPorts, ports.targetPort),
      sourceType,
      existingEdges: existing,
    });
    if (issues.length > 0) {
      droppedReasons.push(`${pair}：${issues.map((i) => i.message).join('；')}`);
      continue;
    }

    edges.push({
      id: normalizeId(raw.id, 'eg', usedEdgeIds, notes),
      source,
      sourcePort: ports.sourcePort,
      target,
      targetPort: ports.targetPort,
    });
    existing.push({
      sourceNodeId: source,
      sourcePortId: ports.sourcePort,
      targetNodeId: target,
      targetPortId: ports.targetPort,
    });
  }

  // —— 汇总报告：聚合，不按节点刷屏 ——
  for (const [t, count] of mappedCounts) {
    notes.push({
      level: 'info',
      code: 'type_mapped',
      message: `${t} → ${TYPE_MAP[t]?.defKind ?? '?'}（${count} 个）：${TYPE_MAP[t]?.summary ?? ''}`,
    });
  }
  for (const [t, count] of fallbackCounts) {
    notes.push({
      level: 'warn',
      code: 'type_fallback',
      message: `无法识别的旧类型「${t}」共 ${count} 个，已落成文字输入占位并保留原始内容快照`,
    });
  }
  notes.push({
    level: 'info',
    code: 'edge_mapped',
    message: `${edges.length} 条连线已按新端口语义补全 sourcePort / targetPort 并通过校验`,
  });
  if (droppedReasons.length > 0) {
    notes.push({
      level: 'warn',
      code: 'edge_dropped',
      message: `${droppedReasons.length} 条连线未迁移（详见下方清单）`,
    });
  }

  const ignoredFields = [...ignored].sort();
  if (ignoredFields.length > 0) {
    notes.push({
      level: 'warn',
      code: 'field_dropped',
      message: `以下旧 data 字段无法推断含义，未迁移：${ignoredFields.join('、')}`,
    });
  }
  if (doc.unusedTopLevelFields.length > 0) {
    notes.push({
      level: 'warn',
      code: 'field_dropped',
      message: `以下顶层字段未迁移：${doc.unusedTopLevelFields.join('、')}`,
    });
  }
  if (Object.keys(doc.nodeStates).length > 0) {
    notes.push({
      level: 'warn',
      code: 'no_assets',
      message: `旧 nodeStates 里有 ${Object.keys(doc.nodeStates).length} 条运行状态记录，不迁移（新版任务状态走 tasks.jsonl / IndexedDB 日志）`,
    });
  }
  notes.push({
    level: 'warn',
    code: 'no_assets',
    message:
      '旧节点的产物（图片 URL、输出历史、模型与尺寸配置）一律不迁移：旧格式把结果埋在 node.data 且多为临时地址，没有内容哈希，无法保证可还原。请重新生成或手动导入素材；资产库保持原样。',
  });

  const file: ProjectFile = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    project: {
      id: opts.projectId ?? 'default',
      name: doc.name,
      createdAt: doc.createdAt || now,
      updatedAt: now,
    },
    nodes,
    edges,
    assets: [],
    tasks: [],
  };

  return {
    file,
    report: {
      source: doc.source,
      label: doc.label,
      name: doc.name,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      mappedNodes: nodes.length - fallbackTotal,
      fallbackNodes: fallbackTotal,
      droppedEdges: droppedReasons.length,
      consumedFields: [...consumed].sort(),
      ignoredFields,
      droppedEdgeReasons: droppedReasons,
      notes,
    },
  };
}
