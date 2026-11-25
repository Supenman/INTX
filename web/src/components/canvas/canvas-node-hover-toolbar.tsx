import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { App, Modal, Segmented, Tooltip } from "antd";
import { Download, Ellipsis, FolderPlus, Image as ImageIcon, Info, Layers, Minus, Music2, Plus, RefreshCw, SlidersHorizontal, Trash2, Ungroup, Upload, Video } from "lucide-react";
import { useTranslation } from "react-i18next";

import { resolveToolbarTools } from "@/domain";
import { canvasThemes } from "@/lib/canvas-theme";
import { isBrokenVideoContent } from "@/lib/media-blob";
import { getNodeDefinition, isBuiltinNodeType } from "@/lib/canvas/node-registry";
import { nodeToolbarHandler } from "@/lib/canvas/node-toolbar-actions";
import { buildToolContext } from "@/lib/canvas/tool-wiring";
import { formatBytes, getDataUrlByteSize } from "@/lib/image-utils";
import { useCopyText } from "@/hooks/use-copy-text";
import { useToolbarPrefs } from "@/hooks/use-toolbar-prefs";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData, type ViewportTransform } from "@/types/canvas";
import type { CanvasNodeToolbarItem } from "@/types/canvas-plugin";
import { ImageToolSettingsModal, type ImageToolbarSettingsTool } from "./canvas-image-toolbar-settings-modal";
import { IMAGE_QUICK_TOOLS_STORAGE_KEY, buildImageToolbarTools, defaultImageQuickToolIds, readImageQuickToolsConfig, type ImageQuickToolId } from "./canvas-image-toolbar-tools";

type CanvasNodeHoverToolbarProps = {
    node: CanvasNodeData | null;
    panelNodeId: string | null;
    viewport: ViewportTransform;
    onKeep: (nodeId: string) => void;
    onLeave: (nodeId: string) => void;
    onInfo: (node: CanvasNodeData) => void;
    onDecreaseFont: (node: CanvasNodeData) => void;
    onIncreaseFont: (node: CanvasNodeData) => void;
    onToggleDialog: (node: CanvasNodeData) => void;
    onGenerateImage: (node: CanvasNodeData) => void;
    onUpload: (node: CanvasNodeData) => void;
    onDownload: (node: CanvasNodeData) => void;
    onOpenVersions: (node: CanvasNodeData) => void;
    onSaveAsset: (node: CanvasNodeData) => void;
    onMaskEdit: (node: CanvasNodeData) => void;
    onCrop: (node: CanvasNodeData) => void;
    onSplit: (node: CanvasNodeData) => void;
    onUpscale: (node: CanvasNodeData) => void;
    onSuperResolve: (node: CanvasNodeData) => void;
    onAngle: (node: CanvasNodeData) => void;
    onPreset: (node: CanvasNodeData) => void;
    onViewImage: (node: CanvasNodeData) => void;
    onReversePrompt: (node: CanvasNodeData) => void;
    onRetry: (node: CanvasNodeData) => void;
    onToggleFreeResize: (node: CanvasNodeData) => void;
    onDuplicate: (node: CanvasNodeData) => void;
    onDelete: (node: CanvasNodeData) => void;
    onUngroup?: (node: CanvasNodeData) => void;
    extraTools?: CanvasNodeToolbarItem[];
};

/** 注册表条目的图标。domain 层不放 JSX，所以图标留在这里按 id 查。 */
const NODE_TOOL_ICON: Record<string, ReactNode> = {
    "node-info": <Info className="size-4" />,
    "node-duplicate": <Plus className="size-4" />,
    "node-delete": <Trash2 className="size-4" />,
};

type ToolbarTool = {
    id: string;
    title: string;
    label: string;
    /** 注册表不存图标（domain 不能 import JSX），图标按 id 在此处查；查不到就不渲染该条目。 */
    icon?: ReactNode;
    onClick: () => void;
    active?: boolean;
    danger?: boolean;
};

export function CanvasNodeHoverToolbar({
    node,
    panelNodeId,
    viewport,
    onKeep,
    onLeave,
    onInfo,
    onDecreaseFont,
    onIncreaseFont,
    onToggleDialog,
    onGenerateImage,
    onUpload,
    onDownload,
    onOpenVersions,
    onSaveAsset,
    onMaskEdit,
    onCrop,
    onSplit,
    onUpscale,
    onSuperResolve,
    onAngle,
    onPreset,
    onViewImage,
    onReversePrompt,
    onRetry,
    onToggleFreeResize,
    onDuplicate,
    onDelete,
    onUngroup,
    extraTools = [],
}: CanvasNodeHoverToolbarProps) {
    const [quickImageToolIds, setQuickImageToolIds] = useState<ImageQuickToolId[]>(defaultImageQuickToolIds);
    const [showImageToolLabels, setShowImageToolLabels] = useState(false);
    const [draftImageToolIds, setDraftImageToolIds] = useState<ImageQuickToolId[]>(defaultImageQuickToolIds);
    const [draftShowImageToolLabels, setDraftShowImageToolLabels] = useState(false);
    const [imageToolSettingsOpen, setImageToolSettingsOpen] = useState(false);
    const toolbarRef = useRef<HTMLDivElement>(null);
    const updatePlacementRef = useRef<() => void>(() => {});
    const { message } = App.useApp();
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const copyText = useCopyText();
    const { prefs } = useToolbarPrefs("node-hover");

    useEffect(() => {
        try {
            const stored = window.localStorage.getItem(IMAGE_QUICK_TOOLS_STORAGE_KEY);
            if (!stored) return;
            const parsed = JSON.parse(stored) as unknown;
            const config = readImageQuickToolsConfig(parsed);
            setQuickImageToolIds(config.ids);
            setShowImageToolLabels(config.showLabels);
        } catch {
            window.localStorage.removeItem(IMAGE_QUICK_TOOLS_STORAGE_KEY);
        }
    }, []);

    useEffect(() => {
        setImageToolSettingsOpen(false);
    }, [node?.id]);

    useLayoutEffect(() => {
        if (!node) return;
        const toolbar = toolbarRef.current;
        const container = toolbar?.parentElement;
        const nodeElement = container?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(node.id)}"]`);
        if (!toolbar || !container || !nodeElement) return;

        const update = () => {
            const containerRect = container.getBoundingClientRect();
            const nodeRect = nodeElement.getBoundingClientRect();
            const toolbarWidth = toolbar.offsetWidth;
            const toolbarHeight = toolbar.offsetHeight;
            const preferredLeft = nodeRect.left - containerRect.left + nodeRect.width / 2;
            const canFit = toolbarWidth <= containerRect.width - 16;
            const left = canFit
                ? Math.min(Math.max(preferredLeft, toolbarWidth / 2 + 8), containerRect.width - toolbarWidth / 2 - 8)
                : containerRect.width / 2;
            const preferredTop = nodeRect.top - containerRect.top - 8;
            let top = Math.max(toolbarHeight + 8, Math.min(preferredTop, containerRect.height - 8));
            let placedLeft = left;
            const panels = [
                panelNodeId ? container.querySelector<HTMLElement>(`[data-node-panel="${CSS.escape(panelNodeId)}"]`) : null,
                document.querySelector<HTMLElement>("[data-node-settings-panel]"),
            ].filter((panel): panel is HTMLElement => Boolean(panel));
            for (const panel of panels) {
                const panelRect = panel.getBoundingClientRect();
                const panelLeft = panelRect.left - containerRect.left;
                const panelRight = panelRect.right - containerRect.left;
                const panelTop = panelRect.top - containerRect.top;
                const panelBottom = panelRect.bottom - containerRect.top;
                const overlaps = placedLeft + toolbarWidth / 2 > panelLeft && placedLeft - toolbarWidth / 2 < panelRight && top > panelTop && top - toolbarHeight < panelBottom;
                if (overlaps) {
                    if (panelLeft - toolbarWidth >= 16) placedLeft = panelLeft - toolbarWidth / 2 - 8;
                    else if (containerRect.width - panelRight - toolbarWidth >= 16) placedLeft = panelRight + toolbarWidth / 2 + 8;
                    else if (panelTop - toolbarHeight >= 16) top = panelTop - 8;
                    else if (containerRect.height - panelBottom - toolbarHeight >= 16) top = panelBottom + toolbarHeight + 8;
                }
            }
            toolbar.style.left = `${placedLeft}px`;
            toolbar.style.top = `${top}px`;
        };

        updatePlacementRef.current = update;
        update();
        const observer = new ResizeObserver(update);
        observer.observe(toolbar);
        observer.observe(container);
        const observePanels = () => {
            if (panelNodeId) {
                const panel = container.querySelector<HTMLElement>(`[data-node-panel="${CSS.escape(panelNodeId)}"]`);
                if (panel) observer.observe(panel);
            }
            document.querySelectorAll<HTMLElement>("[data-node-settings-panel]").forEach((panel) => observer.observe(panel));
            update();
        };
        const mutationObserver = new MutationObserver(observePanels);
        mutationObserver.observe(document.body, { childList: true, subtree: true });
        observePanels();
        window.addEventListener("resize", update);
        return () => {
            observer.disconnect();
            mutationObserver.disconnect();
            window.removeEventListener("resize", update);
            updatePlacementRef.current = () => {};
        };
    }, [node?.id, panelNodeId]);

    useLayoutEffect(() => {
        updatePlacementRef.current();
    }, [node?.position.x, node?.position.y, node?.width, node?.height, panelNodeId, viewport.k, viewport.x, viewport.y]);

    if (!node) return null;

    const toolCtx = buildToolContext({
        toolMode: "select",
        selectedCount: 1,
        nodeCount: 1,
        clipboardCount: 0,
        canUndo: false,
        canRedo: false,
        demoMode: false,
        node: { kind: node.type, category: "source", hasAsset: Boolean(node.metadata?.content), busy: node.metadata?.status === "loading" },
    });
    const left = viewport.x + (node.position.x + node.width / 2) * viewport.k;
    const top = viewport.y + node.position.y * viewport.k - 14;
    const isImage = node.type === CanvasNodeType.Image;
    const isVideo = node.type === CanvasNodeType.Video;
    const isAudio = node.type === CanvasNodeType.Audio;
    const hasImage = isImage && Boolean(node.metadata?.content);
    const brokenVideo = isVideo && isBrokenVideoContent(node.metadata);
    const hasVideo = isVideo && Boolean(node.metadata?.content) && !brokenVideo;
    const hasAudio = isAudio && Boolean(node.metadata?.content);
    const isText = node.type === CanvasNodeType.Text;

    // 已收单/需先确认的失败不给重试入口：点一下就是新提交一单（见 lib/canvas/task-retry-guard.ts）。
    const canRetry = node.metadata?.status === "error" && !node.metadata?.retryBlocked && !(isVideo && Boolean(node.metadata?.videoTaskId) && !hasVideo);
    const canQueryVideoTask = isVideo && Boolean(node.metadata?.videoTaskId) && !hasVideo && node.metadata?.status !== "loading";
    const quickImageToolIdSet = new Set(quickImageToolIds);
    const copyImagePrompt = (target: CanvasNodeData) => {
        const prompt = target.metadata?.prompt?.trim();
        if (!prompt) {
            message.warning(t("canvas.nodeToolbar.noPrompt"));
            return;
        }
        copyText(prompt, t("common.promptCopied"));
    };
    const imageTools = buildImageToolbarTools(node, { onUpload, onToggleFreeResize, onMaskEdit, onCrop, onSplit, onUpscale, onSuperResolve, onAngle, onPreset, onViewImage, onCopyPrompt: copyImagePrompt, onReversePrompt });

    function openImageToolSettings() {
        setDraftImageToolIds(quickImageToolIds);
        setDraftShowImageToolLabels(showImageToolLabels);
        setImageToolSettingsOpen(true);
    }

    // 通用条目（信息 / 复制 / 删除）由注册表决定有哪些、什么顺序、用户隐藏了哪些。
    // 按节点类型分别成立的条目（字体加减、上传替换、图片工具箱）仍在其后按类型拼。
    const baseToolbarTools: ToolbarTool[] = resolveToolbarTools("node-hover", toolCtx, prefs).flatMap((def) => {
        const onClick = nodeToolbarHandler(def.action, node, {
            showInfo: onInfo,
            duplicate: onDuplicate,
            remove: onDelete,
        });
        const icon = NODE_TOOL_ICON[def.id];
        if (!onClick || !icon) return [];
        return [{ id: def.id, title: t(def.labelKey ?? def.hint), label: t(def.labelKey ?? def.label), icon, danger: def.danger, onClick }];
    });
    const nodeToolbarTools: ToolbarTool[] = [
        ...(canQueryVideoTask ? [{ id: "queryVideoTask", title: t("canvas.nodeToolbar.queryVideoTaskTitle"), label: t("canvas.nodeToolbar.queryVideoTask"), icon: <RefreshCw className="size-4" />, onClick: () => onRetry(node) }] : []),
        ...(canRetry ? [{ id: "retry", title: t("canvas.nodeToolbar.retryTitle"), label: t("canvas.node.retry"), icon: <RefreshCw className="size-4" />, onClick: () => onRetry(node) }] : []),
        ...(hasImage || hasVideo || isText ? [{ id: "saveAsset", title: t("common.addToAssets"), label: t("canvas.nodeToolbar.saveAsset"), icon: <FolderPlus className="size-4" />, onClick: () => onSaveAsset(node) }] : []),
        ...(hasImage || hasVideo || hasAudio ? [{ id: "download", title: t(hasAudio ? "canvas.nodeToolbar.downloadAudio" : hasVideo ? "canvas.nodeToolbar.downloadVideo" : "canvas.nodeToolbar.downloadImage"), label: t("common.download"), icon: <Download className="size-4" />, onClick: () => onDownload(node) }] : []),
        ...(isText ? [{ id: "generateImage", title: t("canvas.node.generateImage"), label: t("canvas.node.generate"), icon: <ImageIcon className="size-4" />, onClick: () => onGenerateImage(node) }] : []),
        ...(isText ? [{ id: "decreaseFont", title: t("canvas.nodeToolbar.decreaseFont"), label: t("canvas.nodeToolbar.zoomOut"), icon: <Minus className="size-4" />, onClick: () => onDecreaseFont(node) }] : []),
        ...(isText ? [{ id: "increaseFont", title: t("canvas.nodeToolbar.increaseFont"), label: t("canvas.nodeToolbar.zoomIn"), icon: <Plus className="size-4" />, onClick: () => onIncreaseFont(node) }] : []),
        ...(isImage && !hasImage ? [{ id: "uploadImage", title: t("canvas.nodeToolbar.uploadImage"), label: t("canvas.nodeToolbar.uploadImage"), icon: <Upload className="size-4" />, onClick: () => onUpload(node) }] : []),
        ...(isVideo ? [{ id: "uploadVideo", title: t(hasVideo ? "canvas.nodeToolbar.replaceVideo" : "canvas.nodeToolbar.uploadVideo"), label: t(hasVideo ? "canvas.nodeToolbar.replaceVideo" : "canvas.nodeToolbar.uploadVideo"), icon: <Video className="size-4" />, onClick: () => onUpload(node) }] : []),
        ...(isAudio ? [{ id: "uploadAudio", title: t(hasAudio ? "canvas.nodeToolbar.replaceAudio" : "canvas.nodeToolbar.uploadAudio"), label: t(hasAudio ? "canvas.nodeToolbar.replaceAudio" : "canvas.nodeToolbar.uploadAudio"), icon: <Music2 className="size-4" />, onClick: () => onUpload(node) }] : []),
        ...(hasImage ? imageTools.map((tool) => ({ id: tool.id, title: tool.title, label: tool.label, icon: tool.icon, active: tool.active, onClick: tool.onClick })) : []),
    ];
    const toolbarTools = hasImage
        ? [...baseToolbarTools, ...nodeToolbarTools].filter((tool) => {
              const quickToolId = tool.id === "node-info" ? "info" : tool.id === "node-delete" ? "delete" : tool.id;
              // Keep the universal duplicate action alongside the image toolbar's configurable tools.
              return tool.id === "node-duplicate" || quickImageToolIdSet.has(quickToolId as ImageQuickToolId);
          })
        : [...baseToolbarTools, ...nodeToolbarTools, ...extraTools];
    const selectableImageToolbarTools = [...baseToolbarTools, ...nodeToolbarTools].filter((tool) => tool.id !== "retry") as ImageToolbarSettingsTool[];

    const closeImageToolSettings = () => {
        setImageToolSettingsOpen(false);
    };

    const setDraftImageToolVisible = (id: ImageQuickToolId, visible: boolean) => {
        setDraftImageToolIds((current) => {
            const selected = new Set(current);
            if (visible) selected.add(id);
            else selected.delete(id);
            return selectableImageToolbarTools.filter((tool) => selected.has(tool.id)).map((tool) => tool.id);
        });
    };

    const saveImageToolSettings = () => {
        const config = { ids: draftImageToolIds, showLabels: draftShowImageToolLabels };
        setQuickImageToolIds(config.ids);
        setShowImageToolLabels(config.showLabels);
        window.localStorage.setItem(IMAGE_QUICK_TOOLS_STORAGE_KEY, JSON.stringify(config));
        closeImageToolSettings();
    };

    return (
        <>
            <div
                ref={toolbarRef}
                className="absolute z-[70] flex h-10 -translate-x-1/2 -translate-y-full items-center overflow-visible rounded-xl border text-sm shadow-md"
                data-node-toolbar={node.id}
                style={{
                    left, top,
                    background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text,
                    "--node-toolbar-hover": theme.toolbar.itemHover, "--node-toolbar-active": theme.toolbar.activeBg,
                } as CSSProperties}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseEnter={() => onKeep(node.id)}
                onMouseLeave={() => onLeave(node.id)}
                onFocus={() => onKeep(node.id)}
                onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) onLeave(node.id);
                }}
            >
                {isBuiltinNodeType(node.type) && node.type !== CanvasNodeType.Group && !getNodeDefinition(node.type)?.hidePanel && (
                    <ToolbarAction
                        id="node-settings"
                        title={t("canvas.promptPanel.nodeSettings")}
                        label={t("canvas.promptPanel.nodeSettings")}
                        icon={<SlidersHorizontal className="size-4" />}
                        active={panelNodeId === node.id}
                        pressed={panelNodeId === node.id}
                        onClick={() => onToggleDialog(node)}
                        showLabel={false}
                    />
                )}
                {toolbarTools.map((tool) => (
                    <ToolbarAction key={tool.id} {...tool} showLabel={isImage ? showImageToolLabels : true} />
                ))}
                {hasImage && node.metadata?.versionLabel ? <ToolbarAction id="node-versions" title={t("canvas.node.openVersions")} label={t("canvas.node.openVersions")} icon={<Layers className="size-4" />} onClick={() => onOpenVersions(node)} showLabel={showImageToolLabels} /> : null}
                {hasImage ? <ToolbarAction id="more" title={t("canvas.imageTools.configure")} label={t("canvas.imageTools.more")} icon={<Ellipsis className="size-4" />} active={imageToolSettingsOpen} onClick={openImageToolSettings} showLabel={showImageToolLabels} /> : null}
            </div>
            {hasImage ? (
                <ImageToolSettingsModal
                    open={imageToolSettingsOpen}
                    tools={selectableImageToolbarTools}
                    selectedIds={draftImageToolIds}
                    showLabels={draftShowImageToolLabels}
                    onToggle={setDraftImageToolVisible}
                    onShowLabelsChange={setDraftShowImageToolLabels}
                    onCancel={closeImageToolSettings}
                    onSave={saveImageToolSettings}
                />
            ) : null}
        </>
    );
}

export function CanvasNodeInfoModal({ node, open, onClose }: { node: CanvasNodeData | null; open: boolean; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    const [view, setView] = useState<"info" | "json">("info");
    const imageBytes = node?.type === CanvasNodeType.Image && node.metadata?.content ? getDataUrlByteSize(node.metadata.content) : 0;
    const batchCount = node?.type === CanvasNodeType.Image ? node.metadata?.images?.length || 0 : 0;
    const json = useMemo(() => {
        if (!node) return "";
        return JSON.stringify(
            node,
            (key, value) => {
                if (key === "content" && typeof value === "string" && value.startsWith("data:image/")) {
                    return "[base64 image]";
                }
                return value;
            },
            2,
        );
    }, [node]);

    useEffect(() => {
        if (open) setView("info");
    }, [node?.id, open]);

    const title = (
        <div className="flex items-center justify-between gap-4 pr-12">
            <span>{t("canvas.nodeToolbar.nodeInfo")}</span>
            <Segmented
                size="small"
                value={view}
                onChange={(value) => setView(value as "info" | "json")}
                options={[
                    { label: t("canvas.nodeToolbar.info"), value: "info" },
                    { label: "JSON", value: "json" },
                ]}
            />
        </div>
    );

    return (
        <Modal destroyOnHidden className="canvas-node-info-modal" title={title} open={open && Boolean(node)} centered footer={null} onCancel={onClose}>
            {node ? (
                <div className="h-[56vh] min-h-[360px] select-text text-sm" data-canvas-shortcuts-ignore>
                    {view === "info" ? (
                        <div className="thin-scrollbar h-full space-y-3 overflow-auto pr-1">
                            <InfoRow label="ID" value={node.id} />
                            <InfoRow label={t("canvas.nodeToolbar.name")} value={node.title || t("canvas.node.untitled")} />
                            <InfoRow label={t("canvas.nodeToolbar.type")} value={node.type === CanvasNodeType.Group ? t("canvas.node.group") : [CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio, CanvasNodeType.Text].includes(node.type as CanvasNodeType) ? t(`assets.kinds.${node.type}`) : getNodeDefinition(node.type)?.title || node.type} />
                            <InfoRow label={t("canvas.nodeToolbar.size")} value={`${Math.round(node.width)} x ${Math.round(node.height)}`} />
                            <InfoRow label={t("canvas.nodeToolbar.position")} value={`${Math.round(node.position.x)}, ${Math.round(node.position.y)}`} />
                            <InfoRow label={t("canvas.nodeToolbar.status")} value={node.metadata?.status || "idle"} />
                            {batchCount > 1 ? <InfoRow label={t("canvas.nodeToolbar.imageGroup")} value={t("canvas.nodeToolbar.imageCount", { count: batchCount })} /> : null}
                            {node.metadata?.prompt ? <InfoRow label={t("canvas.nodeToolbar.prompt")} value={node.metadata.prompt} /> : null}
                            {node.metadata?.videoTaskId ? <InfoRow label={t("canvas.nodeToolbar.videoTaskId")} value={node.metadata.videoTaskId} /> : null}
                            {imageBytes ? <InfoRow label={t("canvas.nodeToolbar.imageSize")} value={formatBytes(imageBytes)} /> : null}
                            {node.metadata?.errorDetails ? (
                                <div className="rounded-lg border p-3 text-red-400" style={{ borderColor: theme.node.stroke }}>
                                    {node.metadata.errorDetails}
                                </div>
                            ) : null}
                        </div>
                    ) : (
                        <pre className="thin-scrollbar h-full overflow-auto rounded-lg border p-3 text-xs leading-5" style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text }}>
                            {json}
                        </pre>
                    )}
                </div>
            ) : null}
        </Modal>
    );
}

function ToolbarAction({ title, label, icon, onClick, showLabel, pressed, active = false, danger = false }: ToolbarTool & { showLabel: boolean; pressed?: boolean }) {
    const hasText = showLabel && Boolean(label);
    return (
        <Tooltip title={title} placement="top" mouseEnterDelay={0.2} color="#ffffff" styles={{ root: { color: "#242529", boxShadow: "0 8px 24px rgba(15,23,42,.16)", fontSize: 13, fontWeight: 500 } }}>
            <button type="button" className={`group relative flex h-10 items-center whitespace-nowrap px-1.5 ${danger ? "text-destructive" : ""}`} onClick={onClick} aria-label={title} aria-pressed={pressed}>
                <span className={`flex h-9 items-center ${hasText ? "gap-2 px-2.5" : "justify-center px-2"} rounded-lg transition ${active ? "bg-[var(--node-toolbar-active)]" : "group-hover:bg-[var(--node-toolbar-hover)] group-focus-visible:bg-[var(--node-toolbar-hover)] motion-safe:group-active:scale-95"}`}>
                    {icon ?? null}
                    {hasText ? <span>{label}</span> : null}
                </span>
            </button>
        </Tooltip>
    );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
    return (
        <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3">
            <span className="opacity-50">{label}</span>
            <span className="min-w-0 whitespace-pre-wrap break-words">{value}</span>
        </div>
    );
}
