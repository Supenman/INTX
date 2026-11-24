import { useCallback, useSyncExternalStore, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { getDropLineY } from "./drop-target";
import type { TimelineTrack, DropTarget } from "@/lib/opencut/timeline";
import { TIMELINE_LAYERS } from "./layers";

interface DragLineProps {
	dropTarget: DropTarget | null;
	tracks: TimelineTrack[];
	isVisible: boolean;
	headerHeight?: number;
	getExtraHeight?: (index: number) => number;
	tracksScrollRef: RefObject<HTMLDivElement | null>;
	movingCount?: number;
}

export function DragLine({
	dropTarget,
	tracks,
	isVisible,
	headerHeight = 0,
	getExtraHeight,
	tracksScrollRef,
	movingCount,
}: DragLineProps) {
	const { t } = useTranslation();
	const subscribe = useCallback((notify: () => void) => {
		const scroll = tracksScrollRef.current;
		if (!scroll || !isVisible) return () => {};
		scroll.addEventListener("scroll", notify, { passive: true });
		return () => scroll.removeEventListener("scroll", notify);
	}, [tracksScrollRef, isVisible]);
	const scrollTop = useSyncExternalStore(subscribe, () => tracksScrollRef.current?.scrollTop ?? 0, () => 0);
	if (!isVisible || !dropTarget) return null;

	const y = getDropLineY({ dropTarget, tracks, getExtraHeight });
	const lineTop = y + headerHeight - scrollTop;
	if (lineTop < headerHeight) return null;
	const track = tracks[dropTarget.trackIndex];
	const targetLabel = dropTarget.isNewTrack ? t("editingStudio.timeline.newTrack") : track?.name || t("editingStudio.timeline.thisTrack");

	return (
		<div
			className="bg-primary pointer-events-none absolute right-0 left-0 h-0.5"
			style={{ top: `${lineTop}px`, zIndex: TIMELINE_LAYERS.dragLine }}
		>
			<span className="absolute right-2 top-0 max-w-[80%] truncate rounded-b bg-primary px-2 py-0.5 text-xs text-primary-foreground">
				{targetLabel}{movingCount && movingCount > 1 ? ` · ${t("editingStudio.timeline.clips", { count: movingCount })}` : ""}
			</span>
		</div>
	);
}
