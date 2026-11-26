import { describe, expect, it } from "vitest";

import { createDragSnap } from "./canvas-drag-snap";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function node(id: string, x: number, y: number, width = 200, height = 100): CanvasNodeData {
    return { id, type: CanvasNodeType.Text, title: id, position: { x, y }, width, height, metadata: {} };
}

describe("createDragSnap", () => {
    it("snaps opposing horizontal edges together", () => {
        const snap = createDragSnap([node("a", 0, 0), node("b", 250, 0)], new Set(["b"]));
        expect(snap({ x: -46, y: 0 }, 1).offset.x).toBe(-50);
    });
    it("snaps opposing vertical edges together", () => {
        const snap = createDragSnap([node("a", 0, 0), node("b", 0, 150)], new Set(["b"]));
        expect(snap({ x: 0, y: -46 }, 1).offset.y).toBe(-50);
    });
    it("snaps same-role edges and center", () => {
        const snap = createDragSnap([node("a", 0, 0), node("b", 210, 0)], new Set(["b"]));
        expect(snap({ x: -4, y: 0 }, 1).offset.x).toBe(-10);
    });
    it("does not align a center to a distant edge", () => {
        const snap = createDragSnap([node("a", 0, 0), node("b", 96, 200)], new Set(["b"]));
        expect(snap({ x: 0, y: 0 }, 1).guides.x).toBeUndefined();
    });
    it("scales the screen threshold with zoom", () => {
        const snap = createDragSnap([node("a", 0, 0), node("b", 210, 0)], new Set(["b"]));
        expect(snap({ x: 0, y: 0 }, 1).guides.x).toBeUndefined();
        expect(snap({ x: 0, y: 0 }, 0.5).offset.x).toBe(-10);
    });
});
