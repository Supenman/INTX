import { collectAlignUnits } from "./canvas-align";
import { nodeBounds } from "./canvas-node-geometry";
import type { CanvasNodeData, Position } from "@/types/canvas";

const SNAP_DISTANCE_PX = 7;

export type DragGuides = { x?: number; y?: number };

function anchors(start: number, end: number) {
    return [start, (start + end) / 2, end];
}

const SNAP_PAIRS = [[0, 0], [1, 1], [2, 2], [0, 2], [2, 0]] as const;

export function createDragSnap(nodes: CanvasNodeData[], movingIds: ReadonlySet<string>) {
    const bounds = nodeBounds(collectAlignUnits(nodes, movingIds));
    const targets = nodes.filter((node) => !movingIds.has(node.id) && !movingIds.has(node.metadata?.groupId ?? ""));
    const xTargets = targets.map((node) => anchors(node.position.x, node.position.x + node.width));
    const yTargets = targets.map((node) => anchors(node.position.y, node.position.y + node.height));

    function nearest(source: number[], candidates: number[][], offset: number, distance: number) {
        let match: { guide: number; offset: number; sameRole: boolean } | undefined;
        let best = distance;
        for (const target of candidates) {
            for (const [sourceIndex, targetIndex] of SNAP_PAIRS) {
                const gap = Math.abs(target[targetIndex] - source[sourceIndex] - offset);
                const sameRole = sourceIndex === targetIndex;
                if (gap <= distance && (match === undefined || gap < best - 1e-6 || (Math.abs(gap - best) <= 1e-6 && sameRole && !match.sameRole))) {
                    match = { guide: target[targetIndex], offset: target[targetIndex] - source[sourceIndex], sameRole };
                    best = gap;
                }
            }
        }
        return match;
    }

    return (offset: Position, scale: number) => {
        const movingX = anchors(bounds.left, bounds.right);
        const movingY = anchors(bounds.top, bounds.bottom);
        const distance = SNAP_DISTANCE_PX / scale;
        const x = nearest(movingX, xTargets, offset.x, distance);
        const y = nearest(movingY, yTargets, offset.y, distance);
        return {
            offset: {
                x: x?.offset ?? offset.x,
                y: y?.offset ?? offset.y,
            },
            guides: { x: x?.guide, y: y?.guide },
        };
    };
}

export function moveDraggedNodes(nodes: CanvasNodeData[], initial: ReadonlyMap<string, Position>, offset: Position) {
    return nodes.map((node) => {
        const start = initial.get(node.id);
        return start ? { ...node, position: { x: start.x + offset.x, y: start.y + offset.y } } : node;
    });
}
