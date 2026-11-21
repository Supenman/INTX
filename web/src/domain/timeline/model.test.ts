import { describe, expect, it } from "vitest";
import { secondsToTicks, snapToFrame, TICKS_PER_SECOND, ticksToSeconds } from "./time";
import {
    clipEnd,
    fromLegacyNodes,
    moveClip,
    resolveStart,
    splitClip,
    timelineDuration,
    trackDuration,
    trimClip,
    type TimelineClip,
    type TimelineTrack,
} from "./model";

const clip = (id: string, startTick: number, durationTick: number, sourceStartTick = 0): TimelineClip =>
    ({ id, nodeId: `node-${id}`, startTick, durationTick, sourceStartTick });

const videoTrack = (...clips: TimelineClip[]): TimelineTrack => ({ id: "video", kind: "video", clips });

describe("time base", () => {
    it("keeps integer frame boundaries at every common frame rate", () => {
        expect(TICKS_PER_SECOND / 30).toBe(4000);
        expect(TICKS_PER_SECOND / 25).toBe(4800);
        expect(TICKS_PER_SECOND / 24).toBe(5000);
        // 23.976 不是整数帧率，只能取整到 5005 ticks；这正是要整数时间基的原因，不是缺陷。
        expect(Math.round(TICKS_PER_SECOND / 23.976)).toBe(5005);
        expect(secondsToTicks(1 / 30) * 30).toBe(TICKS_PER_SECOND);
    });

    it("snaps to the nearest frame instead of producing half frames", () => {
        expect(snapToFrame(4100, 30)).toBe(4000);
        expect(snapToFrame(6100, 30)).toBe(8000);
        expect(ticksToSeconds(snapToFrame(secondsToTicks(1.5), 30))).toBe(1.5);
    });
});

describe("overlap resolution", () => {
    it("pushes a dropped clip to the end of whatever it collides with", () => {
        const track = videoTrack(clip("a", 0, secondsToTicks(2)));
        expect(resolveStart(track, "b", secondsToTicks(1), secondsToTicks(2))).toBe(secondsToTicks(2));
    });

    it("keeps walking forward until every collision is cleared", () => {
        const track = videoTrack(clip("a", 0, 1000), clip("b", 1000, 1000));
        // 期望落在两者中间，但时长跨过 b，只能排到 b 之后。
        expect(resolveStart(track, "c", 500, 3000)).toBe(2000);
    });

    it("never lets a clip start before zero", () => {
        expect(resolveStart(videoTrack(), "a", -5000, 1000)).toBe(0);
    });
});

describe("moveClip", () => {
    it("resolves collisions on the video track only", () => {
        const track = videoTrack(clip("a", 0, 1000));
        const moved = moveClip(track, "a", 0);
        expect(moved).toBe(track); // 没有位移时返回原引用，调用方据此跳过 setState
    });

    it("lets audio clips overlap freely", () => {
        const audio: TimelineTrack = { id: "audio", kind: "audio", clips: [clip("voice", 0, 5000)] };
        const moved = moveClip(audio, "voice", 2000);
        expect(moved.clips[0]!.startTick).toBe(2000);
    });
});

describe("trimClip", () => {
    it("moves start, duration and source in point together", () => {
        const track = videoTrack(clip("a", secondsToTicks(4), secondsToTicks(3), secondsToTicks(1)));
        const trimmed = trimClip(track, "a", "start", secondsToTicks(5));
        const next = trimmed.clips[0]!;
        expect(next.startTick).toBe(secondsToTicks(5));
        expect(next.durationTick).toBe(secondsToTicks(2));
        expect(next.sourceStartTick).toBe(secondsToTicks(2));
    });

    it("lets the left edge reach back only as far as the source actually has material", () => {
        // 时间线 4s 处、素材入点 1s，意味着 3s 处正好对应素材第 0 帧——这是极限，再往前就没有画面了。
        const track = videoTrack(clip("a", secondsToTicks(4), secondsToTicks(3), secondsToTicks(1)));
        expect(trimClip(track, "a", "start", 0).clips[0]!.startTick).toBe(secondsToTicks(3));
        expect(trimClip(track, "a", "start", 0).clips[0]!.sourceStartTick).toBe(0);
    });

    it("keeps at least one frame from the right edge", () => {
        const track = videoTrack(clip("a", 0, secondsToTicks(2)));
        const trimmed = trimClip(track, "a", "end", -100, 4000);
        expect(trimmed.clips[0]!.durationTick).toBe(4000);
    });
});

describe("splitClip", () => {
    it("splits at the playhead into two adjacent clips with continuous source in-points", () => {
        // 素材从 1s 入点开始，在时间线上占 4s..10s；在 6s 处切。
        const track = videoTrack(clip("a", secondsToTicks(4), secondsToTicks(6), secondsToTicks(1)));
        const split = splitClip(track, "a", secondsToTicks(6));
        expect(split.clips).toHaveLength(2);
        const [left, right] = split.clips;
        expect(left!.id).toBe("a"); // 左段沿用原 id，已有引用不断
        expect(left!.startTick).toBe(secondsToTicks(4));
        expect(left!.durationTick).toBe(secondsToTicks(2));
        expect(left!.sourceStartTick).toBe(secondsToTicks(1));
        expect(right!.startTick).toBe(secondsToTicks(6));
        expect(right!.durationTick).toBe(secondsToTicks(4));
        // 切点画面不跳：左段末尾素材时刻 = 右段入点素材时刻 = 3s
        expect(right!.sourceStartTick).toBe(left!.sourceStartTick + left!.durationTick);
        expect(right!.nodeId).toBe(left!.nodeId);
        expect(right!.id).not.toBe(left!.id);
    });

    it("is a no-op when the playhead is outside the clip or too close to an edge", () => {
        const track = videoTrack(clip("a", secondsToTicks(4), secondsToTicks(6), secondsToTicks(1)));
        expect(splitClip(track, "a", secondsToTicks(4))).toBe(track);  // 正好起点
        expect(splitClip(track, "a", secondsToTicks(10))).toBe(track); // 正好终点
        expect(splitClip(track, "a", secondsToTicks(2))).toBe(track);  // 片段之前
        expect(splitClip(track, "a", secondsToTicks(12))).toBe(track); // 片段之后
        // 最小段长由调用方按帧长传入；离边缘 1 tick 时若要求 30fps 一帧（4000 ticks）则拒绝
        expect(splitClip(track, "a", secondsToTicks(4) + 1, 4000)).toBe(track);
        expect(splitClip(track, "a", secondsToTicks(10) - 1, 4000)).toBe(track);
    });

    it("works on audio tracks too and leaves the source track untouched", () => {
        const original = clip("voice", 0, secondsToTicks(5), secondsToTicks(1));
        const audio: TimelineTrack = { id: "audio", kind: "audio", clips: [original] };
        const split = splitClip(audio, "voice", secondsToTicks(2));
        expect(split.clips).toHaveLength(2);
        expect(split.clips[1]!.volume).toBe(original.volume);
        expect(audio.clips).toHaveLength(1); // 不改原 track
        expect(audio.clips[0]).toBe(original);
    });

    it("is a no-op for an unknown clip id", () => {
        const track = videoTrack(clip("a", 0, secondsToTicks(5)));
        expect(splitClip(track, "missing", secondsToTicks(2))).toBe(track);
    });
});

describe("durations", () => {
    it("measures a track by its furthest clip end, not by the sum of clips", () => {
        const track = videoTrack(clip("a", 0, 1000), clip("b", 5000, 1000));
        expect(trackDuration(track)).toBe(6000);
        expect(clipEnd(track.clips[1]!)).toBe(6000);
    });

    it("takes the longest track as the timeline length", () => {
        const timeline = {
            fps: 30,
            tracks: [
                videoTrack(clip("a", 0, 1000)),
                { id: "audio", kind: "audio" as const, clips: [clip("voice", 0, 9000)] },
            ],
        };
        expect(timelineDuration(timeline)).toBe(9000);
    });
});

describe("legacy migration", () => {
    it("rebuilds the head-to-tail video track and the absolutely positioned audio track", () => {
        const timeline = fromLegacyNodes([
            { id: "img-1", type: "image", title: "一", position: { x: 100 }, metadata: { status: "success", content: "a" } },
            { id: "vid-2", type: "video", title: "二", position: { x: 200 }, metadata: { status: "success", content: "b", durationMs: 3000 } },
            { id: "aud-3", type: "audio", title: "旁白", position: { x: 0 }, metadata: { status: "success", content: "c", durationMs: 5000, timelineStartSeconds: 1 } },
            { id: "img-4", type: "image", title: "失败的", position: { x: 300 }, metadata: { status: "error", content: "d" } },
        ], 30);

        const [video, audio] = timeline.tracks;
        expect(video!.clips.map((item) => [item.nodeId, ticksToSeconds(item.startTick), ticksToSeconds(item.durationTick)]))
            .toEqual([["img-1", 0, 4], ["vid-2", 4, 3]]);
        expect(audio!.clips).toHaveLength(1);
        expect(ticksToSeconds(audio!.clips[0]!.startTick)).toBe(1);
        expect(ticksToSeconds(audio!.clips[0]!.durationTick)).toBe(5);
    });

    it("旧数据迁移：有镜号的按镜号排，没镜号的按画布 x 接在后面", () => {
        const timeline = fromLegacyNodes([
            { id: "no-order", type: "image", title: "无编号但 x 很小", position: { x: 10 }, metadata: { status: "success", content: "a" } },
            { id: "second", type: "image", title: "第 2 镜", position: { x: 900 }, metadata: { status: "success", content: "b", timelineOrder: 2 } },
            { id: "first", type: "image", title: "第 1 镜", position: { x: 800 }, metadata: { status: "success", content: "c", timelineOrder: 1 } },
        ], 30);
        const [video] = timeline.tracks;
        // 混排会用 position.x 覆盖镜号，把 x=10 的无编号镜头插到最前面——那正是要防的。
        expect(video!.clips.map((item) => item.nodeId)).toEqual(["first", "second", "no-order"]);
    });

    it("honours explicit trim points over the default duration", () => {
        const timeline = fromLegacyNodes([
            { id: "v", type: "video", title: "带裁剪", position: { x: 0 }, metadata: { status: "success", content: "x", durationMs: 10000, timelineTrimStartSeconds: 2, timelineTrimEndSeconds: 6 } },
        ], 24);
        const [video] = timeline.tracks;
        expect(ticksToSeconds(video!.clips[0]!.durationTick)).toBe(4);
        expect(ticksToSeconds(video!.clips[0]!.sourceStartTick)).toBe(2);
    });
});
