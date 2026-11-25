import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { AlertCircle, ChevronRight, Copy, Download, FileText, Group, Image as ImageIcon, Lock, Music2, Pencil, Play, Plus, Puzzle, RefreshCw, Star, Trash2, Video } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { colorGradeFilter } from "@/lib/canvas/color-grade";
import { isBrokenVideoContent } from "@/lib/media-blob";
import { hasResumableImageTask, hasResumableVideoTask } from "@/lib/canvas/canvas-generation-helpers";
import { formatBytes } from "@/lib/image-utils";
import { pickImageSource } from "@/lib/image-thumbnail";
import { previewUrlFor, subscribeImagePreviews, getImagePreviewRevision } from "@/services/image-storage";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { buildNodeContext } from "@/lib/canvas/plugin-node-context";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasResourceMentionTextarea } from "./canvas-resource-mention-textarea";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeImage, type CanvasNodeText, type Position } from "@/types/canvas";
import type { CanvasNodeContext, CanvasPluginHost } from "@/types/canvas-plugin";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { useTranslation } from "react-i18next";

type ResizeCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
const selectionBlue = "#2f80ff";
const nodeTitleIcons: Partial<Record<CanvasNodeData["type"], typeof ImageIcon>> = { [CanvasNodeType.Image]: ImageIcon, [CanvasNodeType.Video]: Video, [CanvasNodeType.Text]: FileText, [CanvasNodeType.Audio]: Music2, [CanvasNodeType.Group]: Group };

type CanvasNodeProps = {
    data: CanvasNodeData;
    scale: number;
    isSelected: boolean;
    isDragging?: boolean;
    isRelated: boolean;
    isFocusRelated: boolean;
    isConnectionTarget: boolean;
    isConnecting: boolean;
    referenceSelectionState?: "target" | "disabled" | "available";
    showPanel: boolean;
    showImageInfo: boolean;
    mentionReferences?: CanvasResourceReference[];
    pluginHost?: CanvasPluginHost;
    registryVersion?: number;
    renderPanel?: (node: CanvasNodeData) => ReactNode;
    groupChildCount?: number;
    isGroupDropTarget?: boolean;
    batchExpanded?: boolean;
    /** 在时间线视频轨中的镜头序号（从 1 开始）；不在时间线上时为 undefined。 */
    /** 时间线播放头正命中该镜头时，画布上高亮显示。 */
    onOpenVersions?: (node: CanvasNodeData) => void;
    onMouseDown: (event: React.MouseEvent, nodeId: string) => void;
    onSelectCapture?: (event: React.MouseEvent, nodeId: string) => void;
    onHoverStart: (nodeId: string) => void;
    onHoverEnd: (nodeId: string) => void;
    onConnectStart: (event: React.MouseEvent, nodeId: string, handleType: "source" | "target") => void;
    onConnectQuickAdd: (nodeId: string, handleType: "source" | "target") => void;
    onResizeStart: (nodeId: string) => void;
    onResize: (nodeId: string, width: number, height: number, position?: Position) => void;
    onResizeEnd: (nodeId: string) => void;
    onContentChange: (nodeId: string, content: string) => void;
    onTitleChange: (nodeId: string, title: string) => void;
    onToggleBatch?: (nodeId: string) => void;
    onSetBatchPrimary?: (nodeId: string, itemId: string) => void;
    onDuplicateBatchImage?: (node: CanvasNodeData, imageId: string) => void;
    onDownloadBatchImage?: (node: CanvasNodeData, imageId: string) => void;
    onRetryBatchImage?: (node: CanvasNodeData, imageId: string) => void;
    onDeleteBatchImage?: (nodeId: string, imageId: string) => void;
    onRetry?: (node: CanvasNodeData) => void;
    onViewImage?: (node: CanvasNodeData, imageId?: string) => void;
    onSelectReference?: (nodeId: string) => void;
    onContextMenu: (event: React.MouseEvent, nodeId: string) => void;
};

type NodeContentRendererProps = {
    node: CanvasNodeData;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    isEditingContent: boolean;
    textareaRef: React.RefObject<HTMLTextAreaElement | null>;
    isBatchRoot: boolean;
    batchCount: number;
    batchExpanded: boolean;
    scale: number;
    pluginContext?: CanvasNodeContext | null;
    onContentChange: (nodeId: string, content: string) => void;
    onStopEditing: () => void;
    mentionReferences: CanvasResourceReference[];
    onRetry?: (node: CanvasNodeData) => void;
    onToggleBatch?: () => void;
    onSetBatchPrimary?: (itemId: string) => void;
    onDuplicateBatchImage?: (imageId: string) => void;
    onDownloadBatchImage?: (imageId: string) => void;
    onRetryBatchImage?: (imageId: string) => void;
    onDeleteBatchImage?: (imageId: string) => void;
    onViewBatchImage?: (imageId: string) => void;
    groupChildCount: number;
};

export const CanvasNode = React.memo(function CanvasNode({
    data,
    scale,
    isSelected,
    isDragging = false,
    isRelated,
    isFocusRelated,
    isConnectionTarget,
    isConnecting,
    referenceSelectionState,
    showPanel,
    showImageInfo,
    mentionReferences = [],
    pluginHost,
    renderPanel,
    groupChildCount = 0,
    isGroupDropTarget = false,
    batchExpanded = false,
    onOpenVersions,
    onMouseDown,
    onSelectCapture,
    onHoverStart,
    onHoverEnd,
    onConnectStart,
    onConnectQuickAdd,
    onResizeStart,
    onResize,
    onResizeEnd,
    onContentChange,
    onTitleChange,
    onToggleBatch,
    onSetBatchPrimary,
    onDuplicateBatchImage,
    onDownloadBatchImage,
    onRetryBatchImage,
    onDeleteBatchImage,
    onRetry,
    onViewImage,
    onSelectReference,
    onContextMenu,
}: CanvasNodeProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    const [hovered, setHovered] = useState(false);
    const definition = getNodeDefinition(data.type);
    const pluginContext = useMemo<CanvasNodeContext | null>(() => (pluginHost ? buildNodeContext(pluginHost, data, theme, scale, isSelected) : null), [pluginHost, data, theme, scale, isSelected]);
    const [isEditingContent, setIsEditingContent] = useState(false);
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState(data.title || "");
    const hasImageContent = data.type === CanvasNodeType.Image && Boolean(data.metadata?.content);
    const hasVideoContent = data.type === CanvasNodeType.Video && Boolean(data.metadata?.content);
    const hasAudioContent = data.type === CanvasNodeType.Audio && Boolean(data.metadata?.content);
    const isGroup = data.type === CanvasNodeType.Group;
    const batchCount = data.type === CanvasNodeType.Image ? data.metadata?.images?.length || 0 : data.type === CanvasNodeType.Text ? data.metadata?.texts?.length || 0 : 0;
    const isBatchRoot = batchCount > 1;
    // Nodes with the interaction/move toggle ignore content pointer events in move mode and allow interaction in interactive mode.
    // forceInteractive states such as editing stay interactive, as do empty nodes so their upload and generation actions remain usable.
    const supportsInteractionToggle = Boolean(definition?.interactionToggle);
    const forceInteractive = supportsInteractionToggle ? Boolean(definition?.forceInteractive?.(data)) : false;
    const contentInteractive = !supportsInteractionToggle || forceInteractive || !data.metadata?.content ? true : Boolean(data.metadata?.interactive);
    // Transparent nodes such as SVGs blend into the canvas while retaining outlines for selected or related states.
    const transparentBg = Boolean(definition?.transparentBackground);
    const isActive = isConnectionTarget || isSelected || isFocusRelated;
    const TitleIcon = nodeTitleIcons[data.type];
    const hasTitleIcon = Boolean(TitleIcon || definition?.icon);
    const expandedTitle = data.type !== CanvasNodeType.Image && (isActive || hovered || isEditingTitle);
    const titleHeaderWidth = expandedTitle ? Math.max(160, Math.min(320, data.width * scale)) : Math.min(240, Math.max(112, data.width * scale));
    const imageBorderColor = isActive ? theme.node.activeStroke : isRelated ? theme.node.muted : "transparent";
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const titleInputRef = useRef<HTMLInputElement>(null);
    const resizeRef = useRef({
        isResizing: false,
        corner: "bottom-right" as ResizeCorner,
        startX: 0,
        startY: 0,
        startLeft: 0,
        startTop: 0,
        startWidth: 0,
        startHeight: 0,
        scale: 1,
        keepRatio: false,
        ratio: 1,
    });

    useEffect(() => { setTitleDraft(data.title || ""); }, [data.title]);
    useEffect(() => {
        if (!isEditingTitle) return;
        titleInputRef.current?.focus();
        titleInputRef.current?.select();
    }, [isEditingTitle]);

    const finishTitleEditing = useCallback(() => {
        const title = titleDraft.trim() || data.title || t("canvas.node.untitled");
        setTitleDraft(title);
        setIsEditingTitle(false);
        if (title !== data.title) onTitleChange(data.id, title);
    }, [data.id, data.title, onTitleChange, t, titleDraft]);

    useEffect(() => {
        if (!isEditingTitle) return;
        const handleOutsidePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Node && titleInputRef.current?.contains(target)) return;
            finishTitleEditing();
        };
        window.addEventListener("pointerdown", handleOutsidePointerDown, true);
        return () => window.removeEventListener("pointerdown", handleOutsidePointerDown, true);
    }, [finishTitleEditing, isEditingTitle]);

    useEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;

        const handleWheel = (event: WheelEvent) => event.stopPropagation();
        textarea.addEventListener("wheel", handleWheel, { passive: false });
        return () => textarea.removeEventListener("wheel", handleWheel);
    }, [data.type, isEditingContent]);

    useEffect(() => {
        if (!isEditingContent) return;
        const textarea = textareaRef.current;
        textarea?.focus();
        textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
    }, [isEditingContent]);

    useEffect(() => {
        if (!isEditingContent) return;

        const handleOutsidePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (isEditingContent && textareaRef.current?.contains(target)) return;

            setIsEditingContent(false);
        };

        window.addEventListener("pointerdown", handleOutsidePointerDown, true);
        return () => window.removeEventListener("pointerdown", handleOutsidePointerDown, true);
    }, [isEditingContent]);

    const handleResizeMove = useCallback(
        (event: MouseEvent) => {
            if (!resizeRef.current.isResizing) return;

            const dx = (event.clientX - resizeRef.current.startX) / resizeRef.current.scale;
            const dy = (event.clientY - resizeRef.current.startY) / resizeRef.current.scale;
            const isMediaNode = data.type === CanvasNodeType.Image || data.type === CanvasNodeType.Video;
            const minWidth = isMediaNode ? 420 : 220;
            const minHeight = isMediaNode ? 236 : 160;
            const startRight = resizeRef.current.startLeft + resizeRef.current.startWidth;
            const startBottom = resizeRef.current.startTop + resizeRef.current.startHeight;
            const fromLeft = resizeRef.current.corner.includes("left");
            const fromTop = resizeRef.current.corner.includes("top");
            const rawWidth = Math.max(minWidth, resizeRef.current.startWidth + (fromLeft ? -dx : dx));
            const rawHeight = Math.max(minHeight, resizeRef.current.startHeight + (fromTop ? -dy : dy));
            let width = rawWidth;
            let height = rawHeight;
            if (resizeRef.current.keepRatio) {
                const ratio = resizeRef.current.ratio;
                if (Math.abs(dx) >= Math.abs(dy)) {
                    height = width / ratio;
                } else {
                    width = height * ratio;
                }
                if (height < minHeight) {
                    height = minHeight;
                    width = height * ratio;
                }
                if (width < minWidth) {
                    width = minWidth;
                    height = width / ratio;
                }
            }

            onResize(data.id, width, height, {
                x: fromLeft ? startRight - width : resizeRef.current.startLeft,
                y: fromTop ? startBottom - height : resizeRef.current.startTop,
            });
        },
        [data.id, data.type, onResize],
    );

    const handleResizeUp = useCallback((event?: Event) => {
        if (event instanceof MouseEvent && event.type === "mouseup" && event.button !== 0) return;
        if (!resizeRef.current.isResizing) return;
        resizeRef.current.isResizing = false;
        window.removeEventListener("mousemove", handleResizeMove);
        window.removeEventListener("mouseup", handleResizeUp);
        window.removeEventListener("blur", handleResizeUp);
        window.removeEventListener("pointercancel", handleResizeUp);
        onResizeEnd(data.id);
    }, [data.id, handleResizeMove, onResizeEnd]);

    const handleResizeMouseDown = (event: React.MouseEvent, corner: ResizeCorner) => {
        event.stopPropagation();
        if (event.button !== 0 || resizeRef.current.isResizing) return;
        event.preventDefault();
        onResizeStart(data.id);
        resizeRef.current = {
            isResizing: true,
            corner,
            startX: event.clientX,
            startY: event.clientY,
            startLeft: data.position.x,
            startTop: data.position.y,
            startWidth: data.width,
            startHeight: data.height,
            scale,
            keepRatio: (data.type === CanvasNodeType.Image && !data.metadata?.freeResize) || data.type === CanvasNodeType.Video || Boolean(definition?.keepAspectRatio?.(data)),
            ratio: (data.metadata?.naturalWidth || data.width) / (data.metadata?.naturalHeight || data.height || 1),
        };
        window.addEventListener("mousemove", handleResizeMove);
        window.addEventListener("mouseup", handleResizeUp);
        window.addEventListener("blur", handleResizeUp);
        window.addEventListener("pointercancel", handleResizeUp);
    };

    useEffect(() => () => handleResizeUp(), [handleResizeUp]);

    return (
        <div
            data-node-id={data.id}
            className={`node-element group/node absolute flex select-none flex-col transition-shadow duration-200 ${isGroup ? "z-[5]" : isSelected ? "z-50" : "z-10"} ${isDragging ? "cursor-grabbing" : referenceSelectionState === "available" ? "cursor-pointer" : referenceSelectionState ? "cursor-not-allowed" : ""}`}
            style={{
                transform: `translate(${data.position.x}px, ${data.position.y}px)`,
                width: data.width,
                height: data.height,
                contain: "layout style",
            }}
            onMouseEnter={() => {
                setHovered(true);
                onHoverStart(data.id);
            }}
            onMouseLeave={() => {
                setHovered(false);
                onHoverEnd(data.id);
            }}
            onMouseDownCapture={(event) => {
                if (!referenceSelectionState && !(event.target instanceof Element && event.target.closest("[data-canvas-node-control]"))) onSelectCapture?.(event, data.id);
            }}
            onContextMenu={(event) => {
                if (referenceSelectionState) event.preventDefault();
                else onContextMenu(event, data.id);
            }}
        >
            {data.type !== CanvasNodeType.Image && data.metadata?.versionLabel && onOpenVersions ? <button type="button" data-version-badge={data.metadata.versionLabel} title={`${t("canvas.node.versionBadge", { label: data.metadata.versionLabel })}${data.metadata.versionPrimary ? ` · ${t("canvas.node.versionBadgePrimary")}` : ""} · ${t("canvas.node.openVersions")}`} className="absolute left-2 top-2 z-[66] rounded-full border px-2 py-1 text-xs font-medium shadow-sm" style={{ background: data.metadata.versionPrimary ? theme.toolbar.activeBg : theme.toolbar.panel, borderColor: data.metadata.versionPrimary ? theme.node.activeStroke : theme.toolbar.border, color: data.metadata.versionPrimary ? theme.node.activeStroke : theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onOpenVersions(data); }}>{data.metadata.versionLabel}</button> : null}
            {(!referenceSelectionState || referenceSelectionState === "target") && (hasTitleIcon || isSelected || hovered || isEditingTitle) && (
                <div data-canvas-node-control className="absolute bottom-full left-1 z-[65] mb-1" style={{ width: titleHeaderWidth, transform: `scale(${1 / Math.max(scale, 0.05)})`, transformOrigin: "left bottom" }} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                    {isEditingTitle ? (
                        <input
                            ref={titleInputRef}
                            value={titleDraft}
                            maxLength={64}
                            className="h-6 max-w-full border-0 border-b border-dashed bg-transparent px-0 text-left text-xs font-medium outline-none"
                            style={{ borderColor: theme.node.muted, color: theme.node.text }}
                            onChange={(event) => setTitleDraft(event.target.value)}
                            onBlur={finishTitleEditing}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") finishTitleEditing();
                                if (event.key === "Escape") {
                                    setTitleDraft(data.title || "");
                                    setIsEditingTitle(false);
                                }
                            }}
                        />
                    ) : (
                        <button
                            type="button"
                            className="group/title flex max-w-full items-center gap-1.5 border-b border-dashed border-transparent text-left text-sm leading-5 motion-safe:transition-colors hover:border-current"
                            style={{ color: isActive || hovered ? theme.node.text : theme.node.muted }}
                            title={t("canvas.node.renameHint")}
                            onClick={(event) => {
                                event.stopPropagation();
                                if (data.type === CanvasNodeType.Image && event.detail !== 0 && !(event.target instanceof Element && event.target.closest(".canvas-node-title-edit-icon"))) return;
                                setIsEditingTitle(true);
                            }}
                            onDoubleClick={data.type === CanvasNodeType.Image ? (event) => { event.stopPropagation(); setIsEditingTitle(true); } : undefined}
                        >
                            {TitleIcon ? <TitleIcon aria-hidden className="size-3.5 shrink-0" /> : null}
                            {!TitleIcon && definition?.icon ? <span aria-hidden className="grid size-3.5 shrink-0 place-items-center [&_svg]:size-3.5">{definition.icon}</span> : null}
                            <span className={expandedTitle ? "min-w-0 flex-1 whitespace-normal wrap-break-word" : "min-w-0 flex-1 truncate"}>{data.title || t("canvas.node.untitled")}</span>
                            <Pencil aria-hidden className={`canvas-node-title-edit-icon size-3 shrink-0 group-focus-visible/title:opacity-100 group-hover/title:opacity-100 ${isSelected ? "opacity-60" : "opacity-0"}`} />
                        </button>
                    )}
                </div>
            )}

            <div
                className="relative h-full w-full overflow-visible rounded-[var(--r-lg)] border motion-safe:transition-[border-color,box-shadow] motion-safe:duration-150"
                style={{
                    background: isGroup ? "transparent" : hasImageContent || hasVideoContent || transparentBg ? "transparent" : theme.node.fill,
                    // 静止/媒体节点用透明描边占位：选中时只换颜色不换宽度，避免边界跳动。
                    borderColor: isGroup ? (isGroupDropTarget ? selectionBlue : isActive ? theme.node.activeStroke : theme.node.stroke) : hasImageContent ? imageBorderColor : isActive ? theme.node.activeStroke : isRelated ? theme.node.muted : transparentBg || (hasTitleIcon && !hovered) ? "transparent" : theme.node.stroke,
                    borderStyle: isGroup ? "dashed" : "solid",
                    boxShadow: isGroupDropTarget ? `0 0 0 2px ${selectionBlue}66, inset 0 0 0 999px ${selectionBlue}10` : isActive ? `0 0 0 1px ${theme.node.activeStroke}55, ${theme.node.hoverShadow}` : isRelated ? `0 0 0 1px ${theme.node.muted}55, ${theme.node.hoverShadow}` : hasImageContent || transparentBg ? undefined : theme.node.shadow,
                }}
                onMouseDown={(event) => {
                    if (!referenceSelectionState) onMouseDown(event, data.id);
                    else if (event.button === 0 && referenceSelectionState === "available") {
                        event.stopPropagation();
                        onSelectReference?.(data.id);
                    }
                }}
                onDoubleClick={(event) => {
                    if (referenceSelectionState) {
                        event.stopPropagation();
                        return;
                    }
                    if (definition?.onDoubleClick && pluginContext) {
                        if (definition.onDoubleClick(pluginContext)) event.stopPropagation();
                        return;
                    }
                    if (data.type === CanvasNodeType.Image && hasImageContent) {
                        event.stopPropagation();
                        onViewImage?.(data);
                        return;
                    }
                    if (data.type !== CanvasNodeType.Text) return;
                    event.stopPropagation();
                    setIsEditingContent(true);
                }}
            >
                <div
                    className={`relative flex h-full w-full items-center justify-center rounded-[inherit] ${isBatchRoot ? "overflow-visible" : "overflow-hidden"}`}
                    style={
                        {
                            background: isGroup ? "transparent" : hasImageContent || hasVideoContent || transparentBg ? "transparent" : theme.node.fill,
                            pointerEvents: contentInteractive ? undefined : "none",
                        } as React.CSSProperties
                    }
                >
                    <NodeContent
                        node={data}
                        theme={theme}
                        isEditingContent={isEditingContent}
                        textareaRef={textareaRef}
                        isBatchRoot={isBatchRoot}
                        batchCount={batchCount}
                        batchExpanded={batchExpanded}
                        scale={scale}
                        pluginContext={pluginContext}
                        mentionReferences={mentionReferences}
                        onContentChange={onContentChange}
                        onStopEditing={() => setIsEditingContent(false)}
                        onRetry={onRetry}
                        onToggleBatch={() => onToggleBatch?.(data.id)}
                        onSetBatchPrimary={(itemId) => onSetBatchPrimary?.(data.id, itemId)}
                        onDuplicateBatchImage={(imageId) => onDuplicateBatchImage?.(data, imageId)}
                        onDownloadBatchImage={(imageId) => onDownloadBatchImage?.(data, imageId)}
                        onRetryBatchImage={(imageId) => onRetryBatchImage?.(data, imageId)}
                        onDeleteBatchImage={(imageId) => onDeleteBatchImage?.(data.id, imageId)}
                        onViewBatchImage={(imageId) => onViewImage?.(data, imageId)}
                        groupChildCount={groupChildCount}
                    />
                </div>

                {showImageInfo && hasImageContent ? <ImageInfoBar node={data} /> : null}

                {!isGroup && !hasTitleIcon && !hasImageContent && !hasVideoContent && !hasAudioContent ? <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12" style={{ background: `linear-gradient(to top, ${theme.canvas.background}66, transparent)` }} /> : null}

                {referenceSelectionState && (referenceSelectionState !== "available" || hovered) ? (
                    <div className="pointer-events-none absolute inset-0 z-[60] grid place-items-center rounded-[inherit]" style={{ background: `color-mix(in srgb, ${theme.canvas.background} ${referenceSelectionState === "target" ? 78 : referenceSelectionState === "disabled" ? 60 : 34}%, transparent)`, boxShadow: referenceSelectionState === "available" ? `inset 0 0 0 2px ${selectionBlue}` : undefined }}>
                        {referenceSelectionState !== "disabled" ? <span className="rounded-lg px-3 py-2 text-sm font-medium shadow-sm" style={{ background: theme.toolbar.panel, color: theme.node.text }}>{t(referenceSelectionState === "target" ? "canvas.references.selecting" : "canvas.references.choose")}</span> : null}
                    </div>
                ) : null}

                {/* 锁定标记：手柄和拖动都没了，得让用户知道为什么，并能从右键解锁。 */}
                {data.metadata?.locked && !isGroup ? (
                    <div className="pointer-events-none absolute right-2 top-2 z-30 grid size-6 place-items-center rounded-[var(--r-sm)]" style={{ background: theme.toolbar.panel, color: theme.node.muted }}>
                        <Lock className="size-3.5" aria-hidden />
                        <span className="sr-only">{t("canvas.contextMenu.locked")}</span>
                    </div>
                ) : null}

                {!referenceSelectionState && !data.metadata?.locked && (isSelected || hovered) ? <>
                    <ResizeHandle corner="top-left" onMouseDown={handleResizeMouseDown} />
                    <ResizeHandle corner="top-right" onMouseDown={handleResizeMouseDown} />
                    <ResizeHandle corner="bottom-left" onMouseDown={handleResizeMouseDown} />
                    <ResizeHandle corner="bottom-right" onMouseDown={handleResizeMouseDown} />
                </> : null}
            </div>

            {!referenceSelectionState && !isGroup ? <ConnectionHandleDot side="left" scale={scale} visible={hovered || isSelected || isConnecting} onMouseDown={(event) => onConnectStart(event, data.id, "target")} onQuickAdd={() => onConnectQuickAdd(data.id, "target")} /> : null}
            {!referenceSelectionState && (definition?.hasSourceHandle ?? true) ? <ConnectionHandleDot side="right" scale={scale} visible={hovered || isSelected || isConnecting} onMouseDown={(event) => onConnectStart(event, data.id, "source")} onQuickAdd={() => onConnectQuickAdd(data.id, "source")} /> : null}

            {/* Counter-scale the panel so its on-screen size stays constant while the canvas zooms. */}
            {showPanel && !isGroup && renderPanel ? (
                <div className="pointer-events-none absolute left-1/2 top-full z-[70] w-[min(920px,calc(100vw-32px))] -translate-x-1/2 pt-4" data-node-panel={data.id}>
                    <div className="pointer-events-auto">{renderPanel(data)}</div>
                </div>
            ) : null}
        </div>
    );
});

function NodeContent(props: NodeContentRendererProps) {
    const { t } = useTranslation();
    if (props.isBatchRoot && props.node.type === CanvasNodeType.Image) return <ImageNodeContent {...props} />;
    if (props.node.type === CanvasNodeType.Text && props.node.metadata?.texts?.length && (props.node.metadata.status !== "error" || props.node.metadata.texts.some((text) => text.content))) return <TextContent {...props} />;
    const mediaType = [CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio].includes(props.node.type as CanvasNodeType) ? props.node.type as CanvasNodeType.Image | CanvasNodeType.Video | CanvasNodeType.Audio : null;
    const hasRetainedMedia = mediaType === CanvasNodeType.Image
        ? Boolean(props.node.metadata?.content || props.node.metadata?.images?.some((image) => image.content))
        : Boolean(mediaType && props.node.metadata?.content);
    if (props.node.metadata?.status === "error" && mediaType && hasRetainedMedia) {
        const Renderer = nodeContentRenderers[mediaType];
        return Renderer ? (
            <div className="relative h-full w-full">
                <Renderer {...props} />
                <div className="pointer-events-none absolute left-2 top-2 z-20 flex items-center gap-1 rounded-full px-2 py-0.5" style={{ background: "color-mix(in oklch, var(--destructive) 20%, transparent)", color: "var(--destructive)" }} role="status">
                    <AlertCircle aria-hidden className="size-3" />
                    <span className="text-[10px] font-medium leading-none">{t("canvas.node.failed")}</span>
                </div>
                <div className="absolute inset-x-3 bottom-3 z-30 rounded-xl border p-2.5 shadow-lg backdrop-blur-md" style={{ background: props.theme.toolbar.panel, borderColor: "var(--destructive)", color: props.theme.node.text }}>
                    <ErrorContent node={props.node} theme={props.theme} onRetry={props.onRetry} />
                </div>
            </div>
        ) : null;
    }
    if (props.node.metadata?.status === "loading") return <LoadingContent theme={props.theme} />;
    if (props.node.metadata?.status === "error") return <ErrorContent node={props.node} theme={props.theme} onRetry={props.onRetry} />;

    const Renderer = nodeContentRenderers[props.node.type as CanvasNodeType];
    if (Renderer) return <Renderer {...props} />;

    // Render plugin nodes with their registered renderer, or show the missing-plugin placeholder.
    const definition = getNodeDefinition(props.node.type);
    if (definition?.Content && props.pluginContext) {
        const PluginContent = definition.Content;
        return <PluginContent ctx={props.pluginContext} />;
    }
    return <MissingPluginContent theme={props.theme} type={props.node.type} />;
}

const nodeContentRenderers = {
    [CanvasNodeType.Text]: TextContent,
    [CanvasNodeType.Image]: ImageNodeContent,
    [CanvasNodeType.Video]: VideoNodeContent,
    [CanvasNodeType.Audio]: AudioNodeContent,
    [CanvasNodeType.Group]: GroupNodeContent,
} satisfies Record<CanvasNodeType, (props: NodeContentRendererProps) => ReactNode>;

function GroupNodeContent({ node, theme, groupChildCount }: NodeContentRendererProps) {
    const { t } = useTranslation();
    return (
        <div className="pointer-events-none flex h-full w-full p-3">
            <div className="flex h-7 max-w-full items-center gap-2 px-1 text-xs font-medium" style={{ color: theme.node.text }}>
                <Group className="size-3.5 shrink-0" style={{ color: theme.node.muted }} />
                <span className="truncate">{node.title || t("canvas.node.group")}</span>
                <span className="shrink-0 text-[11px] font-normal" style={{ color: theme.node.muted }}>
                    {t("canvas.node.nodeCount", { count: groupChildCount })}
                </span>
            </div>
        </div>
    );
}

function LoadingContent({ theme }: Pick<NodeContentRendererProps, "theme">) {
    const { t } = useTranslation();
    return (
        <div role="status" className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color: theme.node.activeStroke }}>
            <div aria-hidden className="size-8 rounded-full border-2 motion-safe:animate-spin" style={{ borderColor: theme.node.stroke, borderTopColor: theme.node.activeStroke }} />
            <span className="rounded-full border border-current px-2.5 py-0.5 text-xs">{t("canvas.node.generating")}</span>
        </div>
    );
}

function ErrorContent({ node, theme, onRetry }: Pick<NodeContentRendererProps, "node" | "theme" | "onRetry">) {
    const { t } = useTranslation();
    const canQueryTask = hasResumableImageTask(node) || hasResumableVideoTask(node);
    return (
        <div className="flex max-w-[260px] flex-col items-center gap-3 px-5 text-center">
            <div role="alert" className="text-xs leading-5 text-red-300">{node.metadata?.errorDetails || t("canvas.node.failed")}</div>
            {node.metadata?.retryBlocked && !canQueryTask ? (
                <span className="text-[11px] leading-4" style={{ color: theme.node.muted }}>
                    {t("canvas.node.retryBlockedHint")}
                </span>
            ) : (
                <button
                    type="button"
                    className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition hover:scale-[1.02]"
                    style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                    onClick={(event) => {
                        event.stopPropagation();
                        onRetry?.(node);
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                >
                    <RefreshCw className="size-3.5" />
                    {t(canQueryTask ? "canvas.nodeToolbar.queryVideoTask" : "canvas.node.retry")}
                </button>
            )}
        </div>
    );
}

function MissingPluginContent({ theme, type }: Pick<NodeContentRendererProps, "theme"> & { type: string }) {
    const { t } = useTranslation();
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center" style={{ color: theme.node.placeholder }}>
            <Puzzle className="size-7 opacity-40" />
            <span className="text-sm">{t("canvas.node.missingPlugin")}</span>
            <span className="text-[11px] opacity-70">{t("canvas.node.missingPluginDescription", { type })}</span>
        </div>
    );
}

function TextContent({ node, theme, isEditingContent, textareaRef, mentionReferences, batchExpanded, onContentChange, onStopEditing, onToggleBatch, onSetBatchPrimary }: NodeContentRendererProps) {
    const { t } = useTranslation();
    const fontSize = node.metadata?.fontSize || 14;
    const textStyle = { fontSize: `${fontSize}px`, lineHeight: `${Math.round(fontSize * 1.65)}px`, color: theme.node.text, boxSizing: "border-box" } as React.CSSProperties;
    const texts = node.metadata?.texts || [];
    const batchCount = texts.length;
    const isBatchRoot = batchCount > 1;
    const primaryTextId = node.metadata?.primaryTextId || texts[0]?.id;
    const primaryText = texts.find((text) => text.id === primaryTextId);
    const content = primaryText?.content || node.metadata?.content || "";
    const paddingClass = isBatchRoot ? "px-4 pb-4 pt-14" : "p-4";

    return (
        <BatchFrame batchCount={batchCount} batchExpanded={batchExpanded}>
            {batchExpanded
                ? texts
                      .filter((text) => text.id !== primaryTextId)
                      .map((text, index) => <ExpandedTextCard key={text.id} node={node} text={text} index={index} onSetPrimary={() => onSetBatchPrimary?.(text.id)} />)
                : null}
            <div className="flex h-full w-full flex-col overflow-hidden rounded-[var(--r-lg)]">
                {isEditingContent ? (
                    <CanvasResourceMentionTextarea
                        ref={textareaRef}
                        className={`thin-scrollbar block h-full w-full resize-none overflow-y-auto whitespace-pre-wrap break-words border-none bg-transparent m-0 font-mono outline-none select-text appearance-none ${paddingClass}`}
                        style={textStyle}
                        value={content}
                        references={mentionReferences}
                        highlightLabels={false}
                        onChange={(value) => onContentChange(node.id, value)}
                        onBlur={onStopEditing}
                        onKeyDown={(event) => {
                            if (event.key === "Escape") onStopEditing();
                        }}
                        onMouseDown={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                        onWheel={(event) => event.stopPropagation()}
                    />
                ) : content ? (
                    <div className={`thin-scrollbar block h-full w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent font-mono ${paddingClass}`} style={textStyle} onWheel={(event) => event.stopPropagation()}>
                        {content}
                    </div>
                ) : primaryText ? (
                    <TextSlotStatus text={primaryText} />
                ) : (
                    <div role="img" aria-label={t("canvas.node.editText")} className="flex h-full w-full flex-col overflow-hidden px-6 pb-4 pt-5" style={{ color: theme.node.text }}>
                        <div className="flex flex-1 items-center justify-center">
                            <div className="flex flex-col items-center gap-1.5 opacity-30 lg:-translate-y-8" aria-hidden>
                                {[0, 1, 2, 3].map((line) => <span key={line} className="h-1 w-14 rounded-full" style={{ background: theme.node.text }} />)}
                            </div>
                        </div>
                    </div>
                )}
            </div>
            {isBatchRoot ? (
                <button
                    type="button"
                    className="absolute right-2.5 top-2.5 z-30 flex h-8 items-center justify-center gap-1.5 rounded-full border px-3 text-xs font-semibold shadow-[0_6px_18px_rgba(15,23,42,.12)] backdrop-blur-md transition hover:scale-[1.02]"
                    style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.activeText }}
                    aria-label={batchExpanded ? t("canvas.node.textBatchExpanded") : t("canvas.node.textBatchCollapsed")}
                    onClick={(event) => {
                        event.stopPropagation();
                        onToggleBatch?.();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <span className="leading-none">{t("canvas.controls.texts", { count: batchCount })}</span>
                    <ChevronRight className={`size-3.5 opacity-80 transition-transform ${batchExpanded ? "rotate-90" : ""}`} />
                </button>
            ) : null}
        </BatchFrame>
    );
}

function ExpandedTextCard({ node, text, index, onSetPrimary }: { node: CanvasNodeData; text: CanvasNodeText; index: number; onSetPrimary: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    const count = node.metadata?.texts?.length || 0;
    const columns = Math.min(count, 4);
    const rows = Math.ceil(count / columns);
    const rootSlot = (rows - 1) * columns;
    const slot = index >= rootSlot ? index + 1 : index;
    const x = (slot % columns) * (node.width + 18);
    const y = (Math.floor(slot / columns) - rows + 1) * (node.height + 18);

    return (
        <div
            className="absolute z-20 overflow-hidden rounded-[var(--r-lg)] border shadow-[var(--shadow-lg)]"
            style={
                {
                    left: x,
                    top: y,
                    width: node.width,
                    height: node.height,
                    background: theme.node.panel,
                    borderColor: theme.node.stroke,
                    "--batch-from-x": `${-x}px`,
                    "--batch-from-y": `${-y}px`,
                    "--batch-from-rotate": `${4 + index * 2}deg`,
                    animation: `canvas-batch-child-in 320ms ${index * 35}ms cubic-bezier(.2,.85,.18,1) both`,
                } as React.CSSProperties
            }
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            {text.content ? (
                <>
                    <div className="thin-scrollbar h-full overflow-y-auto whitespace-pre-wrap break-words px-4 pb-4 pt-14 font-mono text-sm leading-6" style={{ color: theme.node.text }} onWheel={(event) => event.stopPropagation()}>
                        {text.content}
                    </div>
                    <button type="button" className="pointer-events-none absolute right-2.5 top-2.5 flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium opacity-0 transition duration-150 hover:bg-black/5 group-hover/node:pointer-events-auto group-hover/node:opacity-100 dark:hover:bg-white/10" style={{ color: theme.node.text }} onClick={(event) => (event.stopPropagation(), onSetPrimary())}>
                        <Star className="size-3.5" style={{ color: selectionBlue }} />
                        {t("canvas.node.setPrimaryText")}
                    </button>
                </>
            ) : (
                <TextSlotStatus text={text} />
            )}
        </div>
    );
}

function TextSlotStatus({ text }: { text: CanvasNodeText }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    const failed = text.status === "error";
    const loading = text.status === "loading";
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center" style={{ background: theme.node.fill, color: failed ? theme.node.text : theme.node.activeStroke }}>
            {failed ? <span className="text-xs leading-5">{text.errorDetails || t("canvas.node.failed")}</span> : loading ? <div aria-hidden className="size-8 rounded-full border-2 motion-safe:animate-spin" style={{ borderColor: theme.node.stroke, borderTopColor: theme.node.activeStroke }} /> : <span className="text-xs">{t("apiErrors.noContent")}</span>}
            {loading ? <span className="text-[10px] tracking-[0.2em]">{t("canvas.node.generating")}</span> : null}
        </div>
    );
}

function ImageNodeContent(props: NodeContentRendererProps) {
    if (!props.node.metadata?.content && !props.isBatchRoot) return <EmptyImageContent {...props} />;

    return (
        <ImageContent
            node={props.node}
            batchExpanded={props.batchExpanded}
            scale={props.scale}
            onToggleBatch={props.onToggleBatch}
            onSetBatchPrimary={props.onSetBatchPrimary}
            onDuplicateBatchImage={props.onDuplicateBatchImage}
            onDownloadBatchImage={props.onDownloadBatchImage}
            onRetryBatchImage={props.onRetryBatchImage}
            onDeleteBatchImage={props.onDeleteBatchImage}
            onViewBatchImage={props.onViewBatchImage}
        />
    );
}

function EmptyImageContent({ theme }: NodeContentRendererProps) {
    const { t } = useTranslation();
    return (
        <div role="img" aria-label={t("canvas.node.emptyImage")} className="grid h-full w-full place-items-center" style={{ color: theme.node.muted }}>
            <ImageIcon aria-hidden className="size-14 opacity-30" strokeWidth={1.35} />
        </div>
    );
}

function VideoNodeContent({ node, theme }: NodeContentRendererProps) {
    const { t } = useTranslation();
    const [playbackFailed, setPlaybackFailed] = useState(false);
    useEffect(() => setPlaybackFailed(false), [node.metadata?.content]);
    const broken = isBrokenVideoContent(node.metadata);
    if (!node.metadata?.content && !broken) return (
        <div role="img" aria-label={t("canvas.node.emptyVideo")} className="grid h-full w-full place-items-center" style={{ color: theme.node.muted }}>
            <Play aria-hidden className="size-14 fill-current opacity-30" strokeWidth={1.2} />
        </div>
    );
    if (broken || playbackFailed)
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-4 text-center" style={{ color: theme.node.activeStroke }}>
                <Video className="size-7 opacity-60" />
                <span className="text-xs">{t("canvas.node.videoLoadFailed")}</span>
                {broken ? <span className="text-[10px] opacity-70">{t("canvas.node.videoRetryHint")}</span> : null}
            </div>
        );
    return <video src={node.metadata?.content} controls className="h-full w-full rounded-[var(--r-lg)] bg-black object-contain" style={{ filter: colorGradeFilter(node.metadata?.colorGrade) }} data-canvas-video={node.id} data-canvas-no-zoom onError={() => setPlaybackFailed(true)} />;
}

function AudioNodeContent({ node, theme }: NodeContentRendererProps) {
    const { t } = useTranslation();
    if (!node.metadata?.content)
        return (
            <div role="img" aria-label={t("canvas.node.emptyAudio")} className="grid h-full w-full place-items-center" style={{ color: theme.node.muted }}>
                <Music2 aria-hidden className="size-14 opacity-30" strokeWidth={1.25} />
            </div>
        );
    return (
        <div className="flex h-full w-full flex-col justify-center gap-3 px-4" style={{ background: theme.node.fill, color: theme.node.text }}>
            <div className="flex min-w-0 items-center gap-2 text-sm opacity-70">
                <Music2 className="size-4 shrink-0" />
                <span className="truncate">{t("canvas.node.audio")}</span>
            </div>
            <audio src={node.metadata.content} controls className="w-full" data-canvas-no-zoom />
        </div>
    );
}

function ImageContent({
    node,
    batchExpanded,
    scale,
    onToggleBatch,
    onSetBatchPrimary,
    onDuplicateBatchImage,
    onDownloadBatchImage,
    onRetryBatchImage,
    onDeleteBatchImage,
    onViewBatchImage,
}: {
    node: CanvasNodeData;
    batchExpanded: boolean;
    scale: number;
    onToggleBatch?: () => void;
    onSetBatchPrimary?: (imageId: string) => void;
    onDuplicateBatchImage?: (imageId: string) => void;
    onDownloadBatchImage?: (imageId: string) => void;
    onRetryBatchImage?: (imageId: string) => void;
    onDeleteBatchImage?: (imageId: string) => void;
    onViewBatchImage?: (imageId: string) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const images = node.metadata?.images || [];
    const batchCount = images.length;
    const isBatchRoot = batchCount > 1;
    const primaryImageId = node.metadata?.primaryImageId || images[0]?.id;
    const primaryImage = images.find((image) => image.id === primaryImageId);
    const primaryContent = primaryImage?.content || node.metadata?.content;
    const primaryPreviewUrl = previewUrlFor(primaryImage?.storageKey || node.metadata?.storageKey);
    const primarySource = primaryContent
        ? pickImageSource({
              previewUrl: primaryPreviewUrl,
              originalUrl: primaryContent,
              naturalWidth: primaryImage?.naturalWidth || node.metadata?.naturalWidth,
              naturalHeight: primaryImage?.naturalHeight || node.metadata?.naturalHeight,
              renderedWidth: node.width,
              renderedHeight: node.height,
              scale,
          })
        : undefined;

    return (
        <BatchFrame batchCount={batchCount} batchExpanded={batchExpanded}>
            {batchExpanded
                ? images
                      .filter((image) => image.id !== primaryImageId)
                      .map((image, index) => <ExpandedImageCard key={image.id} node={node} image={image} index={index} scale={scale} onView={() => onViewBatchImage?.(image.id)} onSetPrimary={() => onSetBatchPrimary?.(image.id)} onDuplicate={() => onDuplicateBatchImage?.(image.id)} onDownload={() => onDownloadBatchImage?.(image.id)} onRetry={() => onRetryBatchImage?.(image.id)} onDelete={() => onDeleteBatchImage?.(image.id)} />)
                : null}
            <div className="h-full w-full overflow-hidden rounded-[var(--r-lg)]">
                {primaryContent ? (
                    <img
                        src={primarySource}
                        alt={node.title}
                        draggable={false}
                        onDragStart={(event) => event.preventDefault()}
                        className={`pointer-events-none block h-full w-full select-none ${node.metadata?.freeResize ? "object-fill" : "object-contain"}`}
                        style={{ filter: colorGradeFilter(node.metadata?.colorGrade) }}
                    />
                ) : (
                    <ImageSlotStatus image={primaryImage} />
                )}
            </div>
            {primaryImage?.status === "error" ? <BatchImageFailureActions placement="left" onRetry={() => onRetryBatchImage?.(primaryImage.id)} onDelete={() => onDeleteBatchImage?.(primaryImage.id)} /> : null}
            {isBatchRoot ? (
                <button
                    type="button"
                    className="absolute right-2.5 top-2.5 z-30 flex h-8 items-center justify-center gap-1.5 rounded-full border px-3 text-xs font-semibold shadow-[0_6px_18px_rgba(15,23,42,.16)] backdrop-blur-md transition hover:scale-[1.02]"
                    style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.activeText }}
                    aria-label={batchExpanded ? t("canvas.node.batchExpanded") : t("canvas.node.batchCollapsed")}
                    onClick={(event) => {
                        event.stopPropagation();
                        onToggleBatch?.();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <span className="leading-none">{t("canvas.controls.images", { count: batchCount })}</span>
                    <ChevronRight className={`size-3.5 opacity-80 transition-transform ${batchExpanded ? "rotate-90" : ""}`} />
                </button>
            ) : null}
        </BatchFrame>
    );
}

function ExpandedImageCard({ node, image, index, scale, onView, onSetPrimary, onDuplicate, onDownload, onRetry, onDelete }: { node: CanvasNodeData; image: CanvasNodeImage; index: number; scale: number; onView: () => void; onSetPrimary: () => void; onDuplicate: () => void; onDownload: () => void; onRetry: () => void; onDelete: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const count = node.metadata?.images?.length || 0;
    const columns = Math.min(count, 4);
    const rows = Math.ceil(count / columns);
    const rootSlot = (rows - 1) * columns;
    const slot = index >= rootSlot ? index + 1 : index;
    const column = slot % columns;
    const row = Math.floor(slot / columns);
    const x = column * (node.width + 18);
    const y = (row - rows + 1) * (node.height + 18);
    const source = image.content
        ? pickImageSource({
              previewUrl: previewUrlFor(image.storageKey),
              originalUrl: image.content,
              naturalWidth: image.naturalWidth,
              naturalHeight: image.naturalHeight,
              renderedWidth: node.width,
              renderedHeight: node.height,
              scale,
          })
        : undefined;

    return (
        <div
            className={`absolute z-20 overflow-hidden rounded-[var(--r-lg)] ${image.content ? "" : "border shadow-[var(--shadow-lg)]"}`}
            style={
                {
                    left: x,
                    top: y,
                    width: node.width,
                    height: node.height,
                    background: "transparent",
                    borderColor: theme.node.stroke,
                    "--batch-from-x": `${-x}px`,
                    "--batch-from-y": `${-y}px`,
                    "--batch-from-rotate": `${4 + index * 2}deg`,
                    animation: `canvas-batch-child-in 320ms ${index * 35}ms cubic-bezier(.2,.85,.18,1) both`,
                } as React.CSSProperties
            }
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => {
                if (!image.content || (event.target instanceof Element && event.target.closest("button"))) return;
                event.stopPropagation();
                onView();
            }}
        >
            {image.content ? <img src={source} alt={node.title} draggable={false} className="pointer-events-none h-full w-full select-none object-contain" /> : <ImageSlotStatus image={image} />}
            {image.content ? (
                <div className="pointer-events-none absolute inset-x-2 top-2 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/node:pointer-events-auto group-hover/node:opacity-100">
                    <button type="button" className="flex h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg border px-1.5 text-[10px] font-medium shadow-[0_6px_18px_rgba(15,23,42,.16)] backdrop-blur-md transition hover:scale-[1.02]" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.activeText }} title={t("common.download")} onClick={(event) => (event.stopPropagation(), onDownload())}>
                        <Download className="size-3 shrink-0" />
                        <span className="truncate">{t("common.download")}</span>
                    </button>
                    <button type="button" className="flex h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg border px-1.5 text-[10px] font-medium shadow-[0_6px_18px_rgba(15,23,42,.16)] backdrop-blur-md transition hover:scale-[1.02]" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.activeText }} title={t("canvas.node.createCopy")} onClick={(event) => (event.stopPropagation(), onDuplicate())}>
                        <Copy className="size-3 shrink-0" />
                        <span className="truncate">{t("canvas.node.createCopy")}</span>
                    </button>
                    <button type="button" className="flex h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg border px-1.5 text-[10px] font-medium shadow-[0_6px_18px_rgba(15,23,42,.16)] backdrop-blur-md transition hover:scale-[1.02]" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.activeText }} title={t("canvas.node.setPrimary")} onClick={(event) => (event.stopPropagation(), onSetPrimary())}>
                        <Star className="size-3 shrink-0" style={{ color: selectionBlue }} />
                        <span className="truncate">{t("canvas.node.setPrimary")}</span>
                    </button>
                </div>
            ) : null}
            {image.status === "error" ? <BatchImageFailureActions placement="right" onRetry={onRetry} onDelete={onDelete} /> : null}
        </div>
    );
}

function BatchImageFailureActions({ placement, onRetry, onDelete }: { placement: "left" | "right"; onRetry: () => void; onDelete: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    return (
        <div className={`absolute top-3 z-30 flex items-center gap-1.5 ${placement === "left" ? "left-3" : "right-3"}`}>
            <button type="button" className="flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium shadow-sm transition hover:scale-[1.02]" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }} onClick={(event) => (event.stopPropagation(), onRetry())}>
                <RefreshCw className="size-3.5" />
                {t("canvas.node.retry")}
            </button>
            <button type="button" className="grid size-8 place-items-center rounded-lg border shadow-sm transition hover:scale-[1.02]" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }} onClick={(event) => (event.stopPropagation(), onDelete())} aria-label={t("common.delete")} title={t("common.delete")}>
                <Trash2 className="size-3.5" />
            </button>
        </div>
    );
}

function ImageSlotStatus({ image }: { image?: CanvasNodeImage }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    const failed = image?.status === "error";
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center" style={{ background: theme.node.fill, color: failed ? theme.node.text : theme.node.activeStroke }}>
            {failed ? <span className="text-xs leading-5">{image.errorDetails || t("canvas.node.failed")}</span> : <div aria-hidden className="size-8 rounded-full border-2 motion-safe:animate-spin" style={{ borderColor: theme.node.stroke, borderTopColor: theme.node.activeStroke }} />}
            {!failed ? <span className="text-[10px] tracking-[0.2em]">{t("canvas.node.generating")}</span> : null}
        </div>
    );
}

function ImageInfoBar({ node }: { node: CanvasNodeData }) {
    const width = Math.round(node.metadata?.naturalWidth || node.width);
    const height = Math.round(node.metadata?.naturalHeight || node.height);
    const size = formatBytes(node.metadata?.bytes || 0);
    return (
        <div className="pointer-events-none absolute bottom-3 right-3 z-40 max-w-[calc(100%-24px)]">
            <span className="max-w-full truncate rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium leading-none text-white backdrop-blur-sm">
                {width} x {height}
                {size ? ` · ${size}` : ""}
            </span>
        </div>
    );
}

function BatchFrame({ batchCount, batchExpanded, children }: { batchCount: number; batchExpanded: boolean; children: ReactNode }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const isBatchRoot = batchCount > 1;
    return (
        <div className="group/batch relative h-full w-full overflow-visible">
            {isBatchRoot ? (
                <div className="pointer-events-none absolute inset-0 overflow-visible">
                    {Array.from({ length: Math.min(batchCount - 1, 3) }).map((_, index) => (
                        <div
                            key={index}
                            className="absolute rounded-[inherit] border shadow-[0_10px_24px_rgba(68,64,60,.12)] transition-all duration-300 group-hover/batch:translate-x-1"
                            style={{
                                inset: 0,
                                background: `linear-gradient(135deg, ${theme.node.panel}, ${theme.node.fill})`,
                                borderColor: theme.node.stroke,
                                opacity: batchExpanded ? 0 : 1,
                                transform: `translate(${10 + index * 6}px, ${4 + index * 3}px) rotate(${1.5 + index}deg)`,
                                zIndex: -index - 1,
                            }}
                        />
                    ))}
                </div>
            ) : null}
            {children}
        </div>
    );
}
function ResizeHandle({ corner, onMouseDown }: { corner: ResizeCorner; onMouseDown: (event: React.MouseEvent, corner: ResizeCorner) => void }) {
    const positionClass = {
        "top-left": "-left-[14px] -top-[14px] cursor-nwse-resize",
        "top-right": "-right-[14px] -top-[14px] cursor-nesw-resize",
        "bottom-left": "-bottom-[14px] -left-[14px] cursor-nesw-resize",
        "bottom-right": "-bottom-[14px] -right-[14px] cursor-nwse-resize",
    }[corner];

    return <div className={`absolute z-50 size-7 ${positionClass}`} onMouseDown={(event) => onMouseDown(event, corner)} />;
}

function ConnectionHandleDot({ side, scale, visible, onMouseDown, onQuickAdd }: { side: "left" | "right"; scale: number; visible: boolean; onMouseDown: (event: React.MouseEvent) => void; onQuickAdd: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    const label = t(side === "left" ? "canvas.createMenu.beforeNode" : "canvas.createMenu.fromNode");
    const handleRef = useRef<HTMLSpanElement>(null);
    const [railHovered, setRailHovered] = useState(false);
    const inverseScale = 1 / Math.max(scale, 0.05);
    const railSize = 80;
    const handleSize = Math.max(20, 8 * inverseScale);
    const restingRailWidth = Math.max(28, Math.ceil(15 + handleSize / 2 + 3));
    const sideOffset = side === "left" ? 25 : -25;
    const resetHandle = () => {
        if (handleRef.current) handleRef.current.style.transform = `translate(${sideOffset}px, 0) scale(1)`;
    };
    const updateHandle = (event: React.MouseEvent<HTMLButtonElement>) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const followLimit = 30;
        const centerX = side === "left" ? bounds.right - railSize * scale / 2 : bounds.left + railSize * scale / 2;
        const deltaX = event.clientX - centerX;
        const deltaY = event.clientY - (bounds.top + bounds.height / 2);
        const limitedX = Math.max(-followLimit, Math.min(followLimit, deltaX));
        const limitedY = Math.max(-followLimit, Math.min(followLimit, deltaY));
        const offsetX = limitedX * inverseScale;
        const offsetY = limitedY * inverseScale;
        const focus = 1 + Math.max(0, 1 - Math.hypot(limitedX, limitedY) / followLimit) * 0.1;
        if (handleRef.current) handleRef.current.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${focus})`;
    };

    return (
        <button
            type="button"
            data-canvas-node-control
            data-canvas-connection-rail={side}
            className={`group/port absolute top-1/2 z-30 flex -translate-y-1/2 items-center justify-center rounded-full border-0 bg-transparent p-0 outline-none motion-safe:transition-[width,opacity] motion-safe:duration-150 ${visible || railHovered ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
            style={{ width: railHovered ? railSize : restingRailWidth, height: `min(100%, ${railSize}px)`, cursor: "crosshair", ...(side === "left" ? { right: "100%" } : { left: "100%" }) }}
            tabIndex={visible || railHovered ? 0 : -1}
            onMouseEnter={(event) => { setRailHovered(true); updateHandle(event); }}
            onMouseMove={updateHandle}
            onMouseLeave={() => { setRailHovered(false); resetHandle(); }}
            onMouseDown={onMouseDown}
            onClick={(event) => {
                if (event.detail === 0) onQuickAdd();
            }}
            onFocus={() => setRailHovered(true)}
            onBlur={() => { setRailHovered(false); resetHandle(); }}
            aria-label={label}
            title={label}
        >
            <span
                ref={handleRef}
                className="absolute top-1/2 block motion-safe:transition-transform motion-safe:duration-75 group-hover/port:brightness-125 group-focus-visible/port:brightness-125"
                style={{ display: visible || railHovered ? undefined : "none", left: side === "left" ? `calc(100% - ${railSize / 2}px)` : railSize / 2, width: handleSize, height: handleSize, marginLeft: -handleSize / 2, marginTop: -handleSize / 2, transform: `translate(${sideOffset}px, 0) scale(1)` }}
            >
                <span className="grid size-full place-items-center rounded-full border" style={{ background: theme.node.panel, borderColor: theme.node.activeStroke, color: theme.node.activeStroke }}>
                    <Plus aria-hidden className="size-3" />
                </span>
            </span>
        </button>
    );
}

/** 底部浮动工具条（缩放条与工具栏）占用的高度；提示词面板不许压在这个区间里。 */
const PANEL_BOTTOM_CLEARANCE = 88;
const PANEL_VIEWPORT_MARGIN = 12;
/** 输入框默认高度（对应 h-40 / 10rem）与最小高度（3 行文字 + 上下内边距）。 */
const PANEL_COMPOSER_NATURAL = 160;
const PANEL_COMPOSER_MIN = 76;

/**
 * 提示词面板默认挂在节点下方。窗口矮或节点靠下时，底部操作行会落到视口外，
 * 或被底部工具条盖住导致「生成」点不动。优先压输入框高度把面板收进可用区域，
 * 压到最小仍放不下才整块上移；顶到视口上沿就停住，不继续往外出。
 *
 * 高度用 CSS 变量传给输入框，位移量用 margin 加在外层缩放之内：外层已经把 `1 / scale` 抵消掉，
 * 这里 1px 就是屏幕上的 1px。
 */
function PanelViewportShift({ scale, top, children }: { scale: number; top: number; children: ReactNode }) {
    const ref = useRef<HTMLDivElement>(null);
    const offsetRef = useRef(0);
    const [offset, setOffset] = useState(0);
    const [composerHeight, setComposerHeight] = useState(PANEL_COMPOSER_NATURAL);

    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) return;
        const update = () => {
            const panel = element.querySelector("[data-canvas-prompt-panel]");
            const editor = panel?.querySelector('[role="textbox"]');
            if (!panel || !editor) {
                offsetRef.current = 0;
                setOffset(0);
                setComposerHeight(PANEL_COMPOSER_NATURAL);
                return;
            }
            const panelRect = panel.getBoundingClientRect();
            // 量到的是已经位移后的位置，减掉当前 margin 才是自然位置。
            const naturalTop = panelRect.top - offsetRef.current;
            const fixed = panelRect.height - editor.getBoundingClientRect().height;
            const room = window.innerHeight - PANEL_BOTTOM_CLEARANCE - naturalTop;
            const composer = Math.round(Math.max(PANEL_COMPOSER_MIN, Math.min(PANEL_COMPOSER_NATURAL, room - fixed)));
            const overflow = fixed + composer - room;
            const shift = overflow > 0 ? -overflow : 0;
            const next = Math.round(naturalTop + shift < PANEL_VIEWPORT_MARGIN ? PANEL_VIEWPORT_MARGIN - naturalTop : shift);
            offsetRef.current = next;
            setOffset(next);
            setComposerHeight(composer);
        };
        update();
        const observer = new ResizeObserver(update);
        observer.observe(element);
        window.addEventListener("resize", update);
        return () => {
            observer.disconnect();
            window.removeEventListener("resize", update);
        };
    }, [scale, top]);

    return (
        <div ref={ref} style={{ "--intx-panel-composer": `${composerHeight}px`, marginTop: offset } as React.CSSProperties}>
            {children}
        </div>
    );
}
