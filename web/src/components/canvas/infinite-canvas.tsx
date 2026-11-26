import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Image as ImageIcon, Music2, Upload, Video } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ViewportTransform } from "@/types/canvas";
import { CanvasEmptyState } from "./canvas-empty-state";

type InfiniteCanvasProps = {
    containerRef: React.RefObject<HTMLDivElement | null>;
    viewport: ViewportTransform;
    tool: "select" | "pan";
    backgroundMode?: CanvasBackgroundMode;
    onViewportChange: (viewport: ViewportTransform) => void;
    onCanvasPointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
    /** 第二根手指落下时中断进行中的框选/节点拖动/连线，交给双指缩放手势。 */
    onGestureInterrupt?: () => void;
    onCanvasDeselect?: () => void;
    onCanvasDoubleClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
    onContextMenu?: (event: React.MouseEvent) => void;
    onDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
    /** 传入时，空画布会显示由 domain 纯函数决定的起始态提示。 */
    emptyNodeCount?: number;
    children: React.ReactNode;
};

export function InfiniteCanvas({ containerRef, viewport, tool, backgroundMode = "lines", emptyNodeCount, onViewportChange, onCanvasPointerDown, onGestureInterrupt, onCanvasDeselect, onCanvasDoubleClick, onContextMenu, onDrop, children }: InfiniteCanvasProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    const dragDepthRef = useRef(0);
    const [isFileDragging, setIsFileDragging] = useState(false);
    useEffect(() => {
        const reset = () => { dragDepthRef.current = 0; setIsFileDragging(false); };
        window.addEventListener("blur", reset);
        return () => window.removeEventListener("blur", reset);
    }, []);
    const panState = useRef({
        isPanning: false,
        pointerId: -1,
        startX: 0,
        startY: 0,
        initialX: 0,
        initialY: 0,
        hasMoved: false,
        startedOnBackground: false,
    });
    // 触摸双指缩放：记录每根手指，第二根落下即进入 pinch，剩余一指抬起后接续平移。
    const touchPointsRef = useRef(new Map<number, { x: number; y: number }>());
    const pinchRef = useRef<{
        pointerIds: [number, number];
        startDistance: number;
        anchorWorldX: number;
        anchorWorldY: number;
        startViewport: ViewportTransform;
    } | null>(null);
    const viewportRef = useRef(viewport);
    const frameRef = useRef<number | null>(null);
    const nextViewportRef = useRef<ViewportTransform | null>(null);
    const [isSpacePressed, setIsSpacePressed] = useState(false);
    const [isPanning, setIsPanning] = useState(false);

    useLayoutEffect(() => {
        viewportRef.current = viewport;
    }, [viewport]);

    useEffect(
        () => () => {
            if (frameRef.current) cancelAnimationFrame(frameRef.current);
        },
        [],
    );

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.code !== "Space") return;
            const target = event.target instanceof Element ? event.target : null;
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || target?.closest("button,[contenteditable='true']")) return;
            event.preventDefault();
            setIsSpacePressed(true);
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.code === "Space") {
                const target = event.target instanceof Element ? event.target : null;
                if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || target?.closest("button,[contenteditable='true']"))) event.preventDefault();
                setIsSpacePressed(false);
            }
        };

        const handleBlur = () => {
            setIsSpacePressed(false);
            panState.current.isPanning = false;
            panState.current.pointerId = -1;
            touchPointsRef.current.clear();
            pinchRef.current = null;
            setIsPanning(false);
            document.body.style.cursor = "";
        };

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        window.addEventListener("blur", handleBlur);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
            window.removeEventListener("blur", handleBlur);
        };
    }, []);

    const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-canvas-no-zoom],.ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown")) return;

        if (panState.current.isPanning) return;
        const current = viewportRef.current;
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
        const dx = event.deltaX * unit;
        const dy = event.deltaY * unit;
        const zoomModifier = event.ctrlKey || event.metaKey;
        let next: ViewportTransform;

        if (!zoomModifier && (event.shiftKey || Math.abs(dx) > Math.abs(dy))) {
            const shiftToHorizontal = event.shiftKey && dx === 0;
            next = {
                x: current.x - (shiftToHorizontal ? dy : dx),
                y: current.y - (shiftToHorizontal ? 0 : dy),
                k: current.k,
            };
        } else {
            const newScale = Math.min(Math.max(current.k * Math.pow(1.1, -dy / 100), 0.05), 5);
            if (newScale === current.k) return;
            const mouseX = event.clientX - rect.left;
            const mouseY = event.clientY - rect.top;
            const ratio = newScale / current.k;
            next = {
                x: mouseX - (mouseX - current.x) * ratio,
                y: mouseY - (mouseY - current.y) * ratio,
                k: newScale,
            };
        }
        // Rapid wheel events can arrive before React renders the previous update.
        viewportRef.current = next;
        onViewportChange(next);
    };

    const beginPinch = () => {
        const points = touchPointsRef.current;
        const ids = [...points.keys()];
        const a = points.get(ids[0]);
        const b = points.get(ids[1]);
        const rect = containerRef.current?.getBoundingClientRect();
        if (!a || !b || !rect) return;
        const current = viewportRef.current;
        const midX = (a.x + b.x) / 2 - rect.left;
        const midY = (a.y + b.y) / 2 - rect.top;
        pinchRef.current = {
            pointerIds: [ids[0], ids[1]],
            startDistance: Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1),
            anchorWorldX: (midX - current.x) / current.k,
            anchorWorldY: (midY - current.y) / current.k,
            startViewport: current,
        };
        // 双指落下即接管：停掉可能已开始的单指平移，并把框选/节点拖动/连线交还调用方回滚。
        panState.current.isPanning = false;
        panState.current.pointerId = -1;
        setIsPanning(false);
        document.body.style.cursor = "";
        onGestureInterrupt?.();
    };

    const applyPinch = (pinch: NonNullable<typeof pinchRef.current>, a: { x: number; y: number }, b: { x: number; y: number }) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const distance = Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1);
        const newScale = Math.min(Math.max(pinch.startViewport.k * (distance / pinch.startDistance), 0.05), 5);
        const midX = (a.x + b.x) / 2 - rect.left;
        const midY = (a.y + b.y) / 2 - rect.top;
        nextViewportRef.current = {
            x: midX - pinch.anchorWorldX * newScale,
            y: midY - pinch.anchorWorldY * newScale,
            k: newScale,
        };
        if (frameRef.current) return;
        frameRef.current = requestAnimationFrame(() => {
            frameRef.current = null;
            if (nextViewportRef.current) onViewportChange(nextViewportRef.current);
        });
    };

    const handlePointerDownCapture = (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.pointerType !== "touch") return;
        const target = event.target instanceof Element ? event.target : null;
        // 输入类控件保留原生单指滚动；双指落在里面也不接管。
        if (target?.closest("[data-canvas-no-zoom],input,textarea,[contenteditable='true']")) return;
        touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (touchPointsRef.current.size < 2) return;
        // 第二根手指不再启动节点拖动/框选/连线，统一交给双指缩放。
        event.stopPropagation();
        event.preventDefault();
        if (!pinchRef.current) beginPinch();
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-canvas-no-zoom]")) return;
        if (target?.closest("[data-connection-create-menu]")) return;
        const isBackgroundClick = !target?.closest("[data-node-id],[data-connection-id]");
        // 空格才是临时抓手；Ctrl 留给框选的 toggle（否则 Ctrl+拖动会被这里判成平移，框选策略永远进不去）。
        const temporaryTool = isSpacePressed;
        const activeTool = temporaryTool ? (tool === "select" ? "pan" : "select") : tool;
        const shouldPan = event.button === 1 || (event.button === 0 && activeTool === "pan" && isBackgroundClick);

        if (shouldPan) {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            panState.current = {
                isPanning: true,
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                initialX: viewport.x,
                initialY: viewport.y,
                hasMoved: false,
                startedOnBackground: isBackgroundClick,
            };
            setIsPanning(true);
            document.body.style.cursor = "grabbing";
            return;
        }

        if (event.button === 0 && isBackgroundClick) {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            onCanvasPointerDown?.(event);
        }
    };

    const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-canvas-no-zoom],[data-node-id],[data-connection-id]")) return;
        onCanvasDoubleClick?.(event);
    };

    useEffect(() => {
        const handlePointerMove = (event: PointerEvent) => {
            const touchPoints = touchPointsRef.current;
            if (touchPoints.has(event.pointerId)) touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
            const pinch = pinchRef.current;
            if (pinch && (event.pointerId === pinch.pointerIds[0] || event.pointerId === pinch.pointerIds[1])) {
                const a = touchPoints.get(pinch.pointerIds[0]);
                const b = touchPoints.get(pinch.pointerIds[1]);
                if (a && b) applyPinch(pinch, a, b);
                return;
            }

            if (!panState.current.isPanning || panState.current.pointerId !== event.pointerId) return;

            const dx = event.clientX - panState.current.startX;
            const dy = event.clientY - panState.current.startY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                panState.current.hasMoved = true;
            }

            nextViewportRef.current = {
                x: panState.current.initialX + dx,
                y: panState.current.initialY + dy,
                k: viewportRef.current.k,
            };
            if (frameRef.current) return;
            frameRef.current = requestAnimationFrame(() => {
                frameRef.current = null;
                if (nextViewportRef.current) onViewportChange(nextViewportRef.current);
            });
        };

        const handlePointerEnd = (event: PointerEvent) => {
            const wasTracked = touchPointsRef.current.delete(event.pointerId);
            const pinch = pinchRef.current;
            if (wasTracked && pinch && (event.pointerId === pinch.pointerIds[0] || event.pointerId === pinch.pointerIds[1])) {
                pinchRef.current = null;
                const remainingId = pinch.pointerIds[0] === event.pointerId ? pinch.pointerIds[1] : pinch.pointerIds[0];
                const remaining = touchPointsRef.current.get(remainingId);
                // 双指缩放结束后，剩余那根手指继续拖动就是平移；不触发空白点击取消选择。
                if (remaining && event.type === "pointerup") {
                    panState.current = {
                        isPanning: true,
                        pointerId: remainingId,
                        startX: remaining.x,
                        startY: remaining.y,
                        initialX: viewportRef.current.x,
                        initialY: viewportRef.current.y,
                        hasMoved: true,
                        startedOnBackground: false,
                    };
                    setIsPanning(true);
                    document.body.style.cursor = "grabbing";
                }
                return;
            }

            if (!panState.current.isPanning || panState.current.pointerId !== event.pointerId) return;

            if (event.type === "pointerup" && !panState.current.hasMoved && panState.current.startedOnBackground) {
                onCanvasDeselect?.();
            }
            panState.current.isPanning = false;
            panState.current.pointerId = -1;
            setIsPanning(false);
            document.body.style.cursor = "";
        };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerEnd);
        window.addEventListener("pointercancel", handlePointerEnd);
        return () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerEnd);
            window.removeEventListener("pointercancel", handlePointerEnd);
            document.body.style.cursor = "";
        };
    }, [onCanvasDeselect, onViewportChange]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        // Prevent canvas scrolling from moving the page while preserving native scrolling inside overlays and dialogs.
        const preventWheelScroll = (event: WheelEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (target?.closest("[data-canvas-no-zoom],.ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown")) return;
            event.preventDefault();
        };
        container.addEventListener("wheel", preventWheelScroll, { passive: false });
        return () => container.removeEventListener("wheel", preventWheelScroll);
    }, [containerRef]);

    const temporaryTool = isSpacePressed;
    const activeTool = temporaryTool ? (tool === "select" ? "pan" : "select") : tool;
    const cursor = isPanning ? "grabbing" : activeTool === "pan" ? "grab" : undefined;

    return (
        <div
            ref={containerRef}
            tabIndex={-1}
            data-canvas-root
            className="relative h-full w-full touch-none select-none overflow-hidden"
            style={{ background: theme.canvas.background, cursor }}
            onPointerDownCapture={handlePointerDownCapture}
            onPointerDown={handlePointerDown}
            onDoubleClick={handleDoubleClick}
            onWheel={handleWheel}
            onContextMenu={onContextMenu}
            onDragEnter={(event) => {
                if (!Array.from(event.dataTransfer.types).includes("Files")) return;
                event.preventDefault();
                dragDepthRef.current += 1;
                setIsFileDragging(true);
            }}
            onDragOver={(event) => {
                if (Array.from(event.dataTransfer.types).includes("Files")) event.dataTransfer.dropEffect = "copy";
                event.preventDefault();
            }}
            onDragLeave={(event) => {
                if (!Array.from(event.dataTransfer.types).includes("Files")) return;
                dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
                if (dragDepthRef.current === 0) setIsFileDragging(false);
            }}
            onDrop={(event) => { dragDepthRef.current = 0; setIsFileDragging(false); onDrop?.(event); }}
        >
            <CanvasGrid viewport={viewport} mode={backgroundMode} />
            {emptyNodeCount !== undefined ? <CanvasEmptyState nodeCount={emptyNodeCount} demoMode={false} starterMode="freeform" /> : null}
            {isFileDragging ? <div data-canvas-file-drop-overlay aria-live="polite" className="pointer-events-none absolute inset-4 z-[85] grid place-items-center rounded-2xl border-2 border-dashed backdrop-blur-sm" style={{ background: `color-mix(in srgb, ${theme.toolbar.panel} 82%, transparent)`, borderColor: theme.node.activeStroke, color: theme.node.text }}><div className="flex flex-col items-center gap-3 px-6 py-5 text-center"><span className="grid size-12 place-items-center rounded-2xl border shadow-sm" style={{ background: theme.node.panel, borderColor: theme.toolbar.border, color: theme.node.activeStroke }}><Upload className="size-5" aria-hidden /></span><div className="text-base font-semibold">{t("canvas.shortcut.dropMedia")}</div><div className="flex items-center gap-2 text-xs" style={{ color: theme.node.muted }}><span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1" style={{ borderColor: theme.toolbar.border, background: theme.node.panel }}><ImageIcon className="size-3.5" aria-hidden />{t("assets.kinds.image")}</span><span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1" style={{ borderColor: theme.toolbar.border, background: theme.node.panel }}><Video className="size-3.5" aria-hidden />{t("assets.kinds.video")}</span><span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1" style={{ borderColor: theme.toolbar.border, background: theme.node.panel }}><Music2 className="size-3.5" aria-hidden />{t("assets.kinds.audio")}</span></div></div></div> : null}
            <div
                className="absolute origin-top-left"
                style={{
                    transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.k})`,
                }}
            >
                {children}
            </div>
        </div>
    );
}

function CanvasGrid({ viewport, mode }: { viewport: ViewportTransform; mode: CanvasBackgroundMode }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    if (mode === "blank") return null;

    const gridSize = 48 * viewport.k;
    const x = viewport.x % gridSize;
    const y = viewport.y % gridSize;
    const dotSize = viewport.k < 0.12 ? 0.8 : 1.15;
    const backgroundImage =
        mode === "dots" ? `radial-gradient(circle, ${theme.canvas.dot} ${dotSize}px, transparent ${dotSize + 0.2}px)` : `linear-gradient(${theme.canvas.line} 1px, transparent 1px), linear-gradient(90deg, ${theme.canvas.line} 1px, transparent 1px)`;

    return (
        <div
            className="pointer-events-none absolute inset-0 opacity-40"
            style={{
                backgroundImage,
                backgroundSize: `${gridSize}px ${gridSize}px`,
                backgroundPosition: `${x}px ${y}px`,
            }}
        />
    );
}
