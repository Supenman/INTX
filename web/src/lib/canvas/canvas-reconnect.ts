import type { CanvasConnection } from "@/types/canvas";

/**
 * 原子化改接一条已有连线：
 * - 若新端点与原连线完全一致或自环，保持原数组引用不变；
 * - 若目标位置已存在另一条同向连线，移除旧连线避免重复边；
 * - 否则就地更新该连线的 fromNodeId / toNodeId（保持原 id，单步可撤销）。
 */
export function reconnectCanvasConnection(
    connections: CanvasConnection[],
    reconnectingId: string,
    fromNodeId: string,
    toNodeId: string,
): CanvasConnection[] {
    if (fromNodeId === toNodeId) return connections;
    const current = connections.find((conn) => conn.id === reconnectingId);
    if (!current) return connections;
    if (current.fromNodeId === fromNodeId && current.toNodeId === toNodeId) return connections;

    const duplicateExists = connections.some(
        (conn) => conn.id !== reconnectingId && conn.fromNodeId === fromNodeId && conn.toNodeId === toNodeId,
    );
    if (duplicateExists) {
        return connections.filter((conn) => conn.id !== reconnectingId);
    }
    return connections.map((conn) => (conn.id === reconnectingId ? { ...conn, fromNodeId, toNodeId } : conn));
}
