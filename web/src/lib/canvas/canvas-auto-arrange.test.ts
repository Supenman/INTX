import { describe, expect, it } from "vitest";
import { autoArrangeCanvasNodes } from "./canvas-auto-arrange";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

function node(id: string, x: number, y: number, type: CanvasNodeType = CanvasNodeType.Text, metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData {
    return { id, type, title: id, position: { x, y }, width: 280, height: 180, metadata };
}

describe("autoArrangeCanvasNodes", () => {
    it("arranges connected nodes left-to-right by dependency level", () => {
        const nodes = [node("b", 50, 200, CanvasNodeType.Image), node("a", 500, 40, CanvasNodeType.Text)];
        const connections: CanvasConnection[] = [{ id: "e1", fromNodeId: "a", toNodeId: "b" }];
        const arranged = autoArrangeCanvasNodes(nodes, connections, new Set());
        const a = arranged.find((n) => n.id === "a")!;
        const b = arranged.find((n) => n.id === "b")!;
        expect(a.position.x).toBeLessThan(b.position.x);
    });

    it("keeps locked nodes fixed in place", () => {
        const nodes = [
            node("locked", 900, 900, CanvasNodeType.Image, { locked: true }),
            node("a", 400, 100, CanvasNodeType.Text),
            node("b", 100, 300, CanvasNodeType.Image),
        ];
        const arranged = autoArrangeCanvasNodes(nodes, [], new Set());
        expect(arranged.find((n) => n.id === "locked")!.position).toEqual({ x: 900, y: 900 });
    });

    it("moves group children by the same delta as their parent group", () => {
        const nodes = [
            node("g1", 600, 200, CanvasNodeType.Group),
            node("c1", 630, 240, CanvasNodeType.Text, { groupId: "g1" }),
            node("n2", 100, 100, CanvasNodeType.Image),
        ];
        const arranged = autoArrangeCanvasNodes(nodes, [], new Set());
        const g1 = arranged.find((n) => n.id === "g1")!;
        const c1 = arranged.find((n) => n.id === "c1")!;
        expect(c1.position.x - g1.position.x).toBe(30);
        expect(c1.position.y - g1.position.y).toBe(40);
    });

    it("returns original array reference when fewer than 2 movable nodes exist", () => {
        const nodes = [node("only", 10, 20)];
        expect(autoArrangeCanvasNodes(nodes, [], new Set())).toBe(nodes);
    });
});
