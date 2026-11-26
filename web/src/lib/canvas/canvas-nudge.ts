import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

/**
 * 方向键微调选中节点：
 * 跳过已锁定节点；
 * 选中分组时自动带动其未锁定的组内子节点同步平移；
 * 没有可移动节点或偏移为 0 时返回原数组引用，避免污染撤销栈。
 */
export function nudgeSelectedNodes(
    nodes: CanvasNodeData[],
    selectedIds: ReadonlySet<string>,
    dx: number,
    dy: number,
): CanvasNodeData[] {
    if ((dx === 0 && dy === 0) || selectedIds.size === 0) return nodes;
    const movingGroupIds = new Set(
        nodes
            .filter((node) => node.type === CanvasNodeType.Group && selectedIds.has(node.id) && !node.metadata?.locked)
            .map((node) => node.id),
    );
    let moved = false;
    const next = nodes.map((node) => {
        if (node.metadata?.locked) return node;
        const shouldMove = selectedIds.has(node.id) || Boolean(node.metadata?.groupId && movingGroupIds.has(node.metadata.groupId));
        if (!shouldMove) return node;
        moved = true;
        return { ...node, position: { x: node.position.x + dx, y: node.position.y + dy } };
    });
    return moved ? next : nodes;
}
