import { describe, expect, it } from "vitest";

import { createDragSnap, snapCanvasOffsetToGrid } from "./canvas-drag-snap";
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

describe("snapCanvasOffsetToGrid", () => {
    it("snaps bounding-box top-left to the nearest 16px grid line", () => {
        const initial = new Map([["a", { x: 10, y: 20 }], ["b", { x: 100, y: 80 }]]);
        expect(snapCanvasOffsetToGrid({ x: 9, y: 10 }, initial, 16)).toEqual({ x: 6, y: 12 });
    });

    it("returns original offset when no initial positions exist", () => {
        const offset = { x: 13, y: 7 };
        expect(snapCanvasOffsetToGrid(offset, new Map())).toBe(offset);
    });

    it("supports custom grid size", () => {
        expect(snapCanvasOffsetToGrid({ x: 14, y: 26 }, new Map([["a", { x: 0, y: 0 }]]), 10)).toEqual({ x: 10, y: 30 });
    });
});
