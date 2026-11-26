import { describe, expect, it } from "vitest";
import { nudgeSelectedNodes } from "./canvas-nudge";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function makeNode(id: string, x: number, y: number, type: CanvasNodeType = CanvasNodeType.Text, metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData {
    return { id, type, title: id, position: { x, y }, width: 200, height: 120, metadata };
}

describe("nudgeSelectedNodes", () => {
    it("moves selected unlocked nodes by dx and dy", () => {
        const nodes = [makeNode("a", 10, 20), makeNode("b", 100, 200)];
        const next = nudgeSelectedNodes(nodes, new Set(["a"]), 16, -16);
        expect(next[0].position).toEqual({ x: 26, y: 4 });
        expect(next[1].position).toEqual({ x: 100, y: 200 });
    });

    it("skips locked nodes and returns same reference if none can move", () => {
        const nodes = [makeNode("locked", 10, 20, CanvasNodeType.Image, { locked: true })];
        expect(nudgeSelectedNodes(nodes, new Set(["locked"]), 1, 0)).toBe(nodes);
    });

    it("nudges children when their parent group is selected", () => {
        const nodes = [
            makeNode("g", 0, 0, CanvasNodeType.Group),
            makeNode("c", 20, 30, CanvasNodeType.Text, { groupId: "g" }),
        ];
        const next = nudgeSelectedNodes(nodes, new Set(["g"]), 16, 0);
        expect(next[0].position).toEqual({ x: 16, y: 0 });
        expect(next[1].position).toEqual({ x: 36, y: 30 });
    });
});
