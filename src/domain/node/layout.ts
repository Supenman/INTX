import type { NodePosition, ProjectEdge, ProjectNode } from '../schema/project';

/**
 * 画布布局纯函数。
 *
 * 这一层只认「节点 id + 位置 + 尺寸 + 连线」，不认 React Flow、不认 store，
 * 因此可以在 node 环境里直接测。UI 上的对齐 / 等距 / 自动整理都走这里，
 * 避免出现「工具栏一套算法、导入旧数据另一套算法」的第二份语义。
 *
 * 参考 BeefTV 的自动整理规则（按其功能清单）：
 * - 有连线时横向按依赖层级从左到右，纵向按媒体类型分泳道；
 * - 没有连线时按类型分网格，不把不同类型混排；
 * - 只整理选中的节点，位置变化可撤销。
 * 实现独立编写，不复制其代码。
 */

/** 与 grid.ts 的宫格语义无关，这里是画布节点间距。 */
export const LAYOUT_STEP_X = 380;
/**
 * 纵向步长必须 ≥ 最高节点（380）+ 呼吸间距，否则自动整理和落位避让
 * 会把节点排得互相压住——高度不够时「不重叠」只是纸面上的。
 */
export const LAYOUT_STEP_Y = 410;

export type AlignMode = 'left' | 'right' | 'top' | 'bottom' | 'center-x' | 'center-y';
export type DistributeAxis = 'horizontal' | 'vertical';

/**
 * 返回**所有选中节点的目标位置**，不是 diff。
 * 过滤「本来就没变」这件事交给写入口 setNodePositions，纯函数保持可预测。
 */
export type PositionMap = Record<string, NodePosition>;

interface Box {
  id: string;
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function toBoxes(nodes: readonly ProjectNode[], ids: readonly string[]): Box[] {
  const wanted = new Set(ids);
  const out: Box[] = [];
  for (const n of nodes) {
    if (!wanted.has(n.id)) continue;
    out.push({
      id: n.id,
      kind: n.defKind,
      x: n.position.x,
      y: n.position.y,
      w: n.size.width,
      h: n.size.height,
    });
  }
  return out;
}

/**
 * 对齐。少于两个节点时没有「对齐」的意义，返回空表。
 * 用包围盒做基准，而不是「第一个节点」，这样从右往左框选结果也一致。
 */
export function alignNodes(nodes: readonly ProjectNode[], ids: readonly string[], mode: AlignMode): PositionMap {
  const boxes = toBoxes(nodes, ids);
  if (boxes.length < 2) return {};

  const minX = Math.min(...boxes.map((b) => b.x));
  const maxRight = Math.max(...boxes.map((b) => b.x + b.w));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxBottom = Math.max(...boxes.map((b) => b.y + b.h));
  const centerX = (minX + maxRight) / 2;
  const centerY = (minY + maxBottom) / 2;

  const out: PositionMap = {};
  for (const b of boxes) {
    let { x, y } = b;
    switch (mode) {
      case 'left':
        x = minX;
        break;
      case 'right':
        x = maxRight - b.w;
        break;
      case 'top':
        y = minY;
        break;
      case 'bottom':
        y = maxBottom - b.h;
        break;
      case 'center-x':
        x = centerX - b.w / 2;
        break;
      case 'center-y':
        y = centerY - b.h / 2;
        break;
    }
    out[b.id] = { x, y };
  }
  return out;
}

/**
 * 等距分布：按中心点均匀排开，首尾节点保持不动。
 * 用中心而不是左边界，宽度不同的节点看起来才真的等距。
 */
export function distributeNodes(
  nodes: readonly ProjectNode[],
  ids: readonly string[],
  axis: DistributeAxis,
): PositionMap {
  const boxes = toBoxes(nodes, ids);
  if (boxes.length < 3) return {};

  const horizontal = axis === 'horizontal';
  const centerOf = (b: Box) => (horizontal ? b.x + b.w / 2 : b.y + b.h / 2);
  const half = (b: Box) => (horizontal ? b.w / 2 : b.h / 2);

  const sorted = [...boxes].sort((a, b) => centerOf(a) - centerOf(b));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return {};

  const start = centerOf(first);
  const end = centerOf(last);
  const step = (end - start) / (sorted.length - 1);

  const out: PositionMap = {};
  sorted.forEach((b, i) => {
    const nextCenter = start + step * i;
    const x = horizontal ? nextCenter - half(b) : b.x;
    const y = horizontal ? b.y : nextCenter - half(b);
    out[b.id] = { x, y };
  });
  return out;
}

/** 稳定的泳道顺序：同类节点挨在一起，不同类不混排。 */
function laneOf(defKind: string): number {
  const order: Record<string, number> = {
    'text-input': 0,
    asset: 1,
    generate: 2,
    storyboard: 3,
  };
  return order[defKind] ?? 9;
}

/**
 * 拓扑层级。返回 id → 层号。
 *
 * 用最长路径而不是「最短入边」：A→B→C 与 A→C 并存时，C 应该落在
 * B 之后那一层，否则连线会从右往左折回去。有环时 Kahn 会剩下节点，
 * 把它们统一放到最后一层的下一层，不死循环也不假装图是无环的。
 */
function topologicalLevels(ids: readonly string[], edges: readonly ProjectEdge[]): Map<string, number> {
  const scope = new Set(ids);
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const id of ids) {
    incoming.set(id, []);
    outgoing.set(id, []);
  }
  for (const e of edges) {
    if (!scope.has(e.source) || !scope.has(e.target) || e.source === e.target) continue;
    outgoing.get(e.source)?.push(e.target);
    incoming.get(e.target)?.push(e.source);
  }

  const level = new Map<string, number>();
  const indegree = new Map<string, number>();
  for (const id of ids) indegree.set(id, (incoming.get(id) ?? []).length);

  const queue = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
  for (const id of queue) level.set(id, 0);

  let head = 0;
  while (head < queue.length) {
    const id = queue[head] as string;
    head += 1;
    for (const next of outgoing.get(id) ?? []) {
      const parents = incoming.get(next) ?? [];
      // 只有所有前驱都定层了，才取得到真实的最长路径
      const base = Math.max(0, ...parents.map((p) => (level.get(p) ?? -1) + 1));
      level.set(next, Math.max(level.get(next) ?? 0, base));
      const left = (indegree.get(next) ?? 1) - 1;
      indegree.set(next, left);
      if (left === 0) queue.push(next);
    }
  }

  const maxLevel = Math.max(0, ...level.values());
  // 环里的节点没有入度为 0 的起点，Kahn 永远排不到；统一放到末尾
  for (const id of ids) if (!level.has(id)) level.set(id, maxLevel + 1);
  return level;
}

export interface AutoLayoutOptions {
  /** 只整理这些节点；不给或少于两个时整理全部 */
  scopeIds?: readonly string[];
}

/**
 * 自动整理：把选区（或全图）重排成可读的流程，返回需要改动的节点位置。
 * 以选区包围盒左上角为锚点，整理完不会整体跑出原来的视口区域。
 */
export function autoLayout(
  nodes: readonly ProjectNode[],
  edges: readonly ProjectEdge[],
  options: AutoLayoutOptions = {},
): PositionMap {
  const scope = options.scopeIds && options.scopeIds.length >= 2
    ? options.scopeIds.filter((id) => nodes.some((n) => n.id === id))
    : nodes.map((n) => n.id);
  if (scope.length < 2) return {};

  const boxes = toBoxes(nodes, scope);
  const anchorX = Math.min(...boxes.map((b) => b.x));
  const anchorY = Math.min(...boxes.map((b) => b.y));
  const scopeSet = new Set(scope);
  const innerEdges = edges.filter((e) => scopeSet.has(e.source) && scopeSet.has(e.target));
  const hasFlow = innerEdges.length > 0;

  const levels = hasFlow ? topologicalLevels(scope, innerEdges) : null;

  // 每层 / 每泳道内按「泳道号 → 原 y → 原 x」排，保证结果稳定可复现
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const grouped = new Map<number, string[]>();
  for (const id of scope) {
    const key = levels ? (levels.get(id) ?? 0) : laneOf(byId.get(id)?.kind ?? '');
    const list = grouped.get(key) ?? [];
    list.push(id);
    grouped.set(key, list);
  }

  const out: PositionMap = {};
  const keys = [...grouped.keys()].sort((a, b) => a - b);
  keys.forEach((key, index) => {
    /**
     * 有连线时列号就是拓扑层级：纯环图所有节点都在 level 1，会整齐地
     * 竖排在第 1 列，而不是被压缩回第 0 列叠成一坨。
     * 无连线时 key 是泳道号（可能跳号），用压缩后的序号列才不留空列。
     */
    const column = hasFlow ? key : index;
    const list = (grouped.get(key) ?? []).sort((a, b) => {
      const ba = byId.get(a);
      const bb = byId.get(b);
      if (!ba || !bb) return 0;
      // 有连线时按媒体泳道分上下；无连线时同一泳道内按原位置稳定排列
      const laneDiff = hasFlow ? laneOf(ba.kind) - laneOf(bb.kind) : 0;
      if (laneDiff !== 0) return laneDiff;
      return ba.y - bb.y || ba.x - bb.x;
    });
    list.forEach((id, row) => {
      out[id] = {
        x: anchorX + column * LAYOUT_STEP_X,
        y: anchorY + row * LAYOUT_STEP_Y,
      };
    });
  });
  return out;
}

/**
 * 给整批复制 / 粘贴的节点找一个**不压在已有节点上**的平移量。
 *
 * 之前 duplicateNodes / pasteNodes 固定只偏移 {40,40}，而节点宽约 340、
 * 高约 280 —— 副本几乎整个盖在原节点上，参数文字出现两份重影、端口点不到，
 * 看起来像只复制了半个节点。E2E 只断言「节点数 +1」所以一直没抓到，
 * 直到把截图放大才看见。这里把「落点」也收进 domain，跟对齐/整理同一层。
 *
 * 约束：整批共用同一个平移量，保持副本之间的相对布局；候选按整格扫描，
 * 行列数按已有节点数动态推导（沿用 findFreeSlot 的教训，不写死 50 行）。
 */
export function freeBatchOffset(
  positions: readonly NodePosition[],
  occupied: readonly NodePosition[],
  preferred: NodePosition = { x: 40, y: 40 },
): NodePosition {
  if (positions.length === 0) return preferred;

  const collides = (shift: NodePosition): boolean =>
    positions.some((p) =>
      occupied.some(
        (o) =>
          Math.abs(o.x - (p.x + shift.x)) < LAYOUT_STEP_X - 20 &&
          Math.abs(o.y - (p.y + shift.y)) < LAYOUT_STEP_Y - 20,
      ),
    );

  if (!collides(preferred)) return preferred;

  const maxRows = Math.max(30, Math.ceil(occupied.length / 2) + 2);
  // col 外层、row 内层 = 优先往下找；副本落在原节点下方比一路往右更自然。
  for (let col = 0; col < 3; col += 1) {
    for (let row = 0; row < maxRows; row += 1) {
      if (col === 0 && row === 0) continue; // 首选已试过
      const candidate: NodePosition = {
        x: preferred.x + col * LAYOUT_STEP_X,
        y: preferred.y + row * LAYOUT_STEP_Y,
      };
      if (!collides(candidate)) return candidate;
    }
  }
  // 极端密集的画布：兜底放到所有已有节点下方，绝不退回重叠。
  const maxY = Math.max(0, ...occupied.map((o) => o.y));
  const minY = Math.min(...positions.map((p) => p.y));
  return { x: preferred.x, y: maxY + LAYOUT_STEP_Y * 2 - minY };
}
