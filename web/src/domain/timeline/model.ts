import { secondsToTicks, TICKS_PER_SECOND } from "./time";

export type ClipKind = "video" | "audio" | "text";

export type TimelineClip = {
    id: string;
    /** 素材来源。指向画布节点，所以同一个素材可以在不同轨、不同时间出现多次。 */
    nodeId: string;
    /** 在时间线上的起点。 */
    startTick: number;
    /** 在时间线上占据的长度。 */
    durationTick: number;
    /** 素材内部的入点，配合 trim 使用；非破坏性，不截断原素材。 */
    sourceStartTick: number;
    /** 仅音频轨有意义，0–1。 */
    volume?: number;
};

export type TimelineTrack = {
    id: string;
    kind: ClipKind;
    clips: TimelineClip[];
};

export type Timeline = {
    fps: number;
    tracks: TimelineTrack[];
};

export const DEFAULT_CLIP_TICKS = 4 * TICKS_PER_SECOND;

export function clipEnd(clip: TimelineClip): number {
    return clip.startTick + clip.durationTick;
}

export function trackDuration(track: TimelineTrack): number {
    return track.clips.reduce((end, clip) => Math.max(end, clipEnd(clip)), 0);
}

export function timelineDuration(timeline: Timeline): number {
    return timeline.tracks.reduce((end, track) => Math.max(end, trackDuration(track)), 0);
}

/**
 * 把期望起点修正到不与同轨其它片段重叠的位置。
 *
 * 只有视频轨需要：同一时刻画面上只能有一个镜头。音频和文字轨允许叠加，
 * 所以调用方对这两种轨道直接用期望值即可，不要走这里。
 *
 * 采用「往后推」而不是「拒绝」：拖动时片段贴着前一个的尾部停下，比拖不动更符合直觉。
 */
export function resolveStart(track: TimelineTrack, movingClipId: string, desiredStart: number, duration: number): number {
    let start = Math.max(0, desiredStart);
    const others = track.clips
        .filter((clip) => clip.id !== movingClipId)
        .sort((a, b) => a.startTick - b.startTick);
    for (const other of others) {
        if (start < clipEnd(other) && start + duration > other.startTick) start = clipEnd(other);
    }
    return start;
}

export function moveClip(track: TimelineTrack, clipId: string, desiredStart: number): TimelineTrack {
    const clip = track.clips.find((item) => item.id === clipId);
    if (!clip) return track;
    const startTick = track.kind === "video"
        ? resolveStart(track, clipId, desiredStart, clip.durationTick)
        : Math.max(0, desiredStart);
    if (startTick === clip.startTick) return track;
    return { ...track, clips: track.clips.map((item) => item.id === clipId ? { ...item, startTick } : item) };
}

/**
 * 拖拽片段左右边缘。
 *
 * 左边缘同时改变起点、时长和素材入点，三者要一起动，否则画面会跳；
 * 右边缘只改时长，素材入点不动。
 */
export function trimClip(track: TimelineTrack, clipId: string, edge: "start" | "end", tick: number, minDurationTick = 1): TimelineTrack {
    const clip = track.clips.find((item) => item.id === clipId);
    if (!clip) return track;
    const end = clipEnd(clip);
    const minimum = Math.min(Math.max(1, minDurationTick), clip.durationTick);

    if (edge === "start") {
        const sourceLimit = clip.startTick - clip.sourceStartTick;
        const startTick = Math.max(sourceLimit, Math.min(tick, end - minimum));
        const delta = startTick - clip.startTick;
        if (delta === 0) return track;
        const next: TimelineClip = {
            ...clip,
            startTick,
            durationTick: clip.durationTick - delta,
            sourceStartTick: clip.sourceStartTick + delta,
        };
        return { ...track, clips: track.clips.map((item) => item.id === clipId ? next : item) };
    }

    const durationTick = Math.max(minimum, tick - clip.startTick);
    if (durationTick === clip.durationTick) return track;
    const next: TimelineClip = { ...clip, durationTick };
    return { ...track, clips: track.clips.map((item) => item.id === clipId ? next : item) };
}

/**
 * 在播放头处把一个片段切成两段。左段沿用原 id（已有引用不断），右段用带切点的确定性新 id。
 * 右段入点接着左段的素材偏移，切点前后画面连续；切点落在片段外或离边缘不足一帧时返回原引用。
 */
export function splitClip(track: TimelineTrack, clipId: string, atTick: number, minDurationTick = 1): TimelineTrack {
    const clip = track.clips.find((item) => item.id === clipId);
    if (!clip) return track;
    const leftDuration = atTick - clip.startTick;
    const rightDuration = clip.durationTick - leftDuration;
    if (leftDuration < Math.max(1, minDurationTick) || rightDuration < Math.max(1, minDurationTick)) return track;

    const left: TimelineClip = { ...clip, durationTick: leftDuration };
    const right: TimelineClip = {
        ...clip,
        id: `${clip.id}-split-${atTick}`,
        startTick: atTick,
        durationTick: rightDuration,
        sourceStartTick: clip.sourceStartTick + leftDuration,
    };
    return { ...track, clips: track.clips.flatMap((item) => item.id === clipId ? [left, right] : [item]) };
}

export function removeClip(track: TimelineTrack, clipId: string): TimelineTrack {
    return { ...track, clips: track.clips.filter((clip) => clip.id !== clipId) };
}

export function addClip(track: TimelineTrack, clip: TimelineClip): TimelineTrack {
    return { ...track, clips: [...track.clips, clip] };
}

/**
 * 旧数据迁移：把节点上挂的 timeline* 字段还原成一条视频轨和一条音频轨。
 *
 * 旧模型里视频镜头是首尾相接的（时长 = 所有镜头之和），所以这里按顺序累加还原；
 * 音频有独立的 timelineStartSeconds，直接当成绝对位置。迁移只读，不改节点。
 */
export function fromLegacyNodes(nodes: readonly {
    id: string;
    type: string;
    title: string;
    position: { x: number };
    metadata?: {
        status?: string;
        content?: string;
        durationMs?: number;
        timelineOrder?: number;
        timelineStartSeconds?: number;
        timelineTrimStartSeconds?: number;
        timelineTrimEndSeconds?: number;
    };
}[], fps: number): Timeline {
    const playable = nodes
        .filter((node) => node.metadata?.status === "success" && node.metadata.content)
        .sort((a, b) => (a.metadata?.timelineOrder ?? a.position.x) - (b.metadata?.timelineOrder ?? b.position.x));

    const videoClips: TimelineClip[] = [];
    let cursor = 0;
    for (const node of playable) {
        if (node.type !== "video" && node.type !== "image") continue;
        const sourceStart = node.metadata?.timelineTrimStartSeconds ?? 0;
        const sourceEnd = node.metadata?.timelineTrimEndSeconds
            ?? (node.metadata?.durationMs ? node.metadata.durationMs / 1000 : 4);
        const durationTick = secondsToTicks(Math.max(0, sourceEnd - sourceStart));
        if (durationTick <= 0) continue;
        videoClips.push({
            id: `clip-${node.id}`,
            nodeId: node.id,
            startTick: cursor,
            durationTick,
            sourceStartTick: secondsToTicks(sourceStart),
        });
        cursor += durationTick;
    }

    const audioClips: TimelineClip[] = playable
        .filter((node) => node.type === "audio")
        .map((node) => {
            const sourceStart = node.metadata?.timelineTrimStartSeconds ?? 0;
            const sourceEnd = node.metadata?.timelineTrimEndSeconds
                ?? (node.metadata?.durationMs ? node.metadata.durationMs / 1000 : 0);
            return {
                id: `clip-${node.id}`,
                nodeId: node.id,
                startTick: secondsToTicks(node.metadata?.timelineStartSeconds ?? 0),
                durationTick: secondsToTicks(Math.max(0, sourceEnd - sourceStart)),
                sourceStartTick: secondsToTicks(sourceStart),
            };
        })
        .filter((clip) => clip.durationTick > 0);

    return {
        fps,
        tracks: [
            { id: "video", kind: "video", clips: videoClips },
            { id: "audio", kind: "audio", clips: audioClips },
        ],
    };
}
