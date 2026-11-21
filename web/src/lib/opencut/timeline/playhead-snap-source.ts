import type { SnapPoint } from "@/lib/opencut/timeline/snapping";
import type { MediaTime } from "@/lib/opencut/wasm";

export function getPlayheadSnapPoints({
	playheadTime,
}: {
	playheadTime: MediaTime;
}): SnapPoint[] {
	return [{ time: playheadTime, type: "playhead" }];
}
