import { describe, expect, it } from "vitest";
import type { CanvasNodeData } from "@/types/canvas";
import { activeTextOverlays, textOf } from "@/lib/canvas/timeline-text";
import { resolveClips, trackOf } from "@/domain/timeline/view";
import { nodesById } from "@/domain/timeline/resolve";
import { secondsToTicks } from "@/domain/timeline/time";
import type { Timeline } from "@/domain/timeline/model";

const TPS = 120000;

function textNode(id: string, content: string): CanvasNodeData {
    return { id, type: "text", title: id, position: { x: 0, y: 0 }, width: 300, height: 60,
        metadata: { status: "success", content } } as CanvasNodeData;
}

describe("timeline-text：预览与导出共用的字幕判定", () => {
    const nodes = [textNode("a", "HELLO"), textNode("b", "WORLD"), textNode("empty", "  ")];
    const index = nodesById(nodes);
    const timeline: Timeline = {
        fps: 24,
        tracks: [{ id: "text", kind: "text", clips: [
            { id: "ta", nodeId: "a", startTick: secondsToTicks(1), durationTick: secondsToTicks(2), sourceStartTick: 0 },
            { id: "tb", nodeId: "b", startTick: secondsToTicks(4), durationTick: secondsToTicks(2), sourceStartTick: 0 },
            { id: "te", nodeId: "empty", startTick: 0, durationTick: secondsToTicks(8), sourceStartTick: 0 },
        ] }],
    };
    const shots = resolveClips(trackOf(timeline, "text"), index)
        .filter((item) => item.node?.type === "text" && Boolean(textOf(item.node!)));

    it("textOf 优先整体 content，空白文本视为无字幕", () => {
        expect(textOf(nodes[0]!)).toBe("HELLO");
        expect(textOf(nodes[2]!)).toBe("");
        expect(textOf({ ...nodes[0]!, metadata: { texts: [{ content: "FIRST" }, { content: "SECOND" }] } } as CanvasNodeData)).toBe("FIRST");
    });

    it("只在 clip 命中时刻返回字幕，空档返回空", () => {
        expect(activeTextOverlays(shots, 0.5)).toEqual([]);
        expect(activeTextOverlays(shots, 2)).toEqual([{ text: "HELLO" }]);
        expect(activeTextOverlays(shots, 3.5)).toEqual([]);
        expect(activeTextOverlays(shots, 5)).toEqual([{ text: "WORLD" }]);
    });

    it("多条字幕同时命中时全部返回，顺序稳定", () => {
        const overlap: Timeline = { fps: 24, tracks: [{ id: "text", kind: "text", clips: [
            { id: "ta", nodeId: "a", startTick: 0, durationTick: secondsToTicks(6), sourceStartTick: 0 },
            { id: "tb", nodeId: "b", startTick: secondsToTicks(2), durationTick: secondsToTicks(4), sourceStartTick: 0 },
        ] }] };
        const both = resolveClips(trackOf(overlap, "text"), index);
        expect(activeTextOverlays(both, 3)).toEqual([{ text: "HELLO" }, { text: "WORLD" }]);
    });
});
