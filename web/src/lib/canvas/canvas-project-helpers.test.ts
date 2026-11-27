import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
    if (typeof globalThis.localStorage === "undefined") {
        Object.defineProperty(globalThis, "localStorage", {
            value: { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} },
            configurable: true,
        });
    }
});

import { isNativeMediaControlHit } from "./canvas-project-helpers";
import { computeResetViewport } from "./canvas-node-geometry";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function makeElement(tagName: string, rect: { top: number; bottom: number; height: number }): Element {
    return {
        tagName,
        getBoundingClientRect: () => ({ top: rect.top, bottom: rect.bottom, height: rect.height, left: 0, right: 320, width: 320, x: 0, y: rect.top, toJSON: () => ({}) }),
    } as unknown as Element;
}

describe("isNativeMediaControlHit", () => {
    it("allows dragging on the main video frame while reserving the bottom native control bar", () => {
        const video = makeElement("VIDEO", { top: 100, bottom: 400, height: 300 });
        expect(isNativeMediaControlHit(video, 220)).toBe(false);
        expect(isNativeMediaControlHit(video, 350)).toBe(false);
        expect(isNativeMediaControlHit(video, 360)).toBe(true);
        expect(isNativeMediaControlHit(video, 395)).toBe(true);
    });

    it("preserves audio element playback controls and allows dragging other elements", () => {
        const audio = makeElement("AUDIO", { top: 100, bottom: 154, height: 54 });
        const div = makeElement("DIV", { top: 0, bottom: 200, height: 200 });
        expect(isNativeMediaControlHit(audio, 120)).toBe(true);
        expect(isNativeMediaControlHit(div, 120)).toBe(false);
        expect(isNativeMediaControlHit(null, 120)).toBe(false);
    });
});

describe("computeResetViewport", () => {
    it("centers world origin at 100% when the canvas has no nodes", () => {
        expect(computeResetViewport([], { width: 1200, height: 800 })).toEqual({ x: 600, y: 400, k: 1 });
    });

    it("frames all existing nodes instead of jumping to empty origin", () => {
        const nodes: CanvasNodeData[] = [
            { id: "n1", type: CanvasNodeType.Image, title: "A", position: { x: 1000, y: 600 }, width: 320, height: 240, metadata: {} },
            { id: "n2", type: CanvasNodeType.Video, title: "B", position: { x: 1400, y: 600 }, width: 320, height: 240, metadata: {} },
        ];
        const next = computeResetViewport(nodes, { width: 1200, height: 800 });
        expect(next.k).toBe(1);
        // Bounds center is x = 1360, y = 720 -> viewport should center that midpoint at screen (600, 400)
        expect(next.x).toBe(600 - 1360);
        expect(next.y).toBe(400 - 720);
    });
});
