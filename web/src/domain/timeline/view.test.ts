import { describe, expect, it } from "vitest";
import { trackOf, resolveClips, clipAtSeconds, clipsAtSeconds, replaceTrackClips, addClipToTrack, snapToEdges } from "./view";
import { secondsToTicks, ticksPerFrame } from "./time";
import type { Timeline, TimelineTrack } from "./model";
import type { CanvasNodeData } from "../../types/canvas";

const node = (id: string): CanvasNodeData => ({ id, type: "image", title: id, position: { x: 0, y: 0 }, width: 100, height: 100 });
const timeline: Timeline = {
  fps: 24,
  tracks: [{ id: "video", kind: "video", clips: [
    { id: "c2", nodeId: "b", startTick: secondsToTicks(6), durationTick: secondsToTicks(2), sourceStartTick: 0 },
    { id: "c1", nodeId: "a", startTick: secondsToTicks(1), durationTick: secondsToTicks(3), sourceStartTick: secondsToTicks(0.5) },
  ] }],
};

describe("trackOf", () => {
  it("returns the matching track or an empty one", () => {
    expect(trackOf(timeline, "video").clips).toHaveLength(2);
    expect(trackOf(timeline, "text").clips).toEqual([]);
    expect(trackOf(timeline, "text").kind).toBe("text");
  });
});

describe("replaceTrackClips", () => {
  it("replaces by kind even when the track id differs (multi-track / migrated data)", () => {
    const custom: Timeline = { fps: 24, tracks: [
      { id: "vt-custom", kind: "video", clips: timeline.tracks[0].clips },
      { id: "at-custom", kind: "audio", clips: [] },
    ] };
    const nextClip = { id: "c3", nodeId: "c", startTick: secondsToTicks(9), durationTick: secondsToTicks(2), sourceStartTick: 0 };
    const result = replaceTrackClips(custom, "video", [nextClip]);
    expect(result.tracks.find((t) => t.kind === "video")?.clips).toEqual([nextClip]);
    expect(result.tracks.find((t) => t.kind === "audio")?.clips).toEqual([]);
    // 原对象不被修改
    expect(custom.tracks[0].clips).toHaveLength(2);
  });

  it("leaves other tracks untouched and is a no-op for a missing kind", () => {
    const result = replaceTrackClips(timeline, "text", [{ id: "x", nodeId: "x", startTick: 0, durationTick: 1, sourceStartTick: 0 }]);
    expect(result.tracks).toHaveLength(1); // text 轨不存在时不新增
    expect(result.tracks[0].clips).toHaveLength(2);
  });
});

describe("snapToEdges", () => {
  const fps = 24;
  const frame = ticksPerFrame(fps);
  const threshold = Math.round(0.25 * 120000); // 0.25s

  it("snaps to the nearest edge within threshold, preferring it over the frame grid", () => {
    const edge = secondsToTicks(4);
    // 落在 4s 边缘附近 0.1s，但离最近帧可能也不远——边缘优先
    const near = edge + secondsToTicks(0.1);
    expect(snapToEdges(near, [edge], threshold, fps)).toBe(edge);
  });

  it("falls back to the frame grid when no edge is close enough", () => {
    const result = snapToEdges(secondsToTicks(4) + secondsToTicks(0.5), [secondsToTicks(4)], threshold, fps);
    expect(result).toBe(Math.round((secondsToTicks(4) + secondsToTicks(0.5)) / frame) * frame);
    expect(result % frame).toBe(0);
  });

  it("picks the closest edge when several are within threshold", () => {
    const at = secondsToTicks(4) + secondsToTicks(0.12);
    const edges = [secondsToTicks(4), secondsToTicks(4.2)];
    // 4s 距 0.12s、4.2s 距 0.08s → 选 4.2s
    expect(snapToEdges(at, edges, threshold, fps)).toBe(secondsToTicks(4.2));
  });

  it("never returns a negative tick", () => {
    expect(snapToEdges(-1000, [0], threshold, fps)).toBeGreaterThanOrEqual(0);
  });

  it("keeps 0 as a candidate so clips snap to timeline start", () => {
    expect(snapToEdges(secondsToTicks(0.1), [0], threshold, fps)).toBe(0);
  });
});

describe("addClipToTrack", () => {
  const c = { id: "t1", nodeId: "txt", startTick: 0, durationTick: secondsToTicks(4), sourceStartTick: 0 };

  it("creates the track when it does not exist (text track is absent by default)", () => {
    const result = addClipToTrack(timeline, "text", c);
    const text = result.tracks.find((t) => t.kind === "text");
    expect(text?.clips).toEqual([c]);
    expect(result.tracks.find((t) => t.kind === "video")?.clips).toHaveLength(2);
    expect(timeline.tracks).toHaveLength(1); // 不改原对象
  });

  it("appends to an existing track", () => {
    const audioTrack: TimelineTrack = { id: "audio", kind: "audio", clips: [] };
    const withAudio: Timeline = { fps: 24, tracks: [timeline.tracks[0]!, audioTrack] };
    const result = addClipToTrack(withAudio, "audio", c);
    expect(result.tracks.find((t) => t.kind === "audio")?.clips).toEqual([c]);
  });
});

describe("resolveClips", () => {
  it("sorts by absolute start and resolves nodes, keeping gaps", () => {
    const index = new Map([["a", node("a")], ["b", node("b")]]);
    const clips = resolveClips(trackOf(timeline, "video"), index);
    expect(clips.map((c) => c.clip.id)).toEqual(["c1", "c2"]);
    expect(clips[0].startSeconds).toBe(1);
    expect(clips[0].sourceStartSeconds).toBe(0.5);
    expect(clips[1].startSeconds).toBe(6); // 1..4 之后有 2 秒空档
    expect(clips[0].node?.id).toBe("a");
  });

  it("keeps a clip whose node was deleted", () => {
    const clips = resolveClips(trackOf(timeline, "video"), new Map());
    expect(clips).toHaveLength(2);
    expect(clips[0].node).toBeUndefined();
  });
});

describe("clipAtSeconds", () => {
  it("finds the clip under the playhead and returns null in a gap", () => {
    const clips = resolveClips(trackOf(timeline, "video"), new Map());
    expect(clipAtSeconds(clips, 2)?.clip.id).toBe("c1");
    expect(clipAtSeconds(clips, 4)).toBeNull();   // clip 结束点
    expect(clipAtSeconds(clips, 5)).toBeNull();   // 空档中间
    expect(clipAtSeconds(clips, 6.5)?.clip.id).toBe("c2");
  });
});

describe("clipsAtSeconds", () => {
  it("returns all overlapping clips for stacked subtitle tracks", () => {
    const textTrack = {
      id: "text", kind: "text" as const,
      clips: [
        { id: "t1", nodeId: "a", startTick: secondsToTicks(1), durationTick: secondsToTicks(4), sourceStartTick: 0 },
        { id: "t2", nodeId: "b", startTick: secondsToTicks(3), durationTick: secondsToTicks(4), sourceStartTick: 0 },
      ],
    };
    const clips = resolveClips(textTrack, new Map());
    expect(clipsAtSeconds(clips, 2).map((c) => c.clip.id)).toEqual(["t1"]);
    expect(clipsAtSeconds(clips, 3.5).map((c) => c.clip.id)).toEqual(["t1", "t2"]);
    expect(clipsAtSeconds(clips, 5).map((c) => c.clip.id)).toEqual(["t2"]); // t1 已结束
    expect(clipsAtSeconds(clips, 7)).toEqual([]); // t2 结束点，空档
  });
});
