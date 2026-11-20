import type { CanvasNodeData } from "../../types/canvas";
import { snapToFrame, ticksToSeconds } from "./time";
import type { Timeline, TimelineClip, TimelineTrack } from "./model";

export type ResolvedClip = {
  clip: TimelineClip;
  node?: CanvasNodeData;
  startSeconds: number;
  durationSeconds: number;
  sourceStartSeconds: number;
};

export function trackOf(timeline: Timeline, kind: TimelineTrack["kind"]): TimelineTrack {
  return timeline.tracks.find((track) => track.kind === kind) ?? { id: kind, kind, clips: [] };
}

/**
 * 按轨道种类替换 clips。必须按 kind 匹配，不能按 id——轨道 id 是自由标识
 * （默认恰好等于 kind，但多轨/迁移数据下会不同），按 id 会让所有编辑静默失效。
 */
export function replaceTrackClips(timeline: Timeline, kind: TimelineTrack["kind"], clips: TimelineClip[]): Timeline {
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) => track.kind === kind ? { ...track, clips } : track),
  };
}

/** clip 按绝对起点排序；节点可能已被删除，保留 clip 但不解析素材，交给渲染层提示。 */
export function resolveClips(track: TimelineTrack, index: ReadonlyMap<string, CanvasNodeData>): ResolvedClip[] {
  return [...track.clips]
    .sort((a, b) => a.startTick - b.startTick)
    .map((clip) => ({
      clip,
      node: index.get(clip.nodeId),
      startSeconds: ticksToSeconds(clip.startTick),
      durationSeconds: ticksToSeconds(clip.durationTick),
      sourceStartSeconds: ticksToSeconds(clip.sourceStartTick),
    }));
}

/** 播放头落在哪个镜头：命中 clip 的 [start, start+duration)；落在空档上返回 null。 */
export function clipAtSeconds(clips: readonly ResolvedClip[], seconds: number): ResolvedClip | null {
    return clips.find((item) => seconds >= item.startSeconds && seconds < item.startSeconds + item.durationSeconds) ?? null;
}

/** 文字轨可能多条同时命中（不同字幕叠加），返回全部命中项。区间语义与 clipAtSeconds 一致。 */
export function clipsAtSeconds(clips: readonly ResolvedClip[], seconds: number): ResolvedClip[] {
    return clips.filter((item) => seconds >= item.startSeconds && seconds < item.startSeconds + item.durationSeconds);
}

/**
 * 拖动落点吸附：阈值内优先贴到最近的边缘候选点（同轨其它片段的起止、时间线 0 点），
 * 否则退回帧网格。边缘优先于帧，才能让两段紧贴时严丝合缝。
 */
export function snapToEdges(tick: number, candidates: readonly number[], threshold: number, fps: number): number {
    let best: number | null = null;
    let bestDist = threshold + 1;
    for (const edge of candidates) {
        const dist = Math.abs(tick - edge);
        if (dist <= threshold && dist < bestDist) { best = edge; bestDist = dist; }
    }
    const result = best ?? snapToFrame(tick, fps);
    return Math.max(0, result);
}

/**
 * 往指定轨道加 clip；轨道不存在时创建（文字轨默认不存在，addText 依赖此行为）。
 * 与 replaceTrackClips 的分工：那个只替换已有轨，这个负责让轨从无到有。
 */
export function addClipToTrack(timeline: Timeline, kind: TimelineTrack["kind"], clip: TimelineClip): Timeline {
    const existing = timeline.tracks.find((track) => track.kind === kind);
    if (existing) return replaceTrackClips(timeline, kind, [...existing.clips, clip]);
    return { ...timeline, tracks: [...timeline.tracks, { id: kind, kind, clips: [clip] }] };
}

/** 屏幕像素 → 时间线秒。考虑横向滚动。 */
export function pixelToSeconds(clientX: number, bounds: DOMRect, scrollLeft: number, pixelsPerSecond: number): number {
  return Math.max(0, (clientX - bounds.left + scrollLeft) / pixelsPerSecond);
}
