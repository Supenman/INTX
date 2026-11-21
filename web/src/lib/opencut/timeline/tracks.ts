import type { TrackType } from "@/lib/opencut/timeline";

export const DEFAULT_TRACK_NAMES: Record<TrackType, string> = {
	video: "视频轨",
	text: "文字轨",
	audio: "音频轨",
	graphic: "Graphic track",
	effect: "Effect track",
} as const;
