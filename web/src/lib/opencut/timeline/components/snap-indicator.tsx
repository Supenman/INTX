"use client";

import { useSnapIndicatorPosition } from "@/lib/opencut/timeline/hooks/use-snap-indicator-position";
import { useTranslation } from "react-i18next";
import type { SnapPoint } from "@/lib/opencut/timeline/snapping";
import {
	getCenteredLineLeft,
	TIMELINE_INDICATOR_LINE_WIDTH_PX,
} from "@/lib/opencut/timeline";
import { TIMELINE_LAYERS } from "./layers";
interface SnapIndicatorProps {
	snapPoint: SnapPoint | null;
	zoomLevel: number;
	isVisible: boolean;
	timelineRef: React.RefObject<HTMLDivElement | null>;
	tracksScrollRef: React.RefObject<HTMLDivElement | null>;
}

export function SnapIndicator({
	snapPoint,
	zoomLevel,
	isVisible,
	timelineRef,
	tracksScrollRef,
}: SnapIndicatorProps) {
	const { t } = useTranslation();
	const { leftPosition, topPosition, height } = useSnapIndicatorPosition({
		snapPoint,
		zoomLevel,
		timelineRef,
		tracksScrollRef,
	});

	if (!isVisible || !snapPoint) {
		return null;
	}

	return (
		<div
			className="pointer-events-none absolute"
			style={{
				left: `${getCenteredLineLeft({ centerPixel: leftPosition })}px`,
				top: topPosition,
				height: `${height}px`,
				width: `${TIMELINE_INDICATOR_LINE_WIDTH_PX}px`,
				zIndex: TIMELINE_LAYERS.snapIndicator,
			}}
		>
			<div className="bg-primary/65 h-full w-0.5" />
			<span className="absolute left-1 top-0 whitespace-nowrap rounded bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">
				{t(`editingStudio.timeline.snap.${snapPoint.type}`)}
			</span>
		</div>
	);
}
