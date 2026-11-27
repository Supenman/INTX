import React, { useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";

import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import type { DragGuides } from "@/lib/canvas/canvas-drag-snap";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasConnection, CanvasNodeData, ConnectionHandle, Position, ViewportTransform } from "@/types/canvas";

function connectionCurve(startX: number, startY: number, endX: number, endY: number) {
    const curvature = Math.max(Math.abs(endX - startX) * 0.5, 50);
    return `M ${startX} ${startY} C ${startX + curvature} ${startY}, ${endX - curvature} ${endY}, ${endX} ${endY}`;
}

export const ConnectionPath = React.memo(function ConnectionPath({
    connection,
    from,
    to,
    active,
    onSelect,
    onContextMenu,
    onReconnectStart,
}: {
    connection: CanvasConnection;
    from: CanvasNodeData;
    to: CanvasNodeData;
    active: boolean;
    onSelect: () => void;
    onContextMenu?: (event: ReactMouseEvent<SVGPathElement>) => void;
    onReconnectStart?: (event: ReactPointerEvent<SVGCircleElement>, endpoint: "start" | "end") => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [hovered, setHovered] = useState(false);
    const startX = from.position.x + from.width;
    const startY = from.position.y + from.height / 2;
    const endX = to.position.x;
    const endY = to.position.y + to.height / 2;
    const pathD = connectionCurve(startX, startY, endX, endY);
    const highlighted = active || hovered;
    const strokeColor = highlighted ? theme.node.activeStroke : theme.node.muted;

    return (
        <g onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
            <path
                data-connection-id={connection.id}
                d={pathD}
                stroke="transparent"
                strokeWidth="16"
                vectorEffect="non-scaling-stroke"
                fill="none"
                style={{ cursor: "pointer", pointerEvents: "stroke" }}
                onClick={(event) => {
                    event.stopPropagation();
                    onSelect();
                }}
                onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onContextMenu?.(event);
                }}
            />
            <path
                d={pathD}
                stroke={strokeColor}
                strokeWidth={active ? 2.8 : hovered ? 2.2 : 1.5}
                vectorEffect="non-scaling-stroke"
                strokeOpacity={active ? 0.95 : hovered ? 0.85 : 0.62}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="motion-safe:transition-[stroke,stroke-width,stroke-opacity] motion-safe:duration-150"
                style={{ pointerEvents: "none" }}
            />
            {highlighted ? <path className="canvas-connection-halo" d={pathD} stroke={theme.node.activeStroke} strokeWidth={active ? 7 : 5} vectorEffect="non-scaling-stroke" strokeOpacity={active ? 0.18 : 0.12} fill="none" strokeLinecap="round" style={{ pointerEvents: "none" }} /> : null}
            {highlighted ? <path className="canvas-connection-flow" d={pathD} stroke={theme.node.activeStroke} strokeWidth={active ? 2.4 : 2} vectorEffect="non-scaling-stroke" strokeOpacity={active ? 0.92 : 0.72} strokeDasharray="10 18" fill="none" strokeLinecap="round" style={{ pointerEvents: "none" }} /> : null}
            <circle cx={startX} cy={startY} r={highlighted ? 3.5 : 2} fill={strokeColor} fillOpacity={highlighted ? 0.9 : 0.56} vectorEffect="non-scaling-stroke" style={{ pointerEvents: "none" }} />
            <circle cx={endX} cy={endY} r={highlighted ? 3.5 : 2} fill={strokeColor} fillOpacity={highlighted ? 0.9 : 0.56} vectorEffect="non-scaling-stroke" style={{ pointerEvents: "none" }} />
            {highlighted && onReconnectStart ? (
                <>
                    <circle cx={startX} cy={startY} r={10} fill="transparent" vectorEffect="non-scaling-stroke" style={{ cursor: "grab", pointerEvents: "all" }} onPointerDown={(event) => onReconnectStart(event, "start")} />
                    <circle cx={endX} cy={endY} r={10} fill="transparent" vectorEffect="non-scaling-stroke" style={{ cursor: "grab", pointerEvents: "all" }} onPointerDown={(event) => onReconnectStart(event, "end")} />
                </>
            ) : null}
            {highlighted ? <path d={`M ${endX - 9} ${endY - 4.5} L ${endX - 2} ${endY} L ${endX - 9} ${endY + 4.5}`} stroke={theme.node.activeStroke} strokeWidth={2} vectorEffect="non-scaling-stroke" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: "none" }} /> : null}
        </g>
    );
});

export function ActiveConnectionPath({ node, handle, mouseWorld, target }: { node?: CanvasNodeData; handle: ConnectionHandle; mouseWorld: Position; target?: CanvasNodeData }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    if (!node) return null;

    const startX = handle.handleType === "source" ? node.position.x + node.width : mouseWorld.x;
    const startY = handle.handleType === "source" ? node.position.y + node.height / 2 : mouseWorld.y;
    const endX = handle.handleType === "source" ? mouseWorld.x : node.position.x;
    const endY = handle.handleType === "source" ? mouseWorld.y : node.position.y + node.height / 2;
    const snappedStartX = handle.handleType === "target" && target ? target.position.x + target.width : startX;
    const snappedStartY = handle.handleType === "target" && target ? target.position.y + target.height / 2 : startY;
    const snappedEndX = handle.handleType === "source" && target ? target.position.x : endX;
    const snappedEndY = handle.handleType === "source" && target ? target.position.y + target.height / 2 : endY;
    const pathD = connectionCurve(snappedStartX, snappedStartY, snappedEndX, snappedEndY);

    const snapPortX = handle.handleType === "source" ? snappedEndX : snappedStartX;
    const snapPortY = handle.handleType === "source" ? snappedEndY : snappedStartY;
    return <g style={{ pointerEvents: "none" }}>{target ? <path d={pathD} stroke={theme.node.activeStroke} strokeWidth={7} vectorEffect="non-scaling-stroke" strokeOpacity={0.18} fill="none" strokeLinecap="round" /> : null}<path d={pathD} stroke={theme.node.activeStroke} strokeWidth={target ? 2.8 : 1.8} vectorEffect="non-scaling-stroke" fill="none" strokeDasharray={target ? undefined : "6 6"} className={target ? "motion-safe:transition-[stroke-width] motion-safe:duration-150" : "canvas-connection-flow motion-safe:transition-[stroke-width] motion-safe:duration-150"} />{target ? <circle cx={snapPortX} cy={snapPortY} r={6} fill={theme.node.activeStroke} fillOpacity={0.22} stroke={theme.node.activeStroke} strokeWidth={2} vectorEffect="non-scaling-stroke" /> : null}</g>;
}

/** 拖动吸附引导线。X、Y 同时吸附时补一个实心点，比两条虚线交叉更明确地表示「已经对上了」。 */
export function CanvasDragGuides({ guides, viewport, theme }: { guides: DragGuides; viewport: ViewportTransform; theme: CanvasTheme }) {
    if (guides.x === undefined && guides.y === undefined) return null;
    return (
        <svg aria-hidden className="pointer-events-none absolute inset-0 z-10 h-full w-full" stroke={theme.canvas.selectionStroke} strokeWidth={1.25} strokeDasharray="4 4">
            {guides.x !== undefined && <line x1={viewport.x + guides.x * viewport.k} x2={viewport.x + guides.x * viewport.k} y2="100%" />}
            {guides.y !== undefined && <line y1={viewport.y + guides.y * viewport.k} y2={viewport.y + guides.y * viewport.k} x2="100%" />}
            {guides.x !== undefined && guides.y !== undefined && <circle cx={viewport.x + guides.x * viewport.k} cy={viewport.y + guides.y * viewport.k} r={3.5} fill={theme.canvas.selectionStroke} stroke="none" />}
        </svg>
    );
}
