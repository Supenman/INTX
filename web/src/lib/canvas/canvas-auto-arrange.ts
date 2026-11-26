import { autoLayout } from "@/domain/node/layout";
import type { ProjectEdge, ProjectNode } from "@/domain/schema/project";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

/**
 * 将画布节点与连线适配到 domain 层 autoLayout 纯函数，实现一键自动整理：
 * 选中 ≥ 2 个节点时只整理选区，否则整理画布全部可移动节点；
 * 锁定节点原地不动；
 * 分组节点作为整体移动，其子节点按相同偏移量跟随，避免把组内节点拆散；
 * 位置没有实际变化时返回原数组引用，避免污染撤销栈。
 */
export function autoArrangeCanvasNodes(
    nodes: CanvasNodeData[],
    connections: CanvasConnection[],
    selectedIds: ReadonlySet<string>,
): CanvasNodeData[] {
    const groupIds = new Set(nodes.filter((n) => n.type === CanvasNodeType.Group).map((n) => n.id));
    const isGroupedChild = (node: CanvasNodeData) => Boolean(node.metadata?.groupId && groupIds.has(node.metadata.groupId));
    const topLevelMovable = nodes.filter((n) => !n.metadata?.locked && !isGroupedChild(n));
    if (topLevelMovable.length < 2) return nodes;
    const selectedTopLevel = topLevelMovable.filter((n) => selectedIds.has(n.id));
    const scopeNodes = selectedTopLevel.length >= 2 ? selectedTopLevel : topLevelMovable;
    const scopeIds = scopeNodes.map((n) => n.id);
    const projectNodes: ProjectNode[] = scopeNodes.map((n) => ({
        id: n.id,
        defKind: n.type,
        position: { x: n.position.x, y: n.position.y },
        size: { width: n.width, height: n.height },
        params: {},
    }));
    const projectEdges: ProjectEdge[] = connections.map((c) => ({
        id: c.id,
        source: c.fromNodeId,
        sourcePort: "out",
        target: c.toNodeId,
        targetPort: "in",
    }));
    const nextPositions = autoLayout(projectNodes, projectEdges, { scopeIds });
    const deltas = new Map<string, { dx: number; dy: number }>();
    let changed = false;
    for (const node of scopeNodes) {
        const target = nextPositions[node.id];
        if (!target) continue;
        const dx = Math.round(target.x - node.position.x);
        const dy = Math.round(target.y - node.position.y);
        if (dx !== 0 || dy !== 0) {
            deltas.set(node.id, { dx, dy });
            changed = true;
        }
    }
    if (!changed) return nodes;
    return nodes.map((node) => {
        const ownDelta = deltas.get(node.id);
        if (ownDelta) {
            return { ...node, position: { x: node.position.x + ownDelta.dx, y: node.position.y + ownDelta.dy } };
        }
        const parentGroupId = node.metadata?.groupId;
        const groupDelta = parentGroupId ? deltas.get(parentGroupId) : undefined;
        if (groupDelta) {
            return { ...node, position: { x: node.position.x + groupDelta.dx, y: node.position.y + groupDelta.dy } };
        }
        return node;
    });
}

/**
 * 自动整理的打开信号。
 *
 * 多选浮栏和缩放菜单在不同的子树里，各自需要一个回调；用一条自定义事件解耦，
 * 页面只挂一次监听，不必把回调层层透传（也免得把「谁在触发」写进页面状态）。
 */
export const CANVAS_AUTO_ARRANGE_EVENT = "intx:canvas-auto-arrange";

export function requestCanvasAutoArrange() {
    window.dispatchEvent(new Event(CANVAS_AUTO_ARRANGE_EVENT));
}
