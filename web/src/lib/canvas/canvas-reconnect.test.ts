import { describe, expect, it } from "vitest";

import { reconnectCanvasConnection } from "./canvas-reconnect";
import type { CanvasConnection } from "@/types/canvas";

describe("reconnectCanvasConnection", () => {
    const base: CanvasConnection[] = [
        { id: "c1", fromNodeId: "a", toNodeId: "b" },
        { id: "c2", fromNodeId: "a", toNodeId: "c" },
    ];

    it("rewires an existing connection to a new target node in place", () => {
        const next = reconnectCanvasConnection(base, "c1", "a", "d");
        expect(next).toEqual([
            { id: "c1", fromNodeId: "a", toNodeId: "d" },
            { id: "c2", fromNodeId: "a", toNodeId: "c" },
        ]);
    });

    it("removes the reconnected edge instead of duplicating an existing identical edge", () => {
        const next = reconnectCanvasConnection(base, "c1", "a", "c");
        expect(next).toEqual([{ id: "c2", fromNodeId: "a", toNodeId: "c" }]);
    });

    it("returns original reference on self-loop or unchanged endpoints", () => {
        expect(reconnectCanvasConnection(base, "c1", "a", "a")).toBe(base);
        expect(reconnectCanvasConnection(base, "c1", "a", "b")).toBe(base);
    });

    it("returns original reference when connection id does not exist", () => {
        expect(reconnectCanvasConnection(base, "missing", "a", "d")).toBe(base);
    });
});
