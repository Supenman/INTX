import { nanoid } from "nanoid";

import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import i18n from "@/i18n";
import { storyboardLines } from "@/domain/node/storyboard";
import { createCanvasNode } from "@/lib/canvas/canvas-node-factory";
import { nodeBounds } from "@/lib/canvas/canvas-node-geometry";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type Position, type ViewportTransform } from "@/types/canvas";

export function createStoryboardShotGraph(script: string, references: CanvasNodeData[], existingNodes: CanvasNodeData[], center: Position, viewportSize: { width: number; height: number }) {
    const lines = storyboardLines(script);
    const shots = lines.length ? Math.min(2, lines.length) : 0;
    const imageSize = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
    const columnGap = 96;
    const rowGap = 72;
    const gridWidth = shots * imageSize.width + Math.max(0, shots - 1) * columnGap;
    const rowCount = Math.ceil(lines.length / 2);
    const gridHeight = rowCount * imageSize.height + Math.max(0, rowCount - 1) * rowGap;
    const existingRight = existingNodes.length ? nodeBounds(existingNodes).right : null;
    const left = existingRight === null ? center.x - gridWidth / 2 : existingRight + 140;
    const top = center.y - gridHeight / 2;
    const nodes: CanvasNodeData[] = [];
    const connections: CanvasConnection[] = [];

    if (!lines.length) return { nodes, connections, viewport: { x: 0, y: 0, k: 1 } };

    lines.forEach((line, index) => {
        const column = index % 2;
        const row = Math.floor(index / 2);
        const x = left + column * (imageSize.width + columnGap);
        const y = top + row * (imageSize.height + rowGap);
        const node = createCanvasNode(CanvasNodeType.Image, {
            x: x + imageSize.width / 2,
            y: y + imageSize.height / 2,
        }, {
            inputPrompt: line,
            prompt: line,
            status: "idle",
            generationMode: "image",
            generationType: references.length ? "edit" : "generation",
            count: 1,
        });
        node.title = i18n.t("canvas.storyboard.shotTitle", { index: index + 1 });
        nodes.push(node);
        references.forEach((reference) => connections.push({ id: nanoid(), fromNodeId: reference.id, toNodeId: node.id }));
    });

    const bounds = nodeBounds(nodes);
    const padding = 72;
    const scale = Math.min(1, (viewportSize.width - padding * 2) / (bounds.right - bounds.left), (viewportSize.height - padding * 2) / (bounds.bottom - bounds.top));
    const viewport: ViewportTransform = {
        x: viewportSize.width / 2 - ((bounds.left + bounds.right) / 2) * scale,
        y: viewportSize.height / 2 - ((bounds.top + bounds.bottom) / 2) * scale,
        k: scale,
    };

    return { nodes, connections, viewport };
}
