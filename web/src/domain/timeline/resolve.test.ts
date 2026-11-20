import { describe, expect, it } from "vitest";
import { resolveTimeline, nodesById, DEFAULT_TIMELINE_FPS } from "./resolve";
import type { CanvasNodeData } from "../../types/canvas";

const node = (id: string, type: string, patch: Partial<CanvasNodeData["metadata"]> = {}): CanvasNodeData => ({
  id, type, title: id, position: { x: 0, y: 0 }, width: 100, height: 100,
  metadata: { status: "success", content: "blob:x", ...patch },
});

describe("resolveTimeline", () => {
  it("uses the stored timeline verbatim when present", () => {
    const stored = { fps: 30, tracks: [{ id: "video", kind: "video" as const, clips: [] }] };
    expect(resolveTimeline([node("a", "image")], stored)).toBe(stored);
  });

  it("derives from legacy node fields when absent, without mutating nodes", () => {
    const nodes = [
      node("a", "image", { timelineOrder: 0 }),
      node("b", "video", { timelineOrder: 1, durationMs: 2000 }),
    ];
    const before = JSON.stringify(nodes);
    const timeline = resolveTimeline(nodes, undefined);
    expect(timeline.fps).toBe(DEFAULT_TIMELINE_FPS);
    expect(timeline.tracks.find((t) => t.kind === "video")?.clips).toHaveLength(2);
    expect(JSON.stringify(nodes)).toBe(before);
  });

  it("indexes nodes by id for clip lookup", () => {
    const a = node("a", "image");
    const map = nodesById([a]);
    expect(map.get("a")).toBe(a);
    expect(map.get("missing")).toBeUndefined();
  });
});
