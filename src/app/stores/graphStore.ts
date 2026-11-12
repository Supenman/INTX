import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  LAYOUT_STEP_X,
  LAYOUT_STEP_Y,
  alignNodes,
  autoLayout,
  createId,
  defaultNodeSize,
  defaultParams,
  distributeNodes,
  effectiveExistingEdges,
  expandBatchTitle,
  freeBatchOffset,
  requireNodeDefinition,
  sanitizeNodeTitle,
  sortForExport,
  validateConnection,
  type AlignMode,
  type DistributeAxis,
  type PortType,
  type PositionMap,
  type ProjectEdge,
  type ProjectNode,
} from '@/domain';
import { checkpoint, clearHistory } from './historyStore';

/**
 * 图状态。
 *
 * 与旧架构的差别：所有节点/连线都在这里，用 immer 做结构化更新，
 * 组件通过 selector 只订阅自己那一条（`s.nodes[id]`），
 * 拖一个节点不会让另外 199 个重渲染。
 *
 * 注意 id → 实体的字典结构。数组在增删时会让所有 selector 的引用变化，
 * 字典不会。
 */

export interface GraphState {
  nodes: Record<string, ProjectNode>;
  edges: Record<string, ProjectEdge>;
  /** 最近创建的节点 id，用于自动聚焦 */
  lastCreatedId: string | null;
}

export interface AddNodeInput {
  defKind: string;
  position: { x: number; y: number };
  size?: { width: number; height: number };
  params?: Record<string, string | number | boolean | null>;
}

export interface ConnectResult {
  ok: boolean;
  edgeId?: string;
  issues?: { code: string; message: string }[];
}

// 节点默认尺寸统一由 domain/node/size.ts 提供：新建节点与旧数据导入共用一份定义。

export const useGraphStore = create<GraphState>()(
  immer(() => ({
    nodes: {},
    edges: {},
    lastCreatedId: null,
  })),
);

// —— 纯操作函数，方便被用例层调用与测试 ——

/**
 * 新节点的摆放策略。
 *
 * 所有新节点都落在"视口中心"会完全重叠：用户第一次连点三个节点，
 * 只能看到最上面那个，而且被压住的节点连端口都点不到（实测如此）。
 *
 * 这里按"网格占位"摆放：找到第一个没被占用的格子。
 * 步长取最小节点宽度 + 间距，保证不同节点之间不会重叠。
 */
// 间距由 domain/node/layout.ts 单一定义：自动整理与「找空位摆放」必须用同一份，
// 否则整理完立刻再加节点就会落在别的节点身上。
/**
 * 两列。三列会把第三个节点推到视口外，用户以为没加上；
 * 行数也不设上限，纵向滚动是自然的（横向不会）。
 * 起点按视口左上角而不是中心计算，见 spawnNode。
 */
const GRID_COLS = 2;

function findFreeSlot(position: { x: number; y: number }, occupied: readonly { x: number; y: number }[]): { x: number; y: number } {
  const isFree = (p: { x: number; y: number }) =>
    occupied.every((o) => Math.abs(o.x - p.x) >= LAYOUT_STEP_X - 20 || Math.abs(o.y - p.y) >= LAYOUT_STEP_Y - 20);

  /**
   * 行数不能写死。50 行 × 2 列只够 100 格：第 101 个节点之后会全部退回
   * `position` 堆在同一个点（200 节点实测有 103 个节点完全重叠，端口点不到、
   * 拖拽也被上层节点截走）。按已有节点数动态推导行数，保证总有空格可落。
   */
  const maxRows = Math.max(50, Math.ceil(occupied.length / GRID_COLS) + 2);
  for (let row = 0; row < maxRows; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      const candidate = { x: position.x + col * LAYOUT_STEP_X, y: position.y + row * LAYOUT_STEP_Y };
      if (isFree(candidate)) return candidate;
    }
  }
  return position;
}

export function addNode(input: AddNodeInput): string {
  const def = requireNodeDefinition(input.defKind);
  checkpoint(`添加节点：${def.title}`);
  const id = createId('nd');
  useGraphStore.setState((s) => {
    const occupied = Object.values(s.nodes).map((n) => n.position);
    s.nodes[id] = {
      id,
      defKind: def.kind,
      position: findFreeSlot(input.position, occupied),
      size: input.size ?? defaultNodeSize(def.kind),
      params: { ...defaultParams(def), ...(input.params ?? {}) },
    };
    s.lastCreatedId = id;
  });
  return id;
}

export function removeNodes(ids: readonly string[]): void {
  if (ids.length > 0) checkpoint(ids.length === 1 ? '删除节点' : `删除 ${ids.length} 个节点`);
  useGraphStore.setState((s) => {
    const set = new Set(ids);
    for (const id of set) delete s.nodes[id];
    for (const [edgeId, edge] of Object.entries(s.edges)) {
      if (set.has(edge.source) || set.has(edge.target)) delete s.edges[edgeId];
    }
  });
}

/**
 * 批量写位置。整批算**一次**编辑、一次 checkpoint，
 * 对齐 8 个节点不该让 Ctrl+Z 按 8 次才退回原样。
 */
export function setNodePositions(positions: PositionMap, label: string): void {
  const current = useGraphStore.getState().nodes;
  // 布局纯函数返回的是完整目标位置，这里只挑真正变了的：
  // 否则「整理一次什么都没变」也会往历史里塞一条记录。
  const changed: PositionMap = {};
  for (const [id, p] of Object.entries(positions)) {
    const node = current[id];
    if (!node) continue;
    if (node.position.x !== p.x || node.position.y !== p.y) changed[id] = { x: p.x, y: p.y };
  }
  if (Object.keys(changed).length === 0) return;
  checkpoint(label);
  useGraphStore.setState((s) => {
    for (const [id, p] of Object.entries(changed)) {
      const node = s.nodes[id];
      if (node) node.position = { x: p.x, y: p.y };
    }
  });
}

export function alignSelected(ids: readonly string[], mode: AlignMode): void {
  const { nodes } = useGraphStore.getState();
  setNodePositions(alignNodes(Object.values(nodes), ids, mode), '对齐节点');
}

export function distributeSelected(ids: readonly string[], axis: DistributeAxis): void {
  const { nodes } = useGraphStore.getState();
  setNodePositions(distributeNodes(Object.values(nodes), ids, axis), '等距分布');
}

export function autoArrange(scopeIds?: readonly string[]): void {
  const { nodes, edges } = useGraphStore.getState();
  setNodePositions(
    autoLayout(Object.values(nodes), Object.values(edges), { scopeIds }),
    '自动整理节点',
  );
}

/**
 * 复制节点。返回新 id 列表，供 UI 把选中态切到副本上。
 *
 * 产物字段（assetId / derivedAssetIds）跟着复制：资产按内容哈希共享 blob，
 * 多一个引用不会多写一份文件；但 lastTaskId 不复制，否则副本会显示
 * 别人那次生成的状态，用户会以为副本也跑过任务。
 * 两端都在选区里的连线一并复制，复制出来仍是一张可运行的子图。
 *
 * `offset` 只是**首选**错位：固定 +40,+40 会让副本整个盖在原节点上
 * （节点宽约 340、高约 280），文字重影、端口点不到。整批共用一个
 * freeBatchOffset 的结果，既保持相对布局，又不压住任何已有节点。
 */
export function duplicateNodes(ids: readonly string[], offset = { x: 40, y: 40 }): string[] {
  const snapshot = useGraphStore.getState();
  const valid = ids.filter((id) => snapshot.nodes[id]);
  if (valid.length === 0) return [];

  checkpoint(valid.length === 1 ? '复制节点' : `复制 ${valid.length} 个节点`);
  const idMap = new Map<string, string>();
  for (const id of valid) idMap.set(id, createId('nd'));
  const shift = freeBatchOffset(
    valid
      .map((id) => snapshot.nodes[id])
      .filter((n): n is ProjectNode => n !== undefined)
      .map((n) => n.position),
    Object.values(snapshot.nodes).map((n) => n.position),
    offset,
  );

  useGraphStore.setState((s) => {
    for (const id of valid) {
      const src = snapshot.nodes[id];
      const newId = idMap.get(id);
      if (!src || !newId) continue;
      s.nodes[newId] = {
        id: newId,
        defKind: src.defKind,
        position: { x: src.position.x + shift.x, y: src.position.y + shift.y },
        size: { ...src.size },
        params: { ...src.params },
        ...(src.assetId ? { assetId: src.assetId } : {}),
        ...(src.derivedAssetIds ? { derivedAssetIds: [...src.derivedAssetIds] } : {}),
      };
    }
    for (const e of Object.values(snapshot.edges)) {
      const ns = idMap.get(e.source);
      const nt = idMap.get(e.target);
      if (!ns || !nt) continue;
      const edgeId = createId('eg');
      s.edges[edgeId] = {
        id: edgeId,
        source: ns,
        sourcePort: e.sourcePort,
        target: nt,
        targetPort: e.targetPort,
      };
    }
    const first = valid[0] ? idMap.get(valid[0]) : undefined;
    if (first) s.lastCreatedId = first;
  });
  return valid.map((id) => idMap.get(id)).filter((v): v is string => Boolean(v));
}

/** 画布内部剪贴板的快照：Ctrl+C 时存，Ctrl+V 时读。不进项目文件。 */
export interface ClipboardSnapshot {
  nodes: readonly ProjectNode[];
  edges: readonly ProjectEdge[];
}

/**
 * 粘贴。与 duplicateNodes 的差别是：源节点可能已经被删掉了，
 * 所以用的是调用方保存的快照，而不是从现有 store 里取。
 * 同样复制内部连线，同样不复制 lastTaskId。
 */
export function pasteNodes(snapshot: ClipboardSnapshot, offset = { x: 40, y: 40 }): string[] {
  if (snapshot.nodes.length === 0) return [];
  checkpoint(snapshot.nodes.length === 1 ? '粘贴节点' : `粘贴 ${snapshot.nodes.length} 个节点`);

  const idMap = new Map<string, string>();
  for (const n of snapshot.nodes) idMap.set(n.id, createId('nd'));
  // 源节点可能已被删掉，但占位判断要看「当前画布上还有什么」，不是快照。
  const shift = freeBatchOffset(
    snapshot.nodes.map((n) => n.position),
    Object.values(useGraphStore.getState().nodes).map((n) => n.position),
    offset,
  );

  useGraphStore.setState((s) => {
    for (const n of snapshot.nodes) {
      const newId = idMap.get(n.id);
      if (!newId) continue;
      s.nodes[newId] = {
        id: newId,
        defKind: n.defKind,
        position: { x: n.position.x + shift.x, y: n.position.y + shift.y },
        size: { ...n.size },
        params: { ...n.params },
        ...(n.assetId ? { assetId: n.assetId } : {}),
        ...(n.derivedAssetIds ? { derivedAssetIds: [...n.derivedAssetIds] } : {}),
      };
    }
    for (const e of snapshot.edges) {
      const ns = idMap.get(e.source);
      const nt = idMap.get(e.target);
      if (!ns || !nt) continue;
      const edgeId = createId('eg');
      s.edges[edgeId] = {
        id: edgeId,
        source: ns,
        sourcePort: e.sourcePort,
        target: nt,
        targetPort: e.targetPort,
      };
    }
    const first = snapshot.nodes[0] ? idMap.get(snapshot.nodes[0].id) : undefined;
    if (first) s.lastCreatedId = first;
  });
  return snapshot.nodes.map((n) => idMap.get(n.id)).filter((v): v is string => Boolean(v));
}

/**
 * 把 React Flow 计算后的节点数组写回 store。
 *
 * 单向数据流：store 是唯一事实来源 → applyNodeChanges 计算 → 写回。
 * 只同步我们关心的字段（position / size），避免 React Flow 的临时字段污染项目模型。
 */
export function applyNodeChangesToStore(
  next: readonly {
    id: string;
    position: { x: number; y: number };
    width?: number;
    height?: number;
    measured?: { width?: number; height?: number };
  }[],
): void {
  useGraphStore.setState((s) => {
    for (const n of next) {
      const node = s.nodes[n.id];
      if (!node) continue;
      node.position = { x: n.position.x, y: n.position.y };
      const w = n.measured?.width ?? n.width;
      const h = n.measured?.height ?? n.height;
      if (typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0) {
        node.size = { width: w, height: h };
      }
    }
  });
}

export function moveNode(id: string, position: { x: number; y: number }): void {
  const current = useGraphStore.getState().nodes[id];
  if (!current) return;
  // 位置没变就不要写：拖拽过程中 React Flow 会高频派发变更，
  // 无条件 setState 会引发大量无意义的重渲染，进而打断内部交互状态。
  if (current.position.x === position.x && current.position.y === position.y) return;
  checkpoint('移动节点', `move:${id}`);
  useGraphStore.setState((s) => {
    const node = s.nodes[id];
    if (!node) return;
    node.position = { ...position };
  });
}

export function setNodeParam(id: string, key: string, value: string | number | boolean | null): void {
  const node = useGraphStore.getState().nodes[id];
  if (!node || node.params[key] === value) return;
  checkpoint('修改参数', `param:${id}:${key}`);
  useGraphStore.setState((s) => {
    const n = s.nodes[id];
    if (n) n.params[key] = value;
  });
}

/**
 * 给节点改名。
 *
 * 传空串等于「取消自定义名」，回退到类型名——这比允许一个空标题更合理：
 * 空标题在卡片上是一片空白，用户会以为节点坏了。
 */
export function setNodeTitle(nodeId: string, title: string): void {
  const cleaned = sanitizeNodeTitle(title);
  const node = useGraphStore.getState().nodes[nodeId];
  if (!node) return;
  // 没变化就不记撤销历史：否则用户按 Ctrl+Z 发现什么都没变，会以为撤销坏了
  if ((node.title ?? '') === cleaned) return;
  checkpoint('重命名节点', `title:${nodeId}`);
  useGraphStore.setState((s) => {
    const target = s.nodes[nodeId];
    if (!target) return;
    if (cleaned) {
      target.title = cleaned;
    } else {
      delete target.title;
    }
  });
}

/**
 * 批量改名：把选中的节点按一个模板统一编号。
 *
 * 顺序用导出同一套坐标排序（上→下、左→右），不是选中的先后。
 * 理由一样：用户说的「第 3 个」指的是画布上第三张，不是他点击的第三下。
 */
export function renameNodesByPattern(nodeIds: readonly string[], pattern: string): number {
  const { nodes } = useGraphStore.getState();
  const picked = nodeIds.map((id) => nodes[id]).filter((n): n is ProjectNode => Boolean(n));
  if (picked.length === 0) return 0;
  const ordered = sortForExport(picked, (n) => n.position);
  checkpoint(`批量重命名 ${ordered.length} 个节点`);
  useGraphStore.setState((s) => {
    ordered.forEach((node, i) => {
      const target = s.nodes[node.id];
      if (!target) return;
      target.title = sanitizeNodeTitle(expandBatchTitle(pattern, i + 1, ordered.length));
    });
  });
  return ordered.length;
}

/**
 * 把任务产物挂到节点上。
 *
 * 这是唯一一处 `derivedAssetIds` 的来源。放在 store 里而不是用例里直接
 * setState，是为了让「节点记录产物」这件事只有一个实现，
 * 将来加"从资产库反查哪些节点用了这张图"时不必再翻用例代码。
 */
export function attachAssets(nodeId: string, assetIds: readonly string[]): void {
  if (assetIds.length === 0) return;
  useGraphStore.setState((s) => {
    const node = s.nodes[nodeId];
    if (!node) return s;
    const first = assetIds[0];
    /**
     * 必须换掉 nodes 与 node 的对象引用，不能就地改字段。
     * usePersistence 靠 `curr.nodes !== prev.nodes` 判断要不要自动保存，
     * 就地 mutate 会让订阅以为画布没变——补格后新出的 4 格看得见，
     * 但 600ms 防抖保存压根不会被触发，关掉重开就只剩旧的那几格。
     * 节点组件的 memo 缓存同样靠引用比较，就地改还会漏掉重渲染。
     */
    return {
      nodes: {
        ...s.nodes,
        [nodeId]: {
          ...node,
          ...(first ? { assetId: first } : {}),
          derivedAssetIds: [...assetIds],
        },
      },
    };
  });
}

export function setNodeAsset(id: string, assetId: string | undefined): void {
  useGraphStore.setState((s) => {
    const node = s.nodes[id];
    if (node) node.assetId = assetId;
  });
}

/**
 * 从本节点已有产物里选主图（下游连线取这张）。
 *
 * 与 setNodeAsset 的区别：这是用户动作，要进撤销历史、要校验成员资格、
 * 要换引用触发自动保存与 memo 重渲染。setNodeAsset 留给复现导入等内部写入。
 */
export function selectPrimaryAsset(nodeId: string, assetId: string): void {
  const node = useGraphStore.getState().nodes[nodeId];
  if (!node) return;
  if (!(node.derivedAssetIds ?? []).includes(assetId)) return;
  if (node.assetId === assetId) return;
  checkpoint('选择主图');
  useGraphStore.setState((s) => {
    const n = s.nodes[nodeId];
    if (!n) return s;
    return { nodes: { ...s.nodes, [nodeId]: { ...n, assetId } } };
  });
}

/**
 * 建立连线——语义校验的唯一入口。
 *
 * 旧代码的连线只记 source → target，能不能连靠运行时猜。
 * 这里在建立之前就问端口：类型对不对、容量够不够、是不是自连。
 */
export function connectNodes(intent: {
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
}): ConnectResult {
  const { nodes, edges } = useGraphStore.getState();
  const sourceNode = nodes[intent.sourceNodeId];
  const targetNode = nodes[intent.targetNodeId];
  if (!sourceNode || !targetNode) {
    return { ok: false, issues: [{ code: 'unknown_port', message: '连线的一端不存在' }] };
  }

  const sourceDef = requireNodeDefinition(sourceNode.defKind);
  const targetDef = requireNodeDefinition(targetNode.defKind);
  const sourcePort = sourceDef.outputPorts.find((p) => p.id === intent.sourcePortId);
  const targetPort = targetDef.inputPorts.find((p) => p.id === intent.targetPortId);

  const sourceType: PortType = sourcePort
    ? (sourcePort.accepts.find((t) => t !== 'any') ?? 'any')
    : 'any';

  const existing = Object.values(edges).map((e) => ({
    sourceNodeId: e.source,
    sourcePortId: e.sourcePort,
    targetNodeId: e.target,
    targetPortId: e.targetPort,
  }));

  // 重复连线必须在校验之前判：单路输入口的旧边会被「换源」语义过滤掉，
  // 若放到 issues 分支里，同一对端口会被当成新连线再写一次，
  // 白白多出一条重复边和一步可撤销历史。
  const duplicate = Object.values(edges).some(
    (e) =>
      e.source === intent.sourceNodeId &&
      e.sourcePort === intent.sourcePortId &&
      e.target === intent.targetNodeId &&
      e.targetPort === intent.targetPortId,
  );
  if (duplicate) return { ok: true, edgeId: 'duplicate' };

  const issues = validateConnection({
    intent,
    sourcePort,
    targetPort,
    sourceType,
    // 单路输入口上指向同一端口的旧边会被下面的覆盖语义替换掉，
    // 不能算成「已占用」。画布的 isValidConnection 用同一个函数，
    // 两边结论一致，用户才拖得上去。
    existingEdges: effectiveExistingEdges(existing, intent, targetPort),
  });
  if (issues.length > 0) return { ok: false, issues };

  checkpoint('建立连线');
  const edgeId = createId('eg');
  useGraphStore.setState((s) => {
    /**
     * 覆盖语义：单路输入口再连一根，应当替换而不是被拒绝。
     *
     * 踩坑记录：早期这里直接报 capacity_exceeded，用户想换个来源，必须先删线再连，
     * 中间还有一个"没连上"的中间态。React Flow 自己也是替换语义，
     * 两侧行为不一致比"多点一次"更让人困惑。
     */
    if (targetPort && !targetPort.multiple) {
      for (const [id, e] of Object.entries(s.edges)) {
        if (e.target === intent.targetNodeId && e.targetPort === intent.targetPortId) {
          delete s.edges[id];
        }
      }
    }
    s.edges[edgeId] = {
      id: edgeId,
      source: intent.sourceNodeId,
      sourcePort: intent.sourcePortId,
      target: intent.targetNodeId,
      targetPort: intent.targetPortId,
    };
  });
  return { ok: true, edgeId };
}

export function removeEdge(edgeId: string): void {
  if (!useGraphStore.getState().edges[edgeId]) return;
  checkpoint('断开连线');
  useGraphStore.setState((s) => {
    delete s.edges[edgeId];
  });
}

/**
 * 清空图。这是最容易误触的操作，所以**必须可撤销**——
 * 旧代码点一下就没了，只能从头重做。
 */
export function resetGraph(): void {
  checkpoint('清空画布');
  useGraphStore.setState((s) => {
    s.nodes = {};
    s.edges = {};
    s.lastCreatedId = null;
  });
}

/**
 * 从项目文件装载。装载不是一次"编辑"，不能进历史，
 * 否则用户刚打开应用按一下 Ctrl+Z，画布就空了。
 */
export function hydrateGraph(nodes: ProjectNode[], edges: ProjectEdge[]): void {
  clearHistory();
  useGraphStore.setState((s) => {
    s.nodes = {};
    s.edges = {};
    for (const n of nodes) s.nodes[n.id] = n;
    for (const e of edges) s.edges[e.id] = e;
  });
}
