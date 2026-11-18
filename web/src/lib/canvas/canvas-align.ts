/**
 * 选区排列：对齐与等距分布的纯计算。
 *
 * 这里是「选区浮栏点一下，节点去哪」的唯一答案。刻意不碰 React、不碰 store：
 * 输入是节点数组和一组 id，输出是新的节点数组，因此可以直接在 node 环境里单测。
 *
 * 三条约定：
 *
 * 1. **只动选中的节点**，未选中的保持原引用不变。否则一次对齐会把整张画布的
 *    节点对象全部换掉，触发全量重渲染。
 * 2. **分组是一等公民**。一个分组框算一个移动单元，分组内的成员不单独参与——
 *    否则「选中分组 + 其中某个成员」时那个成员会被平移两次。
 * 3. **没有实际位移就返回原数组**。调用方靠 `next === prev` 判断「什么也没发生」，
 *    用来跳过写回与 undo 记录。
 *
 * 坐标系是画布世界坐标（不乘缩放），与 node.position 一致。
 */
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export type AlignAxis = "left" | "center-x" | "right" | "top" | "center-y" | "bottom";
export type DistributeAxis = "horizontal" | "vertical";

type Offset = { dx: number; dy: number };

function isGroup(node: CanvasNodeData): boolean {
    return node.type === CanvasNodeType.Group;
}

/**
 * 参与排列的「移动单元」。
 *
 * 分组框算一个单元；它的成员即使也被选中也不单独计入——成员位置是绝对值，
 * 分组框一动，成员要在同一次写回里一起平移，见 {@link moveUnits}。
 */
export function collectAlignUnits(nodes: readonly CanvasNodeData[], selectedIds: ReadonlySet<string>): CanvasNodeData[] {
    const selectedGroups = new Set(nodes.filter((node) => selectedIds.has(node.id) && isGroup(node)).map((node) => node.id));
    return nodes.filter((node) => {
        if (!selectedIds.has(node.id)) return false;
        if (isGroup(node)) return true;
        const groupId = node.metadata?.groupId;
        // 分组成员已被上层分组框代表，跳过，避免平移两次。
        return !(groupId != null && selectedGroups.has(groupId));
    });
}

/** 把一组节点按轴向压到同一条基准线上，返回每个节点要平移的距离。 */
export function alignOffsets(units: readonly CanvasNodeData[], axis: AlignAxis): Map<string, Offset> {
    const result = new Map<string, Offset>();
    if (units.length < 2) return result;

    const left = Math.min(...units.map((node) => node.position.x));
    const right = Math.max(...units.map((node) => node.position.x + node.width));
    const top = Math.min(...units.map((node) => node.position.y));
    const bottom = Math.max(...units.map((node) => node.position.y + node.height));

    for (const node of units) {
        let dx = 0;
        let dy = 0;
        switch (axis) {
            case "left":
                dx = left - node.position.x;
                break;
            case "right":
                dx = right - (node.position.x + node.width);
                break;
            case "center-x":
                // 用包围盒中心而不是平均值：平均值会让「一个宽节点 + 两个窄节点」
                // 的中心偏到宽节点那侧，视觉上明显不在一条线上。
                dx = Math.round((left + right) / 2 - (node.position.x + node.width / 2));
                break;
            case "top":
                dy = top - node.position.y;
                break;
            case "bottom":
                dy = bottom - (node.position.y + node.height);
                break;
            case "center-y":
                dy = Math.round((top + bottom) / 2 - (node.position.y + node.height / 2));
                break;
        }
        result.set(node.id, { dx, dy });
    }
    return result;
}

/**
 * 等距分布：首尾不动，中间按「间距相等」重排。
 *
 * 间距按节点之间的空隙算，不是中心距——节点宽窄不一时，中心距相等看起来反而
 * 乱。空隙可以为负（重叠的节点被拉开前会保持重叠），这里不做最小间距约束：
 * 用户点的是「等距」，不是「排整齐」。
 */
export function distributeOffsets(units: readonly CanvasNodeData[], axis: DistributeAxis): Map<string, Offset> {
    const result = new Map<string, Offset>();
    if (units.length < 3) return result;

    const horizontal = axis === "horizontal";
    const sorted = [...units].sort((a, b) => (horizontal ? a.position.x - b.position.x : a.position.y - b.position.y));

    const start = horizontal ? sorted[0].position.x : sorted[0].position.y;
    const lastNode = sorted[sorted.length - 1];
    const end = horizontal ? lastNode.position.x + lastNode.width : lastNode.position.y + lastNode.height;

    const totalSize = sorted.reduce((sum, node) => sum + (horizontal ? node.width : node.height), 0);
    const gap = (end - start - totalSize) / (sorted.length - 1);

    let cursor = start;
    for (const node of sorted) {
        const current = horizontal ? node.position.x : node.position.y;
        const delta = Math.round(cursor - current);
        result.set(node.id, horizontal ? { dx: delta, dy: 0 } : { dx: 0, dy: delta });
        cursor += (horizontal ? node.width : node.height) + gap;
    }
    return result;
}

/**
 * 把偏移作用回节点数组。
 *
 * 分组框移动时，它的成员必须按同样的位移一起走——成员坐标是绝对值，分组框的
 * 位置变了并不会自动带着成员。这一步漏掉的话，用户看到的是「分组框飞走了，
 * 里面的节点留在原地」。
 */
export function applyOffsets(nodes: readonly CanvasNodeData[], offsets: ReadonlyMap<string, Offset>): CanvasNodeData[] {
    if (!offsets.size) return nodes as CanvasNodeData[];
    // 分组位移表：成员按 groupId 查这里，叠加到自己的位移上。
    const groupShift = new Map<string, Offset>();
    for (const node of nodes) {
        const offset = offsets.get(node.id);
        if (offset && isGroup(node)) groupShift.set(node.id, offset);
    }
    let changed = false;
    const next = nodes.map((node) => {
        const own = offsets.get(node.id);
        const viaGroup = node.metadata?.groupId != null ? groupShift.get(node.metadata.groupId) : undefined;
        const dx = (own?.dx ?? 0) + (viaGroup?.dx ?? 0);
        const dy = (own?.dy ?? 0) + (viaGroup?.dy ?? 0);
        if (dx === 0 && dy === 0) return node;
        changed = true;
        return { ...node, position: { x: node.position.x + dx, y: node.position.y + dy } };
    });
    // 全部已经对齐时返回原数组：调用方据此跳过写回与 undo 记录。
    return changed ? next : (nodes as CanvasNodeData[]);
}

/** 对外的一步到位接口：对齐。 */
export function alignNodes(nodes: readonly CanvasNodeData[], selectedIds: ReadonlySet<string>, axis: AlignAxis): CanvasNodeData[] {
    return applyOffsets(nodes, alignOffsets(collectAlignUnits(nodes, selectedIds), axis));
}

/** 对外的一步到位接口：等距分布。 */
export function distributeNodes(nodes: readonly CanvasNodeData[], selectedIds: ReadonlySet<string>, axis: DistributeAxis): CanvasNodeData[] {
    return applyOffsets(nodes, distributeOffsets(collectAlignUnits(nodes, selectedIds), axis));
}
