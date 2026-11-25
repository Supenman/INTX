import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { motion, useReducedMotion } from "motion/react";
import type { ChangeEvent as ReactChangeEvent, DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Group, Video } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ComfyImageTaskFailed, isLocalComfyImageWorkflow, requestImageQuestion, requestSingleImage, submitComfyImageTask, waitForComfyImageTask } from "@/services/api/image";
import { browserTaskLog, loadTaskLog, runImageSlots, useTaskLogStore } from "@/services/generation";
import { runChainSteps, type ChainRunStep } from "@/services/generation/run-chain";
import { requestAudioGeneration, storeGeneratedAudio } from "@/services/api/audio";
import { createVideoGenerationTask, isVideoTaskFailed, storeGeneratedVideo, waitForVideoGenerationTask } from "@/services/api/video";
import { findChannelModelPricing, modelOptionLabel, modelWorkflowOf, resolveModelRequestConfig, resolveModelScript, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { ensureImagePreview, uploadImage } from "@/services/image-storage";
import { uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { nanoid } from "nanoid";
import { getDataUrlByteSize, readImageMeta } from "@/lib/image-utils";
import { isBrokenVideoContent } from "@/lib/media-blob";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { useSaveFile, useSaveNotice } from "@/hooks/use-save-file";
import { useAssetStore } from "@/stores/use-asset-store";
import { archivedCanvasNodeIds, canvasNodeToAsset, importCanvasMediaToAssets } from "@/application/canvas/canvas-assets";
import { useThemeStore } from "@/stores/use-theme-store";
import { cropDataUrl, splitDataUrl, upscaleDataUrl } from "@/lib/canvas/canvas-image-data";
import { fitNodeSize, nodeSizeFromRatio } from "@/lib/canvas/canvas-node-size";
import { resolveImagePreset, type ImagePresetId } from "@/lib/canvas/image-presets";
import { estimateGenerationCost } from "@/domain/cost";
import { chainStepDisposition, orderUpstreamChains } from "@/domain/node/chain";
import { type AgentPlanVerdict } from "@/lib/canvas/agent-permissions";
import { captureVideoFrame, type VideoFramePosition } from "@/lib/canvas/canvas-video-frame";
import { extractVideoAudio } from "@/lib/canvas/extract-video-audio";
import { App, Button, Modal } from "antd";
import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { ActiveConnectionPath, ConnectionPath } from "@/components/canvas/canvas-connections";
import { CanvasBackgroundContextMenu, CanvasNodeContextMenu } from "@/components/canvas/canvas-context-menu";
import { CanvasNodeAngleDialog, type CanvasImageAngleParams } from "@/components/canvas/canvas-node-angle-dialog";
import { CanvasNodePresetDialog } from "@/components/canvas/canvas-node-preset-dialog";
import { AgentConfirmDialog } from "@/components/canvas/agent-confirm-dialog";
import { CanvasNodeCropDialog, type CanvasImageCropRect } from "@/components/canvas/canvas-node-crop-dialog";
import { CanvasNodeMaskEditDialog, type CanvasImageMaskEditPayload } from "@/components/canvas/canvas-node-mask-edit-dialog";
import { CanvasNodeSplitDialog, type CanvasImageSplitParams } from "@/components/canvas/canvas-node-split-dialog";
import { CanvasNodeUpscaleDialog, type CanvasImageUpscaleParams } from "@/components/canvas/canvas-node-upscale-dialog";
import { buildNodeGenerationContext, buildNodeResponseMessages, hydrateNodeGenerationContext } from "@/components/canvas/canvas-node-generation";
import { CanvasNodeHoverToolbar, CanvasNodeInfoModal } from "@/components/canvas/canvas-node-hover-toolbar";
import { CanvasSelectionToolbar } from "@/components/canvas/canvas-selection-toolbar";
import { InfiniteCanvas } from "@/components/canvas/infinite-canvas";
import { Minimap } from "@/components/canvas/canvas-mini-map";
import { CanvasNode } from "@/components/canvas/canvas-node";
import { CanvasNodePromptPanel, type CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import { CanvasToolbar } from "@/components/canvas/canvas-toolbar";
import { AssetPickerModal, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { CanvasGenerationHistoryModal } from "@/components/canvas/canvas-generation-history-modal";
import { CanvasVersionCompareModal } from "@/components/canvas/canvas-version-compare-modal";
import type { Timeline } from "@/domain/timeline/model";
import { clearVersionFields, listMediaVersions, prepareMediaGenerationVersion, setPrimaryMediaVersion, versionRootIdOf } from "@/domain/node/media-version";
import { CanvasStoryboardDialog } from "@/components/canvas/canvas-storyboard-dialog";
import { CanvasSidePanel } from "@/components/canvas/canvas-side-panel";
import { CanvasZoomControls } from "@/components/canvas/canvas-zoom-controls";
import { useAgentStore } from "@/stores/use-agent-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAgentBridge } from "@/pages/canvas/hooks/use-agent-bridge";
import { useProjectSaveBarrier } from "@/pages/canvas/hooks/use-project-save-barrier";
import { viewportChanged } from "@/pages/canvas/hooks/project-save";
import { SnapshotStorageStatus } from "@/components/layout/snapshot-storage-status";
import { usePluginHost } from "@/pages/canvas/hooks/use-plugin-host";
import { buildCanvasResourceReferences, buildNodeMentionReferences, getGroupResourceNodes, isCanvasReferenceNode, remapReferenceLabels, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { placeCanvasSubgraph, readCanvasWorkflow, selectWorkflow, type CanvasSubgraph } from "@/lib/canvas/canvas-workflow";
import { createStoryboardShotGraph } from "@/lib/canvas/storyboard";
import { applyNodeConfigPatch, audioMetadata, buildAudioGenerationMetadata, buildImageGenerationMetadata, createCanvasNode, imageMetadata, videoMetadata } from "@/lib/canvas/canvas-node-factory";
import { applyGroupSelection, applyUngroupSelection, canGroupSelectedNodes, canUngroupSelectedNodes, collectGroupMemberNodes, findContainingGroupId, findGroupDropTarget, fitViewportForNodes, focusViewportForNode, getConnectionTargetAnchor, getGroupWrapRect, nodeBounds, normalizeConnection, placeAssetNodes, revealNodesInViewport, snapNodesIntoGroup, warnConnectionRejected } from "@/lib/canvas/canvas-node-geometry";
import { createDragSnap, moveDraggedNodes, type DragGuides } from "@/lib/canvas/canvas-drag-snap";
import { alignNodes, distributeNodes, type AlignAxis, type DistributeAxis } from "@/lib/canvas/canvas-align";
import {
    audioExtension,
    buildAngleLabel,
    buildAnglePrompt,
    buildGenerationConfig,
    generationReferenceUrls,
    getGenerationCount,
    hasResumableImageTask,
    hasResumableVideoTask,
    hydrateAssistantImages,
    hydrateCanvasImages,
    imageExtension,
    isAudioFile,
    isGenerationCanceled,
    resetInterruptedGeneration,
    resolveMetadataReferences,
    sourceNodeReferenceImages,
} from "@/lib/canvas/canvas-generation-helpers";
import { retryBlockedByError } from "@/lib/canvas/task-retry-guard";
import { confirmedOps, planAgentOps } from "@/lib/canvas/agent-permissions";
import { getNodeDefinition, isBuiltinNodeType as isBuiltinType, useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { registerBuiltinNodes } from "@/components/canvas/nodes/builtin-nodes";
import { CanvasPluginManagerModal } from "@/components/canvas/canvas-plugin-manager-modal";
import { CanvasRefreshShell } from "@/components/canvas/canvas-refresh-shell";
import { CanvasTopBar } from "@/components/canvas/canvas-top-bar";
import { ConnectionCreateMenu, NODE_CREATE_SHORTCUTS, NodeCreateMenu, type PendingConnectionCreate } from "@/components/canvas/canvas-create-menus";
import {
    CanvasNodeType,
    type CanvasAssistantSession,
    type CanvasConnection,
    type CanvasNodeData,
    type CanvasNodeImage,
    type CanvasNodeText,
    type CanvasNodeMetadata,
    type CanvasNodeTypeId,
    type ConnectionHandle,
    type ContextMenuState,
    type Position,
    type SelectionBox,
    type ViewportTransform,
} from "@/types/canvas";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

// Register built-in nodes in the shared registry once when the module loads.
registerBuiltinNodes();

type ConnectionDropTarget = {
    nodeId: string | null;
    isNearNode: boolean;
};

type CanvasHistoryEntry = CanvasSubgraph & {
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    timeline: Timeline | undefined;
};

type CanvasGenerationRequest = {
    targetNodeId: string;
    originNodeId: string;
    runningNodeId: string;
    controller: AbortController;
};

const VIDEO_NODE_MAX_WIDTH = 420;
const VIDEO_NODE_MAX_HEIGHT = 420;
// Stable empty reference array prevents `... || []` from invalidating CanvasNode's React.memo on every render.
const EMPTY_REFERENCES: CanvasResourceReference[] = [];
const CONNECTION_HANDLE_HIT_RADIUS = 56;
const NODE_STATUS_IDLE = "idle" as const;

const NODE_STATUS_LOADING = "loading" as const;
const NODE_STATUS_SUCCESS = "success" as const;
const NODE_STATUS_ERROR = "error" as const;

function snapCanvasOffsetToGrid(offset: Position, initialPositions: ReadonlyMap<string, Position>, gridSize = 16): Position {
    const positions = [...initialPositions.values()];
    if (!positions.length) return offset;
    const left = Math.min(...positions.map((position) => position.x));
    const top = Math.min(...positions.map((position) => position.y));
    return {
        x: Math.round((left + offset.x) / gridSize) * gridSize - left,
        y: Math.round((top + offset.y) / gridSize) * gridSize - top,
    };
}

function applyGeneratedVideo(item: CanvasNodeData, video: UploadedFile, extra: CanvasNodeData["metadata"] = {}): CanvasNodeData {
    const videoSize = fitNodeSize(video.width || item.width, video.height || item.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
    return {
        ...item,
        width: videoSize.width,
        height: videoSize.height,
        position: { x: item.position.x + item.width / 2 - videoSize.width / 2, y: item.position.y + item.height / 2 - videoSize.height / 2 },
        metadata: { ...item.metadata, ...videoMetadata(video), ...extra },
    };
}

export default function CanvasPage() {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) return <CanvasRefreshShell />;

    return <InfiniteCanvasPage />;
}

function measureFocusFrame(container: HTMLDivElement | null, nodeId: string) {
    if (!container) return {};
    const nodeRect = container.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`)?.getBoundingClientRect();
    const panelRect = container.parentElement?.querySelector<HTMLElement>(`[data-node-panel="${nodeId}"]`)?.getBoundingClientRect();
    const toolbarRect = document.querySelector<HTMLElement>(`[data-node-toolbar="${nodeId}"]`)?.getBoundingClientRect();
    const dockRect = document.querySelector<HTMLElement>("[data-canvas-bottom-toolbar]")?.getBoundingClientRect();
    const below = panelRect ? panelRect.height + 12 : 0;
    const above = nodeRect && toolbarRect ? nodeRect.top - toolbarRect.top : 0;
    return { above, below, bottomInset: dockRect && below > 0 ? Math.max(0, container.getBoundingClientRect().bottom - dockRect.top) : 0 };
}

/** 由菜单同一份快捷键表反查「按键 → 节点类型」，键盘处理不再自己抄一遍。 */
const NODE_CREATE_BY_SHORTCUT: Readonly<Record<string, CanvasNodeTypeId>> = Object.fromEntries(Object.entries(NODE_CREATE_SHORTCUTS).map(([type, key]) => [key, type as CanvasNodeTypeId]));

function InfiniteCanvasPage() {
    const reducedMotion = useReducedMotion();
    const { message, modal } = App.useApp();
    const { t } = useTranslation();
    const saveFileWithNotice = useSaveFile();
    // Subscribe to the registry version so plugin registration changes rerender the canvas.
    const nodeRegistryVersion = useNodeRegistryVersion((state) => state.version);
    const params = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { state: locationState, pathname, search, hash } = useLocation();
    const homeAgentPrompt: unknown = locationState?.homeAgentPrompt;
    const [searchParams] = useSearchParams();
    const projectId = params.id || "";
    const localAgentConnected = useAgentStore((state) => state.connected);
    const localAgentActivity = useAgentStore((state) => state.activity);
    const localAgentEnabled = useAgentStore((state) => state.enabled);
    const fragmentBootstrap = useAgentStore((state) => state.fragmentBootstrap);
    const agentPanelOpen = useAgentStore((state) => state.panelOpen);
    const toggleAgentPanel = useAgentStore((state) => state.togglePanel);
    const openAgentPanel = useAgentStore((state) => state.openPanel);
    const containerRef = useRef<HTMLDivElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const workflowInputRef = useRef<HTMLInputElement>(null);
    const workflowSaveNotice = useSaveNotice();
    const uploadTargetRef = useRef<{ nodeId?: string; position?: Position } | null>(null);
    const clipboardRef = useRef<CanvasSubgraph | null>(null);
    const historyRef = useRef<{ past: CanvasHistoryEntry[]; future: CanvasHistoryEntry[] }>({ past: [], future: [] });
    const lastHistoryRef = useRef<CanvasHistoryEntry | null>(null);
    const historyCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const viewportSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const applyingHistoryRef = useRef(false);
    const rafRef = useRef<number | null>(null);
    const nodeDraggingRef = useRef(false);
    const dragRef = useRef<{
        isDraggingNode: boolean;
        hasMoved: boolean;
        startX: number;
        startY: number;
        // Keyed by node id so drag frames look positions up in O(1) instead of scanning the array per node.
        initialSelectedNodes: Map<string, { x: number; y: number }>;
        movedIds: Set<string>;
    }>({
        isDraggingNode: false,
        hasMoved: false,
        startX: 0,
        startY: 0,
        initialSelectedNodes: new Map(),
        movedIds: new Set(),
    });

    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
    const libraryAssets = useAssetStore((state) => state.assets);
    const cleanupAssetImages = useAssetStore((state) => state.cleanupImages);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const createProject = useCanvasStore((state) => state.createProject);
    const openProject = useCanvasStore((state) => state.openProject);
    const updateProject = useCanvasStore((state) => state.updateProject);
    const renameProject = useCanvasStore((state) => state.renameProject);
    const deleteProjects = useCanvasStore((state) => state.deleteProjects);
    const currentProject = useCanvasStore((state) => state.projects.find((project) => project.id === projectId));
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [nodes, setNodes] = useState<CanvasNodeData[]>([]);
    const [connections, setConnections] = useState<CanvasConnection[]>([]);
    const [chatSessions, setChatSessions] = useState<CanvasAssistantSession[]>([]);
    const [activeChatId, setActiveChatId] = useState<string | null>(null);
    const [viewport, setViewport] = useState<ViewportTransform>({ x: 0, y: 0, k: 1 });
    const [canvasTool, setCanvasTool] = useState<"select" | "pan">("pan");
    const [size, setSize] = useState({ width: 1200, height: 720 });
    const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
    const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const nodeHoverHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [connectingParams, setConnectingParams] = useState<ConnectionHandle | null>(null);
    const [connectionTargetNodeId, setConnectionTargetNodeId] = useState<string | null>(null);
    const [pendingConnectionCreate, setPendingConnectionCreate] = useState<PendingConnectionCreate | null>(null);
    const [mouseWorld, setMouseWorld] = useState<Position>({ x: 0, y: 0 });
    const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [nodeCreatePosition, setNodeCreatePosition] = useState<Position | null>(null);
    const [nodeCreateDockAnchor, setNodeCreateDockAnchor] = useState<Position | null>(null);
    const [runningNodeId, setRunningNodeId] = useState<string | null>(null);
    const [isMiniMapOpen, setIsMiniMapOpen] = useState(false);
    // 时间线播放联动：当前播放头命中的镜头节点 id，驱动画布高亮。
    const [storyboardOpen, setStoryboardOpen] = useState(false);
    const [backgroundMode, setBackgroundMode] = useState<CanvasBackgroundMode>("lines");
    const [showImageInfo, setShowImageInfo] = useState(false);
    const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const assetPickerPositionRef = useRef<Position | null>(null);
    const [generationHistoryOpen, setGenerationHistoryOpen] = useState(false);
    const [versionCompareRootId, setVersionCompareRootId] = useState<string | null>(null);
    const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
    const projectLoaded = loadedProjectId === projectId;
    const [nodeSettingsPopoverOpen, setNodeSettingsPopoverOpen] = useState(false);
    const [dialogNodeId, setDialogNodeId] = useState<string | null>(null);
    const [infoNodeId, setInfoNodeId] = useState<string | null>(null);
    const [pluginManagerOpen, setPluginManagerOpen] = useState(false);
    const [cropNodeId, setCropNodeId] = useState<string | null>(null);
    const [maskEditNodeId, setMaskEditNodeId] = useState<string | null>(null);
    const [splitNodeId, setSplitNodeId] = useState<string | null>(null);
    const [upscaleNodeId, setUpscaleNodeId] = useState<string | null>(null);
    const [superResolveNodeId, setSuperResolveNodeId] = useState<string | null>(null);
    const [angleNodeId, setAngleNodeId] = useState<string | null>(null);
    const [presetNodeId, setPresetNodeId] = useState<string | null>(null);
    // Agent 权限：默认 automatic（改画布直接执行，花钱和删除先问）。
    // 存进 store 并落 localStorage，否则每次进画布都要重选一遍，用户会烦到直接选 full 图省事。
    // 用 store 而不是本地 state：输入框右下角的三档菜单（PermissionModeMenu）要改同一个值。
    const agentPermission = useAgentStore((state) => state.permission);
    const [pendingAgentPlan, setPendingAgentPlan] = useState<{ plan: AgentPlanVerdict; proceed: () => void } | null>(null);
    const [previewNodeId, setPreviewNodeId] = useState<string | null>(null);
    const [hoverPreviewNodeId, setHoverPreviewNodeId] = useState<string | null>(null);
    const [previewImageId, setPreviewImageId] = useState<string | null>(null);
    const [titleEditing, setTitleEditing] = useState(false);
    const [titleDraft, setTitleDraft] = useState("");
    const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
    const [expandedBatchNodeIds, setExpandedBatchNodeIds] = useState<Set<string>>(new Set());
    const [isNodeDragging, setIsNodeDragging] = useState(false);
    const [dragPreview, setDragPreview] = useState<{ initialPositions: ReadonlyMap<string, Position>; offset: Position } | null>(null);
    const [snapToGrid, setSnapToGrid] = useState(() => typeof window !== "undefined" && window.localStorage.getItem("canvas:snap-to-grid") === "1");
    const [dragGuides, setDragGuides] = useState<DragGuides>({});
    const dragSnapRef = useRef<ReturnType<typeof createDragSnap> | null>(null);
    const [isNodeResizing, setIsNodeResizing] = useState(false);
    const [dropTargetGroupId, setDropTargetGroupId] = useState<string | null>(null);
    const [referencePickerNodeId, setReferencePickerNodeId] = useState<string | null>(null);
    const [referencePromptUpdate, setReferencePromptUpdate] = useState<{ nodeId: string; connectionId: string } | null>(null);

    const nodesRef = useRef(nodes);
    const connectionsRef = useRef(connections);
    const selectedNodeIdsRef = useRef(selectedNodeIds);
    const viewportRef = useRef(viewport);
    const focusAnimRef = useRef<number | null>(null);
    const generateNodeRef = useRef<((nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => Promise<void>) | null>(null);
    const connectingParamsRef = useRef(connectingParams);
    const connectionTargetNodeIdRef = useRef(connectionTargetNodeId);
    const selectionBoxRef = useRef(selectionBox);
    const pendingConnectionCreateRef = useRef(pendingConnectionCreate);
    const connectionStartPoint = useRef<{ x: number; y: number } | null>(null);
    const saveBarrier = useProjectSaveBarrier(projectId, projectLoaded, { nodes, connections, chatSessions, activeChatId, backgroundMode, showImageInfo, viewport }, viewportSaveTimerRef);
    const generationRequestsRef = useRef(new Map<string, CanvasGenerationRequest>());
    useEffect(() => () => {
        generationRequestsRef.current.forEach(({ controller }) => controller.abort());
        generationRequestsRef.current.clear();
    }, [projectId]);
    const chainRunRef = useRef<AbortController | null>(null);
    useEffect(() => () => chainRunRef.current?.abort(), [projectId]);
    const videoPollIdsRef = useRef(new Set<string>());

    const createHistoryEntry = useCallback(
        (): CanvasHistoryEntry => ({
            nodes: nodesRef.current, connections: connectionsRef.current,
            chatSessions, activeChatId, backgroundMode, showImageInfo,
            timeline: currentProject?.timeline,
        }),
        [activeChatId, backgroundMode, chatSessions, showImageInfo, currentProject?.timeline],
    );

    const cleanupCanvasFiles = useCallback(
        (extra?: unknown) => {
            cleanupAssetImages({ extra, history: historyRef.current, lastHistory: lastHistoryRef.current });
        },
        [cleanupAssetImages],
    );

    const startGenerationRequest = useCallback((targetNodeId: string, originNodeId: string, runningId = originNodeId, controller = new AbortController()) => {
        const previous = generationRequestsRef.current.get(targetNodeId);
        if (previous?.controller !== controller) previous?.controller.abort();
        generationRequestsRef.current.set(targetNodeId, { targetNodeId, originNodeId, runningNodeId: runningId, controller });
        return controller;
    }, []);

    const finishGenerationRequest = useCallback((targetNodeId: string, controller: AbortController) => {
        const request = generationRequestsRef.current.get(targetNodeId);
        if (request?.controller === controller) generationRequestsRef.current.delete(targetNodeId);
    }, []);

    const completeComfyImageNode = useCallback(async (nodeId: string, config: AiConfig, taskId: string, signal: AbortSignal) => {
        const outputs = await waitForComfyImageTask(config, taskId, signal);
        const images: CanvasNodeImage[] = [];
        for (const output of outputs) {
            const image = await uploadImage(output.blob, { signal });
            images.push({ id: nanoid(), outputNodeId: output.nodeId, status: NODE_STATUS_SUCCESS, content: image.url, storageKey: image.storageKey, naturalWidth: image.width, naturalHeight: image.height, bytes: image.bytes, mimeType: image.mimeType });
        }
        signal.throwIfAborted();
        const [first] = images;
        const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
        const nextSize = fitNodeSize(first.naturalWidth, first.naturalHeight, spec.width, spec.height);
        setNodes((prev) => prev.map((node) => {
            if (node.id !== nodeId || node.metadata?.imageTaskId !== taskId) return node;
            return {
                ...node,
                ...nextSize,
                position: { x: node.position.x + (node.width - nextSize.width) / 2, y: node.position.y + (node.height - nextSize.height) / 2 },
                metadata: {
                    ...node.metadata, imageTaskId: undefined, retryBlocked: undefined, errorDetails: undefined,
                    status: NODE_STATUS_SUCCESS, content: first.content, storageKey: first.storageKey,
                    naturalWidth: first.naturalWidth, naturalHeight: first.naturalHeight, bytes: first.bytes, mimeType: first.mimeType,
                    count: images.length, images, primaryImageId: first.id,
                },
            };
        }));
    }, []);

    const pollComfyImageNode = useCallback(async (node: CanvasNodeData) => {
        const taskId = node.metadata?.imageTaskId;
        if (!taskId || generationRequestsRef.current.has(node.id)) return;
        const controller = startGenerationRequest(node.id, node.id);
        setRunningNodeId(node.id);
        setNodes((prev) => prev.map((item) => item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_LOADING, errorDetails: undefined } } : item));
        try {
            await completeComfyImageNode(node.id, buildGenerationConfig(effectiveConfig, node, "image"), taskId, controller.signal);
        } catch (error) {
            if (controller.signal.aborted || isGenerationCanceled(error)) return;
            setNodes((prev) => prev.map((item) => item.id === node.id ? {
                ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR,
                    imageTaskId: error instanceof ComfyImageTaskFailed ? undefined : taskId,
                    errorDetails: error instanceof Error ? error.message : t("canvas.generationHistory.imageTaskPending"),
                },
            } : item));
        } finally {
            finishGenerationRequest(node.id, controller);
            setRunningNodeId((current) => current === node.id ? null : current);
        }
    }, [completeComfyImageNode, effectiveConfig, finishGenerationRequest, startGenerationRequest, t]);

    const completeVideoNodeTask = useCallback(
        async (nodeId: string, config: Parameters<typeof buildGenerationConfig>[0], prompt: string, images: Parameters<typeof createVideoGenerationTask>[2], signal: AbortSignal, extra: CanvasNodeData["metadata"] = {}, videos: ReferenceVideo[] = [], audios: ReferenceAudio[] = []) => {
            const task = await createVideoGenerationTask(config, prompt, images, { signal, videos, audios });
            const { provider } = task;
            if (provider !== "plugin") {
                setNodes((prev) => prev.map((item) => (item.id === nodeId ? { ...item, metadata: { ...item.metadata, videoTaskId: task.id, videoTaskProvider: provider, model: config.model, workflowValues: config.workflowValues } } : item)));
            }
            const video = await storeGeneratedVideo(await waitForVideoGenerationTask(config, task, { signal }));
            setNodes((prev) => prev.map((item) => (item.id === nodeId ? applyGeneratedVideo(item, video, { prompt, model: config.model, workflowValues: config.workflowValues, ...extra }) : item)));
        },
        [],
    );

    const pollVideoNodeTask = useCallback(
        async (node: CanvasNodeData, silent = false) => {
            const taskId = node.metadata?.videoTaskId;
            if (!taskId || (!isBrokenVideoContent(node.metadata) && node.metadata?.content) || generationRequestsRef.current.has(node.id) || videoPollIdsRef.current.has(node.id)) return;
            videoPollIdsRef.current.add(node.id);
            let controller: AbortController | undefined;
            try {
                const generationConfig = buildGenerationConfig(effectiveConfig, node, "video");
                if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                    if (silent) {
                        setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails: t("workbench.configFirst") } } : item)));
                        return;
                    }
                    openConfigDialog(true);
                    return;
                }
                setRunningNodeId(node.id);
                setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_LOADING, errorDetails: undefined } } : item)));
                controller = startGenerationRequest(node.id, node.id, node.id);
                const video = await storeGeneratedVideo(await waitForVideoGenerationTask(generationConfig, { id: taskId, provider: node.metadata?.videoTaskProvider ?? "openai", model: generationConfig.model }, { signal: controller.signal }));
                setNodes((prev) =>
                    prev.map((item) =>
                        item.id === node.id
                            ? applyGeneratedVideo(item, video, {
                                  prompt: item.metadata?.prompt,
                                  model: generationConfig.model,
                                  size: generationConfig.size,
                                  seconds: generationConfig.videoSeconds,
                                  vquality: generationConfig.vquality,
                                  generateAudio: generationConfig.videoGenerateAudio,
                                  watermark: generationConfig.videoWatermark,
                                  videoMode: generationConfig.videoMode,
                              })
                            : item,
                    ),
                );
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                message.error(errorDetails);
                setNodes((prev) =>
                    prev.map((item) =>
                        item.id === node.id
                            ? {
                                  ...item,
                                  metadata: {
                                      ...item.metadata,
                                      status: NODE_STATUS_ERROR,
                                      errorDetails,
                                      retryBlocked: retryBlockedByError(error) || undefined,
                                      ...(isVideoTaskFailed(error) ? { videoTaskId: undefined } : {}),
                                  },
                              }
                            : item,
                    ),
                );
            } finally {
                videoPollIdsRef.current.delete(node.id);
                if (controller) {
                    finishGenerationRequest(node.id, controller);
                    setRunningNodeId((current) => (current === node.id ? null : current));
                }
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, startGenerationRequest, t],
    );

    const stopGenerationByRunningId = useCallback((runningId: string) => {
        const affectedNodeIds = new Set<string>();
        generationRequestsRef.current.forEach((request) => {
            if (request.runningNodeId !== runningId) return;
            request.controller.abort();
            generationRequestsRef.current.delete(request.targetNodeId);
            affectedNodeIds.add(request.targetNodeId);
            affectedNodeIds.add(request.originNodeId);
        });
        setRunningNodeId((current) => (current === runningId ? null : current));
        if (!affectedNodeIds.size) return;
        setNodes((prev) =>
            prev.map((node) =>
                affectedNodeIds.has(node.id) && node.metadata?.status === NODE_STATUS_LOADING
                    ? {
                          ...node,
                          metadata: {
                              ...node.metadata,
                              status: NODE_STATUS_IDLE,
                              errorDetails: undefined,
                              images: node.metadata.images?.map((image) => (image.status === NODE_STATUS_LOADING ? { ...image, status: NODE_STATUS_ERROR, errorDetails: t("common.requestCanceled") } : image)),
                              texts: node.metadata.texts?.map((text) => (text.status === NODE_STATUS_LOADING ? { ...text, status: NODE_STATUS_ERROR, errorDetails: t("common.requestCanceled") } : text)),
                          },
                      }
                    : node,
            ),
        );
    }, [t]);

    const confirmStopGeneration = useCallback(
        (nodeId: string) => {
            modal.confirm({
                title: t("canvas.projectPage.stopTitle"),
                content: t("canvas.projectPage.stopDescription"),
                okText: t("canvas.projectPage.stop"),
                cancelText: t("canvas.projectPage.continue"),
                okButtonProps: { danger: true },
                onOk: () => stopGenerationByRunningId(nodeId),
            });
        },
        [modal, stopGenerationByRunningId, t],
    );

    useEffect(() => {
        if (!hydrated) return;
        setLoadedProjectId(null);
        let canceled = false;
        const project = openProject(projectId);
        if (!project) {
            navigate("/canvas", { replace: true });
            return;
        }

        const restore = async () => {
            const restoredNodes = await hydrateCanvasImages(resetInterruptedGeneration(project.nodes));
            const restoredSessions = await hydrateAssistantImages(project.chatSessions || []);
            if (canceled) return;
            setNodes(restoredNodes);
            setConnections(project.connections);
            setChatSessions(restoredSessions);
            setActiveChatId(project.activeChatId || null);
            setBackgroundMode(project.backgroundMode);
            setShowImageInfo(project.showImageInfo || false);
            setViewport(project.viewport);
            historyRef.current = { past: [], future: [] };
            if (historyCommitTimerRef.current) {
                clearTimeout(historyCommitTimerRef.current);
                historyCommitTimerRef.current = null;
            }
            lastHistoryRef.current = {
                nodes: restoredNodes,
                connections: project.connections,
                chatSessions: restoredSessions, activeChatId: project.activeChatId || null,
                backgroundMode: project.backgroundMode, showImageInfo: project.showImageInfo || false,
                timeline: project.timeline,
            };
            setHistoryState({ canUndo: false, canRedo: false });
            setLoadedProjectId(projectId);
        };
        void restore().catch((error: unknown) => { if (!canceled) message.error(error instanceof Error ? error.message : t("storage.failed")); });
        return () => { canceled = true; };
    }, [hydrated, navigate, openProject, projectId]);

    useEffect(() => {
        if (!projectLoaded) return;
        nodesRef.current.filter(hasResumableVideoTask).forEach((node) => void pollVideoNodeTask(node, true));
        nodesRef.current.filter(hasResumableImageTask).forEach((node) => void pollComfyImageNode(node));
        // Resume once after the current canvas is restored, not on later config identity changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectLoaded]);

    useEffect(() => {
        if (!projectLoaded || typeof homeAgentPrompt !== "string" || !homeAgentPrompt.trim()) return;
        const agent = useAgentStore.getState();
        agent.setAgentState({ prompt: homeAgentPrompt, canvasReferences: [], activeTab: agent.connected ? "chat" : "setup" });
        openAgentPanel();
        navigate({ pathname, search, hash }, { replace: true, state: null });
    }, [hash, homeAgentPrompt, navigate, openAgentPanel, pathname, projectLoaded, search]);

    useEffect(() => {
        if (!projectLoaded || !["new", "recent", "choose"].includes(searchParams.get("mode") || "")) return;
        if (!searchParams.has("agentUrl") && !localAgentEnabled && !fragmentBootstrap) openAgentPanel();
    }, [fragmentBootstrap, localAgentEnabled, openAgentPanel, projectLoaded, searchParams]);

    useEffect(() => {
        if (!projectLoaded || applyingHistoryRef.current) return;
        const next = createHistoryEntry();
        const previous = lastHistoryRef.current;
        if (
            previous?.nodes === next.nodes &&
            previous.connections === next.connections &&
            previous.chatSessions === next.chatSessions &&
            previous.activeChatId === next.activeChatId &&
            previous.backgroundMode === next.backgroundMode &&
            previous.showImageInfo === next.showImageInfo &&
            previous.timeline === next.timeline
        )
            return;

        if (historyCommitTimerRef.current) clearTimeout(historyCommitTimerRef.current);
        historyCommitTimerRef.current = setTimeout(() => {
            const current = createHistoryEntry();
            const last = lastHistoryRef.current;
            if (!last) return;
            historyRef.current.past = [...historyRef.current.past.slice(-49), last];
            historyRef.current.future = [];
            setHistoryState({ canUndo: true, canRedo: false });
            lastHistoryRef.current = current;
            historyCommitTimerRef.current = null;
        }, 180);

        return () => {
            if (historyCommitTimerRef.current) {
                clearTimeout(historyCommitTimerRef.current);
                historyCommitTimerRef.current = null;
            }
        };
    }, [activeChatId, backgroundMode, chatSessions, connections, createHistoryEntry, nodes, projectLoaded, showImageInfo, currentProject?.timeline]);

    useEffect(() => {
        if (!projectLoaded) return;
        updateProject(projectId, { nodes, connections, chatSessions, activeChatId, backgroundMode, showImageInfo });
    }, [activeChatId, backgroundMode, chatSessions, connections, nodes, projectId, projectLoaded, showImageInfo, updateProject]);

    useEffect(() => {
        if (!projectLoaded) return;
        if (viewportSaveTimerRef.current) clearTimeout(viewportSaveTimerRef.current);
        viewportSaveTimerRef.current = null;
        const stored = useCanvasStore.getState().openProject(projectId)?.viewport;
        if (!viewportChanged(stored, viewport)) {
            if (useCanvasStore.getState().editorDirty) useCanvasStore.setState({ editorDirty: false });
            return;
        }
        useCanvasStore.setState({ editorDirty: true });
        viewportSaveTimerRef.current = setTimeout(() => {
            updateProject(projectId, { viewport: viewportRef.current });
            useCanvasStore.setState({ editorDirty: false });
            viewportSaveTimerRef.current = null;
        }, 500);
        return () => {
            if (viewportSaveTimerRef.current) { clearTimeout(viewportSaveTimerRef.current); viewportSaveTimerRef.current = null; }
        };
    }, [projectId, projectLoaded, updateProject, viewport]);

    useLayoutEffect(() => {
        nodesRef.current = nodes;
        connectionsRef.current = connections;
        selectedNodeIdsRef.current = selectedNodeIds;
        viewportRef.current = viewport;
        connectingParamsRef.current = connectingParams;
        connectionTargetNodeIdRef.current = connectionTargetNodeId;
        pendingConnectionCreateRef.current = pendingConnectionCreate;
    }, [nodes, connections, selectedNodeIds, viewport, connectingParams, connectionTargetNodeId, pendingConnectionCreate]);

    useLayoutEffect(() => {
        selectionBoxRef.current = selectionBox;
    }, [selectionBox]);

    useEffect(() => {
        if (!projectLoaded) return;
        const el = containerRef.current;
        if (!el) return;

        const updateSize = () => {
            const rect = el.getBoundingClientRect();
            setSize({ width: rect.width, height: rect.height });
        };

        updateSize();
        const resizeObserver = new ResizeObserver(updateSize);
        resizeObserver.observe(el);
        return () => resizeObserver.disconnect();
    }, [projectLoaded]);

    const screenToCanvas = useCallback((clientX: number, clientY: number) => {
        const rect = containerRef.current?.getBoundingClientRect();
        const currentViewport = viewportRef.current;
        const localX = clientX - (rect?.left || 0);
        const localY = clientY - (rect?.top || 0);

        return {
            x: (localX - currentViewport.x) / currentViewport.k,
            y: (localY - currentViewport.y) / currentViewport.k,
        };
    }, []);

    const getCanvasCenter = useCallback(() => {
        const rect = containerRef.current?.getBoundingClientRect();
        return screenToCanvas((rect?.left || 0) + (rect?.width || size.width) / 2, (rect?.top || 0) + (rect?.height || size.height) / 2);
    }, [screenToCanvas, size.height, size.width]);

    const setConnecting = useCallback((next: ConnectionHandle | null) => {
        connectionStartPoint.current = null;
        connectingParamsRef.current = next;
        setConnectingParams(next);
        if (!next) {
            connectionTargetNodeIdRef.current = null;
            setConnectionTargetNodeId(null);
        }
    }, []);

    const connectNodes = useCallback(
        (current: ConnectionHandle, targetNodeId: string) => {
            if (current.nodeId === targetNodeId) return;

            const connection = normalizeConnection(current, targetNodeId, nodesRef.current);
            if (!connection) return warnConnectionRejected(targetNodeId, nodesRef.current, message.warning);
            const { fromNodeId, toNodeId } = connection;
            const exists = connectionsRef.current.some((conn) => conn.fromNodeId === fromNodeId && conn.toNodeId === toNodeId);
            if (!exists) {
                setConnections((prev) => [...prev, { id: `conn-${Date.now()}`, fromNodeId, toNodeId }]);
            }
            setContextMenu(null);
        },
        [message, t],
    );

    const createDraftNode = useCallback((type: CanvasNodeTypeId, position: Position) => {
        const node = createCanvasNode(type, position);
        if (!isBuiltinType(type) || type === CanvasNodeType.Group) return node;
        const titles = new Set(nodesRef.current.filter((item) => item.type === type).map((item) => item.title));
        let index = 1;
        while (titles.has(`${node.title} ${index}`)) index++;
        node.title = `${node.title} ${index}`;
        if (type === CanvasNodeType.Text || type === CanvasNodeType.Audio) {
            return { ...node, height: node.width, position: { ...node.position, y: position.y - node.width / 2 } };
        }
        const config = buildGenerationConfig(effectiveConfig, node, type === CanvasNodeType.Image ? "image" : "video");
        return applyNodeConfigPatch(node, { size: config.size });
    }, [effectiveConfig]);

    const createConnectedNode = useCallback(
        (type: CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Video | CanvasNodeType.Audio, pending: PendingConnectionCreate) => {
            const newNode = createDraftNode(type, pending.position);
            const anchor = nodesRef.current.find((node) => node.id === pending.connection.nodeId);
            if (pending.quickAdd && anchor) {
                newNode.position = {
                    x: pending.connection.handleType === "source" ? anchor.position.x + anchor.width + 64 : anchor.position.x - newNode.width - 64,
                    y: anchor.position.y + (anchor.height - newNode.height) / 2,
                };
            }
            const connection = normalizeConnection(pending.connection, newNode.id, [...nodesRef.current, newNode]);
            if (!connection) return;
            setNodes((prev) => [...prev, newNode]);
            setConnections((prev) => [...prev, { id: nanoid(), ...connection }]);
            setSelectedNodeIds(new Set([newNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(type === CanvasNodeType.Image || type === CanvasNodeType.Video ? newNode.id : null);
            setPendingConnectionCreate(null);
            setConnecting(null);
            containerRef.current?.focus({ preventScroll: true });
        },
        [createDraftNode, setConnecting],
    );

    const cancelPendingConnectionCreate = useCallback(() => {
        setPendingConnectionCreate(null);
        setConnecting(null);
        containerRef.current?.focus({ preventScroll: true });
    }, [setConnecting]);

    const getConnectionDropTarget = useCallback(
        (clientX: number, clientY: number, current: ConnectionHandle): ConnectionDropTarget => {
            const world = screenToCanvas(clientX, clientY);
            const scale = Math.max(viewportRef.current.k, 0.05);
            const radiusSquared = (CONNECTION_HANDLE_HIT_RADIUS / scale) ** 2;
            const nodes = nodesRef.current;
            const selected = selectedNodeIdsRef.current;
            const existingTargets = new Set(
                connectionsRef.current
                    .filter((edge) => current.handleType === "source" ? edge.fromNodeId === current.nodeId : edge.toNodeId === current.nodeId)
                    .map((edge) => current.handleType === "source" ? edge.toNodeId : edge.fromNodeId),
            );
            let isNearNode = false;
            let body: CanvasNodeData | undefined;
            let bestNodeId: string | null = null;
            let bestDistance = Number.POSITIVE_INFINITY;

            for (let index = nodes.length - 1; index >= 0; index--) {
                const node = nodes[index];
                const group = node.type === CanvasNodeType.Group;
                const { x, y } = node.position;
                const hitsInside = !group && world.x >= x && world.x <= x + node.width && world.y >= y && world.y <= y + node.height;
                if (hitsInside && (!body || (selected.has(node.id) && !selected.has(body.id)))) body = node;

                // Groups have an output handle but no input handle.
                if (current.handleType === "source" ? group : getNodeDefinition(node.type)?.hasSourceHandle === false) continue;
                const anchor = getConnectionTargetAnchor(node, current);
                const distance = (world.x - anchor.x) ** 2 + (world.y - anchor.y) ** 2;
                if (distance > radiusSquared) continue;
                isNearNode = true;
                if (distance >= bestDistance || node.id === current.nodeId || existingTargets.has(node.id)) continue;
                bestNodeId = node.id;
                bestDistance = distance;
            }

            if (body) {
                const hasOutput = current.handleType !== "target" || getNodeDefinition(body.type)?.hasSourceHandle !== false;
                const canConnect = hasOutput && !existingTargets.has(body.id) && normalizeConnection(current, body.id, nodes);
                return { nodeId: canConnect ? body.id : null, isNearNode: true };
            }
            return { nodeId: bestNodeId, isNearNode };
        },
        [screenToCanvas],
    );

    const viewBounds = useMemo(() => {
        const padding = 280;
        const rect = containerRef.current?.getBoundingClientRect();
        const width = rect?.width || size.width;
        const height = rect?.height || size.height;
        const left = -viewport.x / viewport.k - padding;
        const top = -viewport.y / viewport.k - padding;
        return { left, top, right: left + width / viewport.k + padding * 2, bottom: top + height / viewport.k + padding * 2 };
        // `nodes` keeps the container rect re-read on node changes, matching the previous behaviour when the container resizes without a size update.
    }, [nodes, size.height, size.width, viewport.k, viewport.x, viewport.y]);

    const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
    const displayNodes = useMemo(() => dragPreview ? moveDraggedNodes(nodes, dragPreview.initialPositions, dragPreview.offset) : nodes, [dragPreview, nodes]);
    const displayNodeById = useMemo(() => displayNodes === nodes ? nodeById : new Map(displayNodes.map((node) => [node.id, node])), [displayNodes, nodeById, nodes]);
    const visibleNodes = useMemo(
        () => displayNodes.filter((node) => node.position.x + node.width > viewBounds.left && node.position.x < viewBounds.right && node.position.y + node.height > viewBounds.top && node.position.y < viewBounds.bottom),
        [displayNodes, viewBounds],
    );
    const versionCompareVersions = useMemo(() => (versionCompareRootId ? listMediaVersions(nodes, versionCompareRootId) : []), [nodes, versionCompareRootId]);

    // Connections are culled like nodes; a cubic curve stays inside its control-point hull, so endpoint bounds widened by the curvature is a safe test.
    const visibleConnections = useMemo(
        () =>
            connections.flatMap((connection) => {
                const from = displayNodeById.get(connection.fromNodeId);
                const to = displayNodeById.get(connection.toNodeId);
                if (!from || !to) return [];
                const startX = from.position.x + from.width;
                const startY = from.position.y + from.height / 2;
                const endX = to.position.x;
                const endY = to.position.y + to.height / 2;
                const curvature = Math.max(Math.abs(endX - startX) * 0.5, 50);
                const inView =
                    Math.max(startX + curvature, endX) > viewBounds.left && Math.min(startX, endX - curvature) < viewBounds.right && Math.max(startY, endY) > viewBounds.top && Math.min(startY, endY) < viewBounds.bottom;
                return inView ? [{ connection, from, to }] : [];
            }),
        [connections, displayNodeById, viewBounds],
    );
    // The node toolbar follows hover, while multi-selection keeps its own toolbar only.
    const toolbarCandidateId = selectedNodeIds.size > 1 ? null : hoveredNodeId;
    const toolbarNode = toolbarCandidateId ? displayNodeById.get(toolbarCandidateId) ?? null : null;
    const singleSelectedNodeId = selectedNodeIds.size === 1 ? Array.from(selectedNodeIds)[0] : null;
    const activeDialogNode = dialogNodeId ? nodeById.get(dialogNodeId) ?? null : null;
    const activeDialogIsMediaResult = Boolean(activeDialogNode?.metadata?.content || activeDialogNode?.metadata?.storageKey);
    const isMediaGeneratingToolbarNode = Boolean(
        toolbarNode
        && (toolbarNode.type === CanvasNodeType.Image || toolbarNode.type === CanvasNodeType.Video)
        && toolbarNode.metadata?.status === NODE_STATUS_LOADING,
    );
    const toolbarNodeHasContent = Boolean(
        toolbarNode?.metadata?.content?.trim()
        || toolbarNode?.metadata?.storageKey
        || toolbarNode?.metadata?.texts?.some((text) => text.content.trim()),
    );
    const isEmptyContentToolbarNode = Boolean(
        toolbarNode
        && (toolbarNode.type === CanvasNodeType.Image || toolbarNode.type === CanvasNodeType.Video || toolbarNode.type === CanvasNodeType.Audio || toolbarNode.type === CanvasNodeType.Text)
        && !toolbarNodeHasContent,
    );
    const infoNode = infoNodeId ? nodeById.get(infoNodeId) || null : null;
    const cropNode = cropNodeId ? nodeById.get(cropNodeId) || null : null;
    const maskEditNode = maskEditNodeId ? nodeById.get(maskEditNodeId) || null : null;
    const splitNode = splitNodeId ? nodeById.get(splitNodeId) || null : null;
    const upscaleNode = upscaleNodeId ? nodeById.get(upscaleNodeId) || null : null;
    const superResolveNode = superResolveNodeId ? nodeById.get(superResolveNodeId) || null : null;
    const superResolveConfig = superResolveNode ? { ...buildGenerationConfig(effectiveConfig, superResolveNode, "image"), count: "1" } : null;
    const superResolveCost = superResolveConfig ? estimateGenerationCost({ pricing: findChannelModelPricing(superResolveConfig, superResolveConfig.model), kind: "image", outputCount: 1, modelId: superResolveConfig.model }) : null;
    const angleNode = angleNodeId ? nodeById.get(angleNodeId) || null : null;
    const presetNode = presetNodeId ? nodeById.get(presetNodeId) || null : null;
    const contextMenuNode = contextMenu?.type === "node" ? nodeById.get(contextMenu.nodeId) || null : null;
    const previewNode = previewNodeId ? nodeById.get(previewNodeId) || null : null;
    const previewContent = previewImageId ? previewNode?.metadata?.images?.find((image) => image.id === previewImageId)?.content : previewNode?.metadata?.content;
    const hasMultipleSelectedNodes = selectedNodeIds.size > 1;
    const selectedNodes = useMemo(() => nodes.filter((node) => selectedNodeIds.has(node.id)), [nodes, selectedNodeIds]);
    const selectedStoryboardReferences = useMemo(() => selectedNodes.filter((node) => node.type === CanvasNodeType.Image && node.metadata?.status === NODE_STATUS_SUCCESS && node.metadata.content), [selectedNodes]);
    const storyboardInitialScript = useMemo(() => selectedNodes.filter((node) => node.type === CanvasNodeType.Text).map((node) => node.metadata?.content || node.metadata?.prompt || "").filter(Boolean).join("\n"), [selectedNodes]);
    const canGroupSelection = canGroupSelectedNodes(selectedNodeIds, nodes);
    const canUngroupSelection = canUngroupSelectedNodes(selectedNodeIds, nodes);
    const activeNodeId = hasMultipleSelectedNodes ? null : hoveredNodeId || (selectedNodeIds.size === 1 ? Array.from(selectedNodeIds)[0] : null);
    const groupChildCountById = useMemo(() => {
        const map = new Map<string, number>();
        nodes.forEach((node) => {
            const groupId = node.metadata?.groupId;
            if (groupId) map.set(groupId, (map.get(groupId) || 0) + 1);
        });
        return map;
    }, [nodes]);
    const relatedHighlight = useMemo(() => {
        const nodeIds = new Set<string>();
        const connectionIds = new Set<string>();

        if (!activeNodeId) return { nodeIds, connectionIds };

        const addNode = (nodeId: string) => {
            nodeIds.add(nodeId);
            if (nodeById.get(nodeId)?.type === CanvasNodeType.Group) nodes.forEach((node) => node.metadata?.groupId === nodeId && nodeIds.add(node.id));
        };
        addNode(activeNodeId);
        connections.forEach((connection) => {
            if (connection.fromNodeId !== activeNodeId && connection.toNodeId !== activeNodeId) return;
            connectionIds.add(connection.id);
            addNode(connection.fromNodeId);
            addNode(connection.toNodeId);
        });

        return { nodeIds, connectionIds };
    }, [activeNodeId, connections, nodeById, nodes]);

    const mentionReferencesByNodeId = useMemo(() => {
        const map = new Map<string, ReturnType<typeof buildNodeMentionReferences>>();
        nodes.forEach((node) => map.set(node.id, buildNodeMentionReferences(node, nodes, connections)));
        return map;
    }, [connections, nodes]);
    const connectedNodesByNodeId = useMemo(() => {
        const map = new Map<string, CanvasNodeData[]>();
        connections.forEach((connection) => {
            const source = nodeById.get(connection.fromNodeId);
            if (!source) return;
            const connected = map.get(connection.toNodeId);
            if (connected) connected.push(source);
            else map.set(connection.toNodeId, [source]);
        });
        return map;
    }, [connections, nodeById]);
    const referenceConnectedNodeIds = useMemo(() => new Set([referencePickerNodeId, ...(referencePickerNodeId ? connectedNodesByNodeId.get(referencePickerNodeId)?.flatMap((node) => node.type === CanvasNodeType.Group ? [node.id, ...getGroupResourceNodes(node.id, nodes).map((child) => child.id)] : [node.id]) || [] : [])].filter((id): id is string => Boolean(id))), [connectedNodesByNodeId, nodes, referencePickerNodeId]);
    const { applyAgentOps } = useAgentBridge({
        projectId,
        title: currentProject?.title,
        nodes,
        connections,
        selectedNodeIds,
        viewport,
        nodesRef,
        connectionsRef,
        selectedNodeIdsRef,
        viewportRef,
        generateNodeRef,
        setNodes,
        setConnections,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setViewport,
        setContextMenu,
        agentPermission,
        onAgentPlanPending: (plan, proceed) => setPendingAgentPlan({ plan, proceed }),
    });

    const { pluginHost, renderPluginPanel, buildNodeToolbarItems } = usePluginHost({
        effectiveConfig,
        isAiConfigReady,
        openConfigDialog,
        theme,
        nodesRef,
        connectionsRef,
        viewportRef,
        setNodes,
        setDialogNodeId,
        applyAgentOps,
    });
    const createNode = useCallback(
        (type: CanvasNodeTypeId, position?: Position) => {
            const targetPosition = position || getCanvasCenter();
            const newNode = createDraftNode(type, targetPosition);

            setNodes((prev) => [...prev, newNode]);
            setSelectedNodeIds(new Set([newNode.id]));
            setSelectedConnectionId(null);
            const definition = getNodeDefinition(type);
            // Display-only plugin nodes with hidePanel do not open a panel; custom Panels require autoOpenPanel on creation.
            // Plugin nodes declaring useBuiltinPanel open the built-in generation panel on creation, like image nodes.
            // Built-in image and video nodes retain their existing open-on-create behavior.
            const wantsPanel = definition?.hidePanel
                ? false
                : definition?.Panel
                  ? Boolean(definition.autoOpenPanel)
                  : definition?.useBuiltinPanel
                    ? true
                    : isBuiltinType(type) && type !== CanvasNodeType.Text && type !== CanvasNodeType.Audio && type !== CanvasNodeType.Group;
            setDialogNodeId(wantsPanel ? newNode.id : null);
        },
        [createDraftNode, getCanvasCenter],
    );

    const deleteNodes = useCallback(
        (ids: Set<string>) => {
            if (!ids.size) return;
            const allIds = new Set(ids);
            setNodes((prev) => {
                const next = prev.filter((node) => !allIds.has(node.id));
                return next.map((node) => {
                    const groupId = node.metadata?.groupId;
                    if (groupId && allIds.has(groupId)) return { ...node, metadata: { ...node.metadata, groupId: undefined } };
                    return node;
                });
            });
            setConnections((prev) => prev.filter((conn) => !allIds.has(conn.fromNodeId) && !allIds.has(conn.toNodeId)));
            setSelectedNodeIds(new Set());
            setSelectedConnectionId(null);
            setHoveredNodeId((current) => (current && allIds.has(current) ? null : current));
            setDialogNodeId((current) => (current && allIds.has(current) ? null : current));
            setInfoNodeId((current) => (current && allIds.has(current) ? null : current));
            setCropNodeId((current) => (current && allIds.has(current) ? null : current));
            setMaskEditNodeId((current) => (current && allIds.has(current) ? null : current));
            setAngleNodeId((current) => (current && allIds.has(current) ? null : current));
            setPreviewNodeId((current) => (current && allIds.has(current) ? null : current));
            setRunningNodeId((current) => (current && allIds.has(current) ? null : current));
            setReferencePickerNodeId((current) => (current && allIds.has(current) ? null : current));
            setExpandedBatchNodeIds((current) => new Set([...current].filter((nodeId) => !allIds.has(nodeId))));
            setContextMenu((current) => (current?.type === "node" && allIds.has(current.nodeId) ? null : current));
            cleanupCanvasFiles({ projectId, nodes: nodesRef.current.filter((node) => !allIds.has(node.id)), chatSessions });
        },
        [chatSessions, cleanupCanvasFiles, projectId],
    );

    const groupSelection = useCallback(() => {
        const selectedIds = selectedNodeIdsRef.current;
        const members = collectGroupMemberNodes(selectedIds, nodesRef.current);
        if (members.length < 2) return;
        const rect = getGroupWrapRect(members);
        const created = createCanvasNode(CanvasNodeType.Group, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
        const result = applyGroupSelection(selectedIds, nodesRef.current, connectionsRef.current, { ...created, position: { x: rect.x, y: rect.y }, width: rect.width, height: rect.height });
        if (!result) return;
        setNodes(result.nodes);
        setConnections(result.connections);
        setSelectedNodeIds(new Set(result.selectedIds));
        setSelectedConnectionId(null);
        setDialogNodeId(null);
        setContextMenu(null);
    }, []);

    const ungroupSelection = useCallback((ids?: Set<string>) => {
        const result = applyUngroupSelection(ids || selectedNodeIdsRef.current, nodesRef.current, connectionsRef.current);
        if (!result) return;
        setNodes(result.nodes);
        setConnections(result.connections);
        setSelectedNodeIds(new Set(result.selectedIds));
        setSelectedConnectionId(null);
        setDialogNodeId(null);
        setContextMenu(null);
    }, []);

    // 对齐与等距分布：纯计算在 lib/canvas/canvas-align.ts，这里只负责写回。
    // 已经对齐时 alignNodes 返回原数组引用，此时不 setNodes——否则会白白产生一次
    // 全量替换，把「点了一下但什么也没变」也记进 undo 历史。
    const alignSelection = useCallback((axis: AlignAxis) => {
        const next = alignNodes(nodesRef.current, selectedNodeIdsRef.current, axis);
        if (next === nodesRef.current) return;
        setNodes(next);
    }, []);

    const distributeSelection = useCallback((axis: DistributeAxis) => {
        const next = distributeNodes(nodesRef.current, selectedNodeIdsRef.current, axis);
        if (next === nodesRef.current) return;
        setNodes(next);
    }, []);

    const deleteConnection = useCallback((connectionId: string) => {
        setConnections((prev) => prev.filter((conn) => conn.id !== connectionId));
        setSelectedConnectionId((current) => (current === connectionId ? null : current));
        setContextMenu((current) => (current?.type === "connection" && current.connectionId === connectionId ? null : current));
    }, []);

    const updateNodeReferences = useCallback((targetId: string, next: CanvasConnection[], replacement?: { from: string; to: string }) => {
        const nodes = nodesRef.current;
        const target = nodes.find((node) => node.id === targetId);
        if (!target) return;
        const before = buildNodeMentionReferences(target, nodes, connectionsRef.current);
        const after = next.some((edge) => edge.toNodeId === targetId) ? buildNodeMentionReferences(target, nodes, next) : [];
        connectionsRef.current = next;
        setConnections(next);
        setNodes((prev) => prev.map((node) => {
            if (node.id !== targetId || !node.metadata) return node;
            const { prompt, composerContent } = node.metadata;
            return { ...node, metadata: {
                ...node.metadata,
                prompt: prompt === undefined ? undefined : remapReferenceLabels(prompt, before, after, replacement),
                composerContent: composerContent === undefined ? undefined : remapReferenceLabels(composerContent, before, after, replacement),
            } };
        }));
        setReferencePromptUpdate({ nodeId: targetId, connectionId: nanoid() });
    }, []);

    const disconnectNodeReference = useCallback((fromNodeId: string, toNodeId: string) => {
        updateNodeReferences(toNodeId, connectionsRef.current.filter((connection) => connection.fromNodeId !== fromNodeId || connection.toNodeId !== toNodeId));
    }, [updateNodeReferences]);

    const moveNodeReference = useCallback((sourceId: string, targetId: string, delta: -1 | 1) => {
        const next = [...connectionsRef.current];
        const inputs = next.flatMap((edge, index) => edge.toNodeId === targetId ? [index] : []);
        const index = inputs.findIndex((input) => next[input].fromNodeId === sourceId);
        const from = inputs[index];
        const to = inputs[index + delta];
        if (from === undefined || to === undefined) return;
        [next[from], next[to]] = [next[to], next[from]];
        updateNodeReferences(targetId, next);
    }, [updateNodeReferences]);

    const replaceNodeReference = useCallback((from: string, targetId: string, to: string) => {
        if (to === targetId || from === to) return;
        const current = connectionsRef.current;
        const nodes = nodesRef.current;
        const target = nodes.find((node) => node.id === targetId);
        if (!target || buildNodeMentionReferences(target, nodes, current).some((reference) => reference.nodeId === to)) return;
        const candidates = buildCanvasResourceReferences(nodes.filter((node) => node.id === from || node.id === to));
        if (candidates.length !== 2 || candidates[0].kind !== candidates[1].kind) return;
        updateNodeReferences(targetId, current.map((edge) => edge.fromNodeId === from && edge.toNodeId === targetId ? { ...edge, fromNodeId: to } : edge), { from, to });
    }, [updateNodeReferences]);

    const startNodeReferenceSelection = useCallback((nodeId: string) => {
        setReferencePickerNodeId(nodeId);
        setSelectedNodeIds(new Set([nodeId]));
        setSelectedConnectionId(null);
        setDialogNodeId(nodeId);
    }, []);

    const exitNodeReferenceSelection = useCallback(() => {
        if (!referencePickerNodeId) return;
        setSelectedNodeIds(new Set([referencePickerNodeId]));
        setDialogNodeId(referencePickerNodeId);
        setReferencePickerNodeId(null);
        requestAnimationFrame(() => {
            containerRef.current?.parentElement?.querySelector<HTMLElement>(`[data-node-panel="${CSS.escape(referencePickerNodeId)}"] [role="textbox"]`)?.focus({ preventScroll: true });
        });
    }, [referencePickerNodeId]);

    const connectNodeReference = useCallback((fromNodeId: string, targetId: string) => {
        if (fromNodeId === targetId) return;
        const nodes = nodesRef.current;
        const source = nodes.find((node) => node.id === fromNodeId);
        const target = nodes.find((node) => node.id === targetId);
        if (!source || !target || !isCanvasReferenceNode(source, nodes)) return;

        const currentConnections = connectionsRef.current;
        const previousReferences = new Set(buildNodeMentionReferences(target, nodes, currentConnections).map((item) => item.nodeId));
        const sourceIds = source.type === CanvasNodeType.Group ? getGroupResourceNodes(source.id, nodes).map((node) => node.id) : [source.id];
        if (sourceIds.every((id) => previousReferences.has(id))) return;
        const connection = { id: nanoid(), fromNodeId, toNodeId: targetId };
        setConnections((prev) => prev.some((item) => item.fromNodeId === fromNodeId && item.toNodeId === targetId) ? prev : [...prev, connection]);
        if (!isBuiltinType(target.type) || getNodeDefinition(target.type)?.Panel) return;

        const labels = buildNodeMentionReferences(target, nodes, [...currentConnections, connection])
            .filter((item) => !previousReferences.has(item.nodeId))
            .map((item) => item.label);
        if (!labels.length) return;
        setNodes((prev) => prev.map((node) => {
            if (node.id !== targetId) return node;
            const metadata = node.metadata;
            const key = metadata?.composerContent !== undefined || (
                (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Text) && metadata?.content
            ) ? "composerContent" : "prompt";
            const draft = metadata?.composerContent ?? metadata?.prompt ?? "";
            return { ...node, metadata: { ...metadata, [key]: [draft.trimEnd(), ...labels].filter(Boolean).join(" ") + " " } };
        }));
        setReferencePromptUpdate({ nodeId: targetId, connectionId: connection.id });
    }, []);

    const selectNodeReference = useCallback((fromNodeId: string) => {
        if (!referencePickerNodeId || referenceConnectedNodeIds.has(fromNodeId)) return;
        connectNodeReference(fromNodeId, referencePickerNodeId);
    }, [connectNodeReference, referenceConnectedNodeIds, referencePickerNodeId]);

    useEffect(() => {
        if (!referencePickerNodeId) return;
        const exit = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopImmediatePropagation();
            exitNodeReferenceSelection();
        };
        window.addEventListener("keydown", exit, true);
        return () => window.removeEventListener("keydown", exit, true);
    }, [exitNodeReferenceSelection, referencePickerNodeId]);

    const deselectCanvas = useCallback(() => {
        cancelPendingConnectionCreate();
        setSelectedNodeIds(new Set());
        setSelectedConnectionId(null);
        setContextMenu(null);
        setSelectionBox(null);
        setHoveredNodeId(null);
        setDialogNodeId(null);
    }, [cancelPendingConnectionCreate]);

    const clearCanvas = useCallback(() => {
        setNodes([]);
        setConnections([]);
        setInfoNodeId(null);
        setCropNodeId(null);
        setMaskEditNodeId(null);
        setAngleNodeId(null);
        setPreviewNodeId(null);
        setRunningNodeId(null);
        deselectCanvas();
        setClearConfirmOpen(false);
        cleanupCanvasFiles({ projectId, nodes: [], chatSessions: [] });
    }, [cleanupCanvasFiles, deselectCanvas, projectId]);

    // 锁定只影响拖动、缩放和键盘微移，不改选中与面板：锁住的节点仍要能改参数、看内容。
    // 右键点在选区内时对整组生效，避免多选后只锁住其中一个。
    const toggleNodeLock = useCallback((nodeId: string) => {
        setNodes((prev) => {
            const target = prev.find((node) => node.id === nodeId);
            if (!target) return prev;
            const selected = selectedNodeIdsRef.current;
            const ids = selected.has(nodeId) ? new Set(selected) : new Set([nodeId]);
            const nextLocked = !target.metadata?.locked;
            return prev.map((node) => (ids.has(node.id) ? { ...node, metadata: { ...node.metadata, locked: nextLocked || undefined } } : node));
        });
    }, []);

    const duplicateNode = useCallback((nodeId: string) => {
        const source = nodesRef.current.find((node) => node.id === nodeId);
        if (!source) return;

        const id = `${source.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const next: CanvasNodeData = {
            ...source,
            id,
            title: `${source.title} Copy`,
            position: { x: source.position.x + 36, y: source.position.y + 36 },
            metadata: clearVersionFields(source.metadata),
        };
        const referenceConnections = connectionsRef.current.filter((connection) => connection.toNodeId === nodeId).map((connection) => ({ ...connection, id: nanoid(), toNodeId: id }));

        setNodes((prev) => [...prev, next]);
        setConnections((prev) => [...prev, ...referenceConnections]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        if (next.type !== CanvasNodeType.Group) setDialogNodeId(id);
    }, []);

    const copySelectedNodes = useCallback(() => {
        const selectedIds = selectedNodeIdsRef.current;
        if (!selectedIds.size) return;

        const copiedNodes = nodesRef.current
            .filter((node) => selectedIds.has(node.id))
            .map((node) => ({
                ...node,
                position: { ...node.position },
                metadata: clearVersionFields(node.metadata),
            }));

        if (!copiedNodes.length) return;

        clipboardRef.current = {
            nodes: copiedNodes,
            connections: connectionsRef.current.filter((connection) => selectedIds.has(connection.toNodeId)).map((connection) => ({ ...connection })),
        };
    }, []);

    const insertSubgraph = useCallback((graph: CanvasSubgraph, pasteClipboard = false, position?: Position) => {
        const { nodes: pastedNodes, connections: pastedConnections } = placeCanvasSubgraph(graph, position ?? getCanvasCenter(), pasteClipboard);
        if (!pastedNodes.length) return false;
        setNodes((prev) => [...prev, ...pastedNodes]);
        setConnections((prev) => [...prev, ...pastedConnections]);
        setSelectedNodeIds(new Set(pastedNodes.map((node) => node.id)));
        setSelectedConnectionId(null);
        setContextMenu(null);
        setDialogNodeId(pasteClipboard && pastedNodes[0].type !== CanvasNodeType.Group ? pastedNodes[0].id : null);
        return true;
    }, [getCanvasCenter]);

    const pasteCopiedNodes = useCallback(() => {
        const graph = clipboardRef.current;
        return graph ? insertSubgraph(graph, true) : false;
    }, [insertSubgraph]);

    const saveWorkflow = async () => {
        const project = useCanvasStore.getState().projects.find((item) => item.id === projectId);
        const selection = selectWorkflow(nodesRef.current, connectionsRef.current, selectedNodeIdsRef.current);
        if (!project || !selection.nodes.length) return;
        const graph = placeCanvasSubgraph(selection, { x: 0, y: 0 });
        try {
            workflowSaveNotice(await exportCanvasProjects(
                [{ ...project, ...graph, id: nanoid(), chatSessions: [], activeChatId: null }],
                `${project.title || t("canvas.title")}.workflow`,
            ));
        } catch (error) {
            workflowSaveNotice({ status: "failed", error });
        }
    };

    const importWorkflow = async (event: ReactChangeEvent<HTMLInputElement>) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (!file) return;
        const path = window.location.pathname;
        try {
            const graph = await readCanvasWorkflow(file);
            const nodes = await hydrateCanvasImages(graph.nodes);
            if (window.location.pathname === path) insertSubgraph({ ...graph, nodes });
        } catch {
            message.error(t("canvas.workflow.importFailed"));
        }
    };

    const previewChain = async () => {
        if (chainRunRef.current) return;
        const ids = selectedNodeIdsRef.current;
        const endIds = nodesRef.current.filter((node) => ids.has(node.id)).map((node) => node.id);
        if (!endIds.length) return;
        const path = window.location.pathname;
        await loadTaskLog();
        if (window.location.pathname !== path || endIds.some((id) => !selectedNodeIdsRef.current.has(id))) return;
        const log = useTaskLogStore.getState();
        if (log.loadError || !log.hydrated) {
            message.error(t("canvas.chain.ledgerUnavailable"));
            return;
        }
        const currentNodes = nodesRef.current;
        const groups = new Set(currentNodes.filter((node) => node.type === CanvasNodeType.Group).map((node) => node.id));
        const connections = connectionsRef.current;
        const edges = [
            ...connections,
            ...currentNodes.flatMap((node) => node.metadata?.groupId && groups.has(node.metadata.groupId)
                ? [{ fromNodeId: node.id, toNodeId: node.metadata.groupId }] : []),
        ];
        const chain = orderUpstreamChains(currentNodes, edges, endIds);
        if (!chain.ok) {
            message.warning(t(`canvas.chain.${chain.issue}`));
            return;
        }
        const totals = new Map<string, number>();
        const steps: (ChainRunStep & { node: CanvasNodeData; config: AiConfig })[] = [];
        let unknown = 0;
        const rows = chain.nodes.map((node) => {
            const meta = node.metadata;
            const matches = (task: { nodeId: string | null; upstreamRef: string | null }) =>
                task.nodeId === node.id || Boolean(meta?.videoTaskId && meta.videoTaskId === task.upstreamRef);
            const lastTask = log.tasks.filter(matches).reduce<(typeof log.tasks)[number] | undefined>(
                (latest, task) => !latest || task.createdAt > latest.createdAt ? task : latest, undefined,
            );
            const unresolved = Object.values(log.unsaved).some(({ desired, evidence }) => matches(desired) || matches(evidence));
            const state = unresolved || meta?.retryBlocked || (meta?.videoTaskId && !meta.content)
                || (meta?.status === NODE_STATUS_ERROR && !lastTask)
                || (lastTask && log.pendingCommits[lastTask.id]) || meta?.status === NODE_STATUS_LOADING || generationRequestsRef.current.has(node.id)
                ? "blocked"
                : chainStepDisposition(Boolean(meta?.content?.trim() || node.type === CanvasNodeType.Group), lastTask);
            if (state !== "generate") return { node, state };

            const kind = node.type;
            if (kind !== CanvasNodeType.Image && kind !== CanvasNodeType.Video && kind !== CanvasNodeType.Text) {
                return { node, state: "unsupported" };
            }
            const mode = kind === CanvasNodeType.Image ? "image" : kind === CanvasNodeType.Video ? "video" : "text";
            const config = buildGenerationConfig(effectiveConfig, node, mode);
            if (!isAiConfigReady(config, config.model)) return { node, state: "configuration" };
            const count = mode === "image" ? getGenerationCount(config.count) : mode === "text" ? getGenerationCount(String(meta?.textCount || 1)) : 1;
            if (count !== 1 || resolveModelScript(config, config.model)) return { node, state: "unsupported" };
            const prompt = meta?.inputPrompt ?? meta?.prompt ?? "";
            steps.push({ node, config, nodeId: node.id, params: {
                kind: mode, prompt, model: config.model, count, inputAssetIds: [],
                providerId: resolveModelRequestConfig(config, config.model).apiFormat,
                extras: { chainStep: true },
            } });
            const pricing = findChannelModelPricing(config, config.model);
            const cost = mode === "text" ? null : estimateGenerationCost({ pricing, kind: mode, outputCount: count, modelId: config.model });
            if (cost) totals.set(cost.currency, (totals.get(cost.currency) ?? 0) + cost.amount);
            else unknown += 1;
            return { node, state, model: modelOptionLabel(config, config.model) };
        });
        const numberFormat = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
        const price = [...totals].map(([currency, amount]) => `${currency} ${numberFormat.format(amount)}`).join(" + ");
        const permission = planAgentOps(steps.map(({ nodeId, params }) => ({
            type: "run_generation", nodeId, mode: params.kind, prompt: params.prompt,
        })), "automatic");
        const approvedIds = new Set(confirmedOps(permission).flatMap((op) => op.type === "run_generation" ? [op.nodeId] : []));
        const runnable = steps.length > 0 && approvedIds.size === steps.length && rows.every(({ state }) => state === "generate" || state === "reuse");
        const content = (
            <div className="space-y-3">
                <p>{t("canvas.chain.ordered")}</p>
                <ol className="max-h-[45vh] list-decimal space-y-1 overflow-y-auto pl-5">
                    {rows.map(({ node, state, model }) => (
                        <li key={node.id} className="break-words">
                            <strong>{node.title}</strong> · {t(`canvas.chain.${state}`)}{model ? ` · ${model}` : ""}
                        </li>
                    ))}
                </ol>
                {price ? <p>{t("canvas.chain.estimate", { price })}</p> : null}
                {unknown ? <p>{t("canvas.chain.unknown", { count: unknown })}</p> : null}
            </div>
        );
        if (!runnable) {
            modal.info({ title: t("canvas.chain.preview"), width: 520, content });
            return;
        }
        let activeController: AbortController | undefined;
        const dialog = modal.confirm({
            title: t("canvas.chain.preview"),
            width: 520,
            content,
            okText: t("canvas.chain.run"),
            mask: { closable: false },
            keyboard: false,
            onCancel: () => activeController?.abort(),
            onOk: async () => {
                if (chainRunRef.current) return;
                const controller = new AbortController();
                activeController = controller;
                chainRunRef.current = controller;
                const expected = new Map(chain.nodes.map((node) => [node.id, node]));
                function check() {
                    controller.signal.throwIfAborted();
                    if (window.location.pathname !== path || generationRequestsRef.current.size
                        || connectionsRef.current !== connections
                        || [...expected].some(([id, node]) => nodesRef.current.find((current) => current.id === id) !== node)) {
                        throw new Error(t("canvas.chain.changed"));
                    }
                }
                async function saveNode(id: string, update: (node: CanvasNodeData) => CanvasNodeData) {
                    check();
                    const updated = update(expected.get(id)!);
                    const next = nodesRef.current.map((node) => node.id === id ? updated : node);
                    expected.set(id, updated);
                    flushSync(() => setNodes(next));
                    const store = useCanvasStore.getState();
                    if (store.openProject(projectId)?.nodes !== next) store.updateProject(projectId, { nodes: next });
                    await store.confirmSave();
                }
                async function saveResult(id: string, update: (node: CanvasNodeData) => CanvasNodeData) {
                    await saveNode(id, (node) => {
                        const next = update(node);
                        return { ...next, metadata: { ...next.metadata, retryBlocked: undefined, errorDetails: undefined } };
                    });
                }
                const run = async () => {
                    check();
                    await useCanvasStore.getState().confirmSave();
                    const result = await runChainSteps({
                        steps: steps.filter(({ nodeId }) => approvedIds.has(nodeId)),
                        log: browserTaskLog,
                        check,
                        onProgress: (completed) => dialog.update({ title: t("canvas.chain.progress", { completed, total: steps.length }) }),
                        prepare: async ({ nodeId, params, config }) => {
                            const context = await hydrateNodeGenerationContext(buildNodeGenerationContext(nodeId, nodesRef.current, connections, params.prompt));
                            check();
                            if (!context.prompt.trim() && !context.imageCount && !context.videoCount && !context.audioCount) {
                                throw new Error(t("canvas.chain.missingInput"));
                            }
                            return async () => {
                                await saveNode(nodeId, (node) => ({
                                    ...node, metadata: { ...node.metadata, status: NODE_STATUS_LOADING, retryBlocked: true },
                                }));
                                check();
                                const options = { signal: controller.signal };
                                if (params.kind === "image") {
                                    const image = await requestSingleImage(config, context.prompt, context.referenceImages, options);
                                    const stored = await uploadImage(image.dataUrl, options);
                                    await saveResult(nodeId, (node) => {
                                        const dimensions = fitNodeSize(stored.width, stored.height, node.width, node.height);
                                        return { ...node, ...dimensions, metadata: { ...node.metadata, ...imageMetadata(stored), model: config.model } };
                                    });
                                } else if (params.kind === "video") {
                                    const task = await createVideoGenerationTask(config, context.prompt, context.referenceImages, {
                                        ...options, videos: context.referenceVideos, audios: context.referenceAudios,
                                    });
                                    const { provider } = task;
                                    if (provider !== "plugin") await saveNode(nodeId, (node) => ({
                                        ...node, metadata: { ...node.metadata, videoTaskId: task.id, videoTaskProvider: provider, model: config.model, status: NODE_STATUS_LOADING },
                                    }));
                                    const video = await storeGeneratedVideo(await waitForVideoGenerationTask(config, task, options));
                                    if (!video.storageKey) throw new Error(t("apiErrors.videoDownloadFailed"));
                                    await saveResult(nodeId, (node) => applyGeneratedVideo(node, video, { model: config.model }));
                                } else {
                                    const answer = await requestImageQuestion(config, buildNodeResponseMessages(context), () => {}, options);
                                    if (!answer.trim() || answer === t("apiErrors.noContent")) throw new Error(t("apiErrors.noContent"));
                                    await saveResult(nodeId, (node) => ({ ...node, metadata: { ...node.metadata, content: answer, status: NODE_STATUS_SUCCESS, model: config.model } }));
                                }
                            };
                        },
                    });
                    if (result.ok) message.success(t("canvas.chain.finished", { count: result.completed }));
                    else {
                        const title = expected.get(result.nodeId)?.title ?? result.nodeId;
                        const detail = result.error instanceof Error ? result.error.message : String(result.error);
                        const node = expected.get(result.nodeId);
                        if (node?.metadata?.retryBlocked) {
                            await saveNode(node.id, (item) => ({
                                ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails: detail },
                            })).catch(() => { /* 保留已落盘的拦截状态，避免误重发。 */ });
                        }
                        message.error(t("canvas.chain.stopped", { title, detail }));
                    }
                };
                try {
                    if (navigator.locks) {
                        await navigator.locks.request(`intx-chain-${projectId}`, { ifAvailable: true }, async (lock) => {
                            if (!lock) throw new Error(t("canvas.chain.busy"));
                            await run();
                        });
                    } else await run();
                } catch (error) {
                    message.error(error instanceof Error ? error.message : String(error));
                } finally {
                    chainRunRef.current = null;
                }
            },
        });
    };

    const createStoryboard = (script: string) => {
        const references = nodesRef.current.filter((node) => selectedNodeIdsRef.current.has(node.id) && node.type === CanvasNodeType.Image && node.metadata?.status === NODE_STATUS_SUCCESS && node.metadata.content);
        const graph = createStoryboardShotGraph(script, references, nodesRef.current, getCanvasCenter(), size);
        if (!graph.nodes.length) return;
        setNodes((previous) => [...previous, ...graph.nodes]);
        setConnections((previous) => [...previous, ...graph.connections]);
        setSelectedNodeIds(new Set(graph.nodes.map((node) => node.id)));
        setSelectedConnectionId(null);
        setViewport(graph.viewport);
        setStoryboardOpen(false);
        message.success(t("canvas.storyboard.created", { count: graph.nodes.length }));
    };

    const resetViewport = useCallback(() => {
        setViewport({ x: size.width / 2, y: size.height / 2, k: 1 });
        setContextMenu(null);
    }, [size.height, size.width]);

    const fitCanvasViewport = useCallback(() => {
        const container = containerRef.current;
        const viewportSize = container ? { width: container.clientWidth, height: container.clientHeight } : size;
        const target = fitViewportForNodes(nodesRef.current, viewportSize);
        if (!target) return;
        if (focusAnimRef.current !== null) {
            cancelAnimationFrame(focusAnimRef.current);
            focusAnimRef.current = null;
        }
        setViewport(target);
        setContextMenu(null);
    }, [size]);

    const focusNode = useCallback(
        (nodeId: string) => {
            const node = nodesRef.current.find((item) => item.id === nodeId);
            if (!node) return;
            setHoverPreviewNodeId(null);
            const container = containerRef.current;
            const viewportSize = container ? { width: container.clientWidth, height: container.clientHeight } : size;
            const target = focusViewportForNode(node, viewportSize, measureFocusFrame(container, nodeId));
            setSelectedNodeIds(new Set([nodeId]));
            setSelectedConnectionId(null);
            setContextMenu(null);

            if (focusAnimRef.current) cancelAnimationFrame(focusAnimRef.current);
            if (reducedMotion) {
                focusAnimRef.current = null;
                setViewport(target);
                return;
            }
            const start = { ...viewportRef.current };
            const duration = 450;
            const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
            let startTime: number | null = null;
            const step = (now: number) => {
                if (startTime === null) startTime = now;
                const progress = Math.min((now - startTime) / duration, 1);
                const t = easeOutCubic(progress);
                setViewport({ x: start.x + (target.x - start.x) * t, y: start.y + (target.y - start.y) * t, k: start.k + (target.k - start.k) * t });
                focusAnimRef.current = progress < 1 ? requestAnimationFrame(step) : null;
            };
            focusAnimRef.current = requestAnimationFrame(step);
        },
        [reducedMotion, size.height, size.width],
    );

    const focusNodeRef = useRef(focusNode);
    useEffect(() => {
        focusNodeRef.current = focusNode;
    }, [focusNode]);

    const focusSelectedNode = useCallback(() => {
        const selected = nodesRef.current.filter((node) => selectedNodeIdsRef.current.has(node.id));
        if (!selected.length) return;
        if (selected.length === 1) {
            focusNode(selected[0].id);
            return;
        }
        const { left, top, right, bottom } = nodeBounds(selected);
        const container = containerRef.current;
        if (focusAnimRef.current !== null) {
            cancelAnimationFrame(focusAnimRef.current);
            focusAnimRef.current = null;
        }
        setViewport(focusViewportForNode(
            { position: { x: left, y: top }, width: right - left, height: bottom - top },
            container ? { width: container.clientWidth, height: container.clientHeight } : size,
        ));
        setContextMenu(null);
    }, [focusNode, size]);

    useEffect(() => () => void (focusAnimRef.current && cancelAnimationFrame(focusAnimRef.current)), []);

    const setZoomScale = useCallback(
        (scale: number) => {
            if (focusAnimRef.current !== null) {
                cancelAnimationFrame(focusAnimRef.current);
                focusAnimRef.current = null;
            }
            const rect = containerRef.current?.getBoundingClientRect();
            const centerX = (rect?.width || size.width) / 2;
            const centerY = (rect?.height || size.height) / 2;
            const nextScale = Math.min(Math.max(scale, 0.05), 5);
            setViewport((prev) => ({
                x: centerX - ((centerX - prev.x) / prev.k) * nextScale,
                y: centerY - ((centerY - prev.y) / prev.k) * nextScale,
                k: nextScale,
            }));
            setContextMenu(null);
        },
        [size.height, size.width],
    );

    const applyHistory = useCallback((entry: CanvasHistoryEntry) => {
        if (historyCommitTimerRef.current) {
            clearTimeout(historyCommitTimerRef.current);
            historyCommitTimerRef.current = null;
        }
        applyingHistoryRef.current = true;
        setNodes(entry.nodes);
        setConnections(entry.connections);
        setChatSessions(entry.chatSessions);
        setActiveChatId(entry.activeChatId);
        setBackgroundMode(entry.backgroundMode);
        setShowImageInfo(entry.showImageInfo);
        updateProject(projectId, { timeline: entry.timeline });
        setSelectedNodeIds(new Set());
        setSelectedConnectionId(null);
        setContextMenu(null);
        setTimeout(() => {
            lastHistoryRef.current = entry;
            applyingHistoryRef.current = false;
            setHistoryState({ canUndo: historyRef.current.past.length > 0, canRedo: historyRef.current.future.length > 0 });
        });
    }, [projectId, updateProject]);

    const undoCanvas = useCallback(() => {
        const previous = historyRef.current.past.pop();
        const current = lastHistoryRef.current;
        if (!previous || !current) return;
        historyRef.current.future.push(current);
        applyHistory(previous);
    }, [applyHistory]);

    const redoCanvas = useCallback(() => {
        const next = historyRef.current.future.pop();
        const current = lastHistoryRef.current;
        if (!next || !current) return;
        historyRef.current.past.push(current);
        applyHistory(next);
    }, [applyHistory]);

    const createAndOpenProject = useCallback(() => {
        const id = createProject(t("canvas.defaultTitle", { count: useCanvasStore.getState().projects.length + 1 }));
        navigate(`/canvas/${id}`);
    }, [createProject, navigate, t]);

    const deleteCurrentProject = useCallback(() => {
        deleteProjects([projectId]);
        void (async () => {
            try {
                await useCanvasStore.getState().confirmSave();
                cleanupAssetImages();
                navigate("/canvas");
            } catch {
                message.error(t("canvas.project.deleteSaveFailed"));
            }
        })();
    }, [cleanupAssetImages, deleteProjects, message, navigate, projectId, t]);

    const exportCurrentProject = useCallback(async () => {
        const project = useCanvasStore.getState().projects.find((item) => item.id === projectId);
        if (!project) return message.error(t("canvas.projectPage.notFound"));
        const hide = message.loading(t("canvas.projectPage.exporting"), 0);
        try {
            const outcome = await exportCanvasProjects([project], project.title || t("canvas.title"));
            // 用户在「另存为」里点了取消：静默结束，不能报成功。
            if (outcome.status === "canceled") return;
            if (outcome.status === "failed") throw outcome.error ?? new Error("export failed");
            message.success(t("canvas.projectPage.exported"));
        } catch (error) {
            console.error(error);
            message.error(t("canvas.sidePanel.exportFailed"));
        } finally {
            hide();
        }
    }, [message, projectId, t]);

    const handleCanvasMouseDown = useCallback(
        (event: ReactPointerEvent<HTMLDivElement>) => {
            setContextMenu(null);
            setNodeCreatePosition(null);
            setHoveredNodeId(null);
            setDialogNodeId(null);
            if (pendingConnectionCreateRef.current) cancelPendingConnectionCreate();
            if (event.button !== 0) return;

            const world = screenToCanvas(event.clientX, event.clientY);
            const nextSelectionBox = {
                startWorldX: world.x,
                startWorldY: world.y,
                currentWorldX: world.x,
                currentWorldY: world.y,
                strategy: event.altKey ? "subtract" as const : event.ctrlKey || event.metaKey ? "toggle" as const : event.shiftKey ? "add" as const : "replace" as const,
                initialSelectedNodeIds: Array.from(selectedNodeIdsRef.current),
            };
            selectionBoxRef.current = nextSelectionBox;
            setSelectionBox(nextSelectionBox);
            if (nextSelectionBox.strategy === "replace") {
                setSelectedNodeIds(new Set());
            }

            setSelectedConnectionId(null);
        },
        [cancelPendingConnectionCreate, screenToCanvas],
    );

    // Selection-only logic shared by the bubbling drag entry point and outer capture handler.
    // Returns the single target ID after the click, or null for multi-selection or deselection, to sync the toolbar.
    const selectNodeByEvent = useCallback((event: Pick<ReactMouseEvent, "shiftKey" | "metaKey" | "ctrlKey">, nodeId: string) => {
        const nextSelected = new Set(selectedNodeIdsRef.current);
        if (event.shiftKey || event.metaKey || event.ctrlKey) {
            if (nextSelected.has(nodeId)) nextSelected.delete(nodeId);
            else nextSelected.add(nodeId);
        } else if (!nextSelected.has(nodeId)) {
            nextSelected.clear();
            nextSelected.add(nodeId);
        }
        setSelectedNodeIds(nextSelected);
        const soloId = nextSelected.size === 1 ? nextSelected.values().next().value ?? null : null;
        setDialogNodeId((current) => (current === soloId ? current : null));
        return { nextSelected, soloId };
    }, []);

    // Capture-phase selection lets any inner element, including textarea or iframe, select the node and show its toolbar.
    // It only selects; body onMouseDown still starts dragging, so text selection inside editors does not drag the node.
    // Cache the capture result for the following bubbling drag handler to avoid applying shift-selection twice.
    const pendingSelectionRef = useRef<{ event: MouseEvent; ids: Set<string> } | null>(null);
    const handleNodeSelectCapture = useCallback(
        (event: ReactMouseEvent, nodeId: string) => {
            if (event.button !== 0) return;
            if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && dialogNodeId && dialogNodeId !== nodeId && selectedNodeIdsRef.current.size === 1 && selectedNodeIdsRef.current.has(dialogNodeId)) {
                event.preventDefault();
                event.stopPropagation();
                connectNodeReference(nodeId, dialogNodeId);
                return;
            }
            setContextMenu(null);
            setHoveredNodeId(null);
            setSelectedConnectionId(null);
            const { nextSelected } = selectNodeByEvent(event, nodeId);
            pendingSelectionRef.current = { event: event.nativeEvent, ids: nextSelected };
        },
        [connectNodeReference, dialogNodeId, selectNodeByEvent],
    );

    const handleNodeMouseDown = useCallback((event: ReactMouseEvent, nodeId: string) => {
        event.stopPropagation();
        if (event.button !== 0) return;
        // Capture already selected the node; this only starts dragging, with a fallback selection if capture did not run.
        const currentNodes = nodesRef.current;
        const captured = pendingSelectionRef.current;
        const nextSelected = captured?.event === event.nativeEvent ? captured.ids : selectNodeByEvent(event, nodeId).nextSelected;
        pendingSelectionRef.current = null;
        if (!nextSelected.has(nodeId)) return;
        const clickedNode = currentNodes.find((node) => node.id === nodeId);
        if (clickedNode?.metadata?.locked) {
            if (clickedNode.type !== CanvasNodeType.Group) {
                if (getNodeDefinition(clickedNode.type)?.hidePanel) setDialogNodeId((current) => (current === nodeId ? current : null));
                else {
                    setDialogNodeId(nodeId);
                    if (useConfigStore.getState().config.autoFocusOnSelect) requestAnimationFrame(() => focusNodeRef.current(nodeId));
                }
            }
            return;
        }
        const dragIds = new Set(nextSelected);
        currentNodes.forEach((node) => {
            if (!nextSelected.has(node.id)) return;
            if (node.type === CanvasNodeType.Group) {
                currentNodes.forEach((child) => {
                    if (child.metadata?.groupId === node.id) dragIds.add(child.id);
                });
            }
        });
        const initialSelectedNodes = new Map(currentNodes.filter((node) => dragIds.has(node.id) && !node.metadata?.locked).map((node): [string, { x: number; y: number }] => [node.id, { x: node.position.x, y: node.position.y }]));
        dragSnapRef.current = createDragSnap(currentNodes, dragIds);
        dragRef.current = {
            isDraggingNode: true,
            hasMoved: false,
            startX: event.clientX,
            startY: event.clientY,
            initialSelectedNodes,
            movedIds: new Set(initialSelectedNodes.keys()),
        };
        if (nodeHoverHideTimerRef.current) clearTimeout(nodeHoverHideTimerRef.current);
        nodeHoverHideTimerRef.current = null;
        nodeDraggingRef.current = true;
        setIsNodeDragging(true);
    }, [selectNodeByEvent]);

    const finishNodeDrag = useCallback((clientX?: number, clientY?: number) => {
        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        if (!dragRef.current.isDraggingNode) return;

        const wasClick = clientX != null && clientY != null && !dragRef.current.hasMoved && dragRef.current.initialSelectedNodes.size === 1;
        const clickedNodeId = dragRef.current.initialSelectedNodes.keys().next().value;
        const currentViewport = viewportRef.current;
        const dx = clientX == null ? 0 : (clientX - dragRef.current.startX) / currentViewport.k;
        const dy = clientY == null ? 0 : (clientY - dragRef.current.startY) / currentViewport.k;
        const initialPositions = dragRef.current.initialSelectedNodes;
        const movedIds = dragRef.current.movedIds;

        setDragPreview(null);
        nodeDraggingRef.current = false;
        setIsNodeDragging(false);
        setDragGuides({});
        const aligned = dragSnapRef.current?.({ x: dx, y: dy }, currentViewport.k);
        const offset = snapToGrid ? snapCanvasOffsetToGrid(aligned?.offset ?? { x: dx, y: dy }, initialPositions) : aligned?.offset ?? { x: dx, y: dy };
        dragSnapRef.current = null;
        const dropNodeId = clientX == null || clientY == null
            ? null
            : document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId ?? null;
        setHoveredNodeId(dropNodeId);
        setDropTargetGroupId(null);
        if (dragRef.current.hasMoved && clientX != null && clientY != null) {
            setNodes((prev) => {
                const moved = moveDraggedNodes(prev, initialPositions, offset);
                const targetGroup = findGroupDropTarget(movedIds, moved);
                if (targetGroup) return snapNodesIntoGroup(movedIds, moved, targetGroup);
                return moved.map((node) => {
                    if (!movedIds.has(node.id) || node.type === CanvasNodeType.Group) return node;
                    const groupId = findContainingGroupId(node, moved);
                    if (node.metadata?.groupId === groupId) return node;
                    return { ...node, metadata: { ...node.metadata, groupId } };
                });
            });
        }

        dragRef.current.isDraggingNode = false;
        dragRef.current.hasMoved = false;
        dragRef.current.initialSelectedNodes = new Map();
        dragRef.current.movedIds = new Set();
        if (wasClick && clickedNodeId) {
            const clickedNode = nodesRef.current.find((node) => node.id === clickedNodeId);
            const clickedDefinition = clickedNode ? getNodeDefinition(clickedNode.type) : undefined;
            if (clickedDefinition?.hidePanel) {
                // Clicking a display-only plugin node selects it without opening a lower panel.
                setDialogNodeId((current) => (current === clickedNodeId ? current : null));
            } else if (clickedNode?.type !== CanvasNodeType.Group) {
                setDialogNodeId(clickedNodeId);
                if (useConfigStore.getState().config.autoFocusOnSelect) {
                    // Wait for the generation panel to render so centering accounts for it.
                    requestAnimationFrame(() => focusNodeRef.current(clickedNodeId));
                }
            }
        }
    }, [snapToGrid]);

    const handleGlobalMouseMove = useCallback(
        (event: MouseEvent) => {
            const currentViewport = viewportRef.current;

            if (dragRef.current.isDraggingNode) {
                const dx = (event.clientX - dragRef.current.startX) / currentViewport.k;
                const dy = (event.clientY - dragRef.current.startY) / currentViewport.k;
                const initialPositions = dragRef.current.initialSelectedNodes;
                const movedIds = dragRef.current.movedIds;
                if (Math.abs(event.clientX - dragRef.current.startX) > 3 || Math.abs(event.clientY - dragRef.current.startY) > 3) {
                    dragRef.current.hasMoved = true;
                }

                if (!dragRef.current.hasMoved) return;
                if (rafRef.current) cancelAnimationFrame(rafRef.current);
                rafRef.current = requestAnimationFrame(() => {
                    const snap = dragSnapRef.current?.({ x: dx, y: dy }, currentViewport.k);
                    const offset = snapToGrid ? snapCanvasOffsetToGrid(snap?.offset ?? { x: dx, y: dy }, initialPositions) : snap?.offset ?? { x: dx, y: dy };
                    const previewNodes = moveDraggedNodes(nodesRef.current, initialPositions, offset);
                    setDragGuides(snapToGrid ? {} : snap?.guides ?? {});
                    setDropTargetGroupId(findGroupDropTarget(movedIds, previewNodes)?.id || null);
                    setDragPreview({ initialPositions, offset });
                    rafRef.current = null;
                });
                return;
            }

            if (connectingParamsRef.current && !pendingConnectionCreateRef.current) {
                const start = connectionStartPoint.current;
                if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) connectionStartPoint.current = null;
                const dropTarget = getConnectionDropTarget(event.clientX, event.clientY, connectingParamsRef.current);
                connectionTargetNodeIdRef.current = dropTarget.nodeId;
                setConnectionTargetNodeId(dropTarget.nodeId);
                setMouseWorld(screenToCanvas(event.clientX, event.clientY));
            }
        },
        [finishNodeDrag, getConnectionDropTarget, screenToCanvas, snapToGrid],
    );

    const updateSelectionBoxAtPointer = useCallback((currentSelection: SelectionBox, clientX: number, clientY: number) => {
        const world = screenToCanvas(clientX, clientY);
        if (currentSelection.startWorldX === currentSelection.currentWorldX && currentSelection.startWorldY === currentSelection.currentWorldY && Math.hypot(world.x - currentSelection.startWorldX, world.y - currentSelection.startWorldY) * viewportRef.current.k < 4) return;
        const rectX = Math.min(currentSelection.startWorldX, world.x);
        const rectY = Math.min(currentSelection.startWorldY, world.y);
        const rectW = Math.abs(world.x - currentSelection.startWorldX);
        const rectH = Math.abs(world.y - currentSelection.startWorldY);
        const hitNodeIds = new Set<string>();
        nodesRef.current.forEach((node) => {
            const intersects = rectX < node.position.x + node.width && rectX + rectW > node.position.x && rectY < node.position.y + node.height && rectY + rectH > node.position.y;

            if (intersects) hitNodeIds.add(node.id);
        });

        const nextSelected = new Set<string>(currentSelection.initialSelectedNodeIds);
        if (currentSelection.strategy === "replace") nextSelected.clear();
        for (const nodeId of hitNodeIds) {
            if (currentSelection.strategy === "subtract") nextSelected.delete(nodeId);
            else if (currentSelection.strategy === "toggle" && nextSelected.has(nodeId)) nextSelected.delete(nodeId);
            else nextSelected.add(nodeId);
        }

        const nextSelectionBox = { ...currentSelection, currentWorldX: world.x, currentWorldY: world.y };
        selectionBoxRef.current = nextSelectionBox;
        setSelectionBox(nextSelectionBox);
        setSelectedNodeIds(nextSelected);
    }, [screenToCanvas]);

    const finishSelectionBox = useCallback((clientX: number, clientY: number) => {
        const currentSelection = selectionBoxRef.current;
        if (!currentSelection) return;
        updateSelectionBoxAtPointer(currentSelection, clientX, clientY);
        selectionBoxRef.current = null;
        setSelectionBox(null);
    }, [updateSelectionBoxAtPointer]);

    const handleGlobalPointerMove = useCallback(
        (event: PointerEvent) => {
            const currentSelection = selectionBoxRef.current;
            if (!currentSelection) return;
            if (event.buttons === 0) {
                finishSelectionBox(event.clientX, event.clientY);
                return;
            }
            updateSelectionBoxAtPointer(currentSelection, event.clientX, event.clientY);
        },
        [finishSelectionBox, updateSelectionBoxAtPointer],
    );

    const handleGlobalMouseUp = useCallback(
        (event: MouseEvent) => {
            if (event.button !== 0) return;
            finishNodeDrag(event.clientX, event.clientY);
            finishSelectionBox(event.clientX, event.clientY);

            if (pendingConnectionCreateRef.current) return;

            const currentConnection = connectingParamsRef.current;
            if (currentConnection) {
                const bounds = containerRef.current?.getBoundingClientRect();
                if (bounds && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) {
                    setConnecting(null);
                    return;
                }
                const start = connectionStartPoint.current;
                connectionStartPoint.current = null;
                if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 4) {
                    setPendingConnectionCreate({ connection: currentConnection, position: screenToCanvas(start.x, start.y), quickAdd: true });
                    return;
                }
                const dropTarget = getConnectionDropTarget(event.clientX, event.clientY, currentConnection);
                if (dropTarget.nodeId) {
                    connectNodes(currentConnection, dropTarget.nodeId);
                    setConnecting(null);
                } else if (dropTarget.isNearNode) {
                    setConnecting(null);
                } else {
                    setMouseWorld(screenToCanvas(event.clientX, event.clientY));
                    setPendingConnectionCreate({ connection: currentConnection, position: screenToCanvas(event.clientX, event.clientY) });
                }
            }
        },
        [connectNodes, finishNodeDrag, finishSelectionBox, getConnectionDropTarget, screenToCanvas, setConnecting],
    );

    useEffect(() => {
        const handlePointerUp = (event: PointerEvent) => {
            if (event.isPrimary && event.button === 0) {
                finishNodeDrag(event.clientX, event.clientY);
                finishSelectionBox(event.clientX, event.clientY);
            }
        };
        const cancelCanvasGesture = () => {
            finishNodeDrag();
            const selection = selectionBoxRef.current;
            if (selection) {
                selectionBoxRef.current = null;
                setSelectionBox(null);
                setSelectedNodeIds(new Set(selection.initialSelectedNodeIds));
            }
            if (connectingParamsRef.current) cancelPendingConnectionCreate();
        };
        window.addEventListener("mousemove", handleGlobalMouseMove);
        window.addEventListener("mouseup", handleGlobalMouseUp);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", cancelCanvasGesture);
        window.addEventListener("blur", cancelCanvasGesture);
        window.addEventListener("pointermove", handleGlobalPointerMove);
        return () => {
            window.removeEventListener("mousemove", handleGlobalMouseMove);
            window.removeEventListener("mouseup", handleGlobalMouseUp);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", cancelCanvasGesture);
            window.removeEventListener("blur", cancelCanvasGesture);
            window.removeEventListener("pointermove", handleGlobalPointerMove);
        };
    }, [cancelPendingConnectionCreate, finishNodeDrag, finishSelectionBox, handleGlobalMouseMove, handleGlobalMouseUp, handleGlobalPointerMove]);

    const createImageFileNode = useCallback(async (file: File, position: Position) => {
        const image = await uploadImage(file);
        const size = fitNodeSize(image.width, image.height);
        const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const newNode: CanvasNodeData = {
            id,
            type: CanvasNodeType.Image,
            title: file.name,
            position: { x: position.x - size.width / 2, y: position.y - size.height / 2 },
            width: size.width,
            height: size.height,
            metadata: imageMetadata(image),
        };

        setNodes((prev) => [...prev, newNode]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        setDialogNodeId(id);
    }, []);

    const createVideoFileNode = useCallback(async (file: File, position: Position) => {
        const video = await uploadMediaFile(file, "video");
        const size = fitNodeSize(video.width || 1280, video.height || 720, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
        const id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setNodes((prev) => [
            ...prev,
            {
                id,
                type: CanvasNodeType.Video,
                title: file.name,
                position: { x: position.x - size.width / 2, y: position.y - size.height / 2 },
                width: size.width,
                height: size.height,
                metadata: videoMetadata(video),
            },
        ]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        setDialogNodeId(id);
    }, []);

    const createAudioFileNode = useCallback(async (file: File, position: Position) => {
        const audio = await uploadMediaFile(file, "audio");
        const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
        const id = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setNodes((prev) => [
            ...prev,
            {
                id,
                type: CanvasNodeType.Audio,
                title: file.name,
                position: { x: position.x - spec.width / 2, y: position.y - spec.height / 2 },
                width: spec.width,
                height: spec.height,
                metadata: audioMetadata(audio),
            },
        ]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
    }, []);

    const createTextNodeFromClipboard = useCallback(
        (text: string, position = getCanvasCenter()) => {
            const trimmed = text.trim();
            if (!trimmed) return false;

            const node = {
                ...createCanvasNode(CanvasNodeType.Text, position, { content: trimmed, status: NODE_STATUS_SUCCESS }),
                title: trimmed.slice(0, 32) || t("canvas.projectPage.clipboardText"),
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([node.id]));
            setSelectedConnectionId(null);
            setContextMenu(null);
            setDialogNodeId(node.id);
            return true;
        },
        [getCanvasCenter, t],
    );

    const pasteSystemClipboard = useCallback(async (position = getCanvasCenter()) => {
        if (!navigator.clipboard) return;

        const items = typeof navigator.clipboard.read === "function" ? await navigator.clipboard.read().catch(() => []) : [];
        const imageItem = items.find((item) => item.types.some((type) => type.startsWith("image/")));
        if (imageItem) {
            const imageType = imageItem.types.find((type) => type.startsWith("image/"));
            if (!imageType) return;
            const blob = await imageItem.getType(imageType);
            const file = new File([blob], "clipboard-image.png", { type: imageType });
            await createImageFileNode(file, position);
            message.success(t("canvas.projectPage.clipboardImageAdded"));
            return;
        }

        const text = await navigator.clipboard.readText();
        if (createTextNodeFromClipboard(text, position)) message.success(t("canvas.projectPage.clipboardTextAdded"));
    }, [createImageFileNode, createTextNodeFromClipboard, getCanvasCenter, message, t]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented) return;
            const target = event.target instanceof Element ? event.target : null;
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || target?.closest("[contenteditable='true'],[data-canvas-no-zoom],[data-canvas-shortcuts-ignore]")) return;

            if (event.key === "Escape" && dragRef.current.isDraggingNode) {
                event.preventDefault();
                finishNodeDrag();
                return;
            }
            if (event.key === "Escape" && connectingParamsRef.current) {
                event.preventDefault();
                cancelPendingConnectionCreate();
                return;
            }
            if (nodeCreatePosition || contextMenu || pendingConnectionCreateRef.current) return;

            const key = event.key.toLowerCase();
            const isModifierShortcut = event.metaKey || event.ctrlKey;

            if (isModifierShortcut && key === "c" && window.getSelection()?.toString()) return;

            if (isModifierShortcut && !event.altKey && key === "z") {
                event.preventDefault();
                if (event.shiftKey) redoCanvas();
                else undoCanvas();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "y") {
                event.preventDefault();
                redoCanvas();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "a") {
                event.preventDefault();
                setSelectedNodeIds(new Set(nodesRef.current.map((node) => node.id)));
                setSelectedConnectionId(null);
                setContextMenu(null);
                setSelectionBox(null);
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "g") {
                if (event.shiftKey) {
                    if (canUngroupSelectedNodes(selectedNodeIdsRef.current, nodesRef.current)) {
                        event.preventDefault();
                        ungroupSelection();
                    }
                    return;
                }
                if (canGroupSelectedNodes(selectedNodeIdsRef.current, nodesRef.current)) {
                    event.preventDefault();
                    groupSelection();
                }
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "l") {
                event.preventDefault();
                const [first] = selectedNodeIdsRef.current;
                if (first) toggleNodeLock(first);
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "c") {
                event.preventDefault();
                copySelectedNodes();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "v") {
                event.preventDefault();
                if (!pasteCopiedNodes()) void pasteSystemClipboard().catch(() => message.warning(t("canvas.contextMenu.clipboardUnavailable")));
                return;
            }

            if (event.key === "Delete" || event.key === "Backspace") {
                if (selectedNodeIdsRef.current.size) {
                    deleteNodes(new Set(selectedNodeIdsRef.current));
                } else if (selectedConnectionId) {
                    deleteConnection(selectedConnectionId);
                }
            }

            if (event.key === "Escape") {
                setSelectedNodeIds(new Set());
                setSelectedConnectionId(null);
                setContextMenu(null);
                setNodeCreatePosition(null);
                setSelectionBox(null);
                setConnecting(null);
                setHoveredNodeId(null);
                setDialogNodeId(null);
                setInfoNodeId(null);
                setCropNodeId(null);
                setMaskEditNodeId(null);
                setPendingConnectionCreate(null);
                return;
            }

            // 单键新建节点。菜单开着时不处理：菜单自己有 ↑↓/Enter 的键盘模型，
            // input 里打「t」不该在背后凭空多出一个节点。
            if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
            if (event.isComposing) return;
            const createType = NODE_CREATE_BY_SHORTCUT[event.key.toUpperCase()];
            if (!createType) return;
            event.preventDefault();
            setContextMenu(null);
            createNode(createType);
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [cancelPendingConnectionCreate, contextMenu, copySelectedNodes, createNode, deleteConnection, deleteNodes, finishNodeDrag, groupSelection, message, nodeCreatePosition, pasteCopiedNodes, pasteSystemClipboard, redoCanvas, selectedConnectionId, setConnecting, t, undoCanvas, ungroupSelection]);

    const handleConnectStart = useCallback(
        (event: ReactMouseEvent, nodeId: string, handleType: "source" | "target") => {
            if (event.button !== 0) return;
            event.stopPropagation();
            setMouseWorld(screenToCanvas(event.clientX, event.clientY));
            setConnecting({ nodeId, handleType });
            connectionStartPoint.current = { x: event.clientX, y: event.clientY };
            connectionTargetNodeIdRef.current = null;
            setConnectionTargetNodeId(null);
            setSelectedConnectionId(null);
        },
        [screenToCanvas, setConnecting],
    );

    const handleConnectQuickAdd = useCallback((nodeId: string, handleType: ConnectionHandle["handleType"]) => {
        const node = nodesRef.current.find((item) => item.id === nodeId);
        if (!node) return;
        const connection = { nodeId, handleType };
        const position = {
            x: handleType === "source" ? node.position.x + node.width : node.position.x,
            y: node.position.y + node.height / 2,
        };
        setContextMenu(null);
        setNodeCreatePosition(null);
        setSelectedConnectionId(null);
        setMouseWorld(position);
        setConnecting(connection);
        setPendingConnectionCreate({ connection, position, quickAdd: true });
    }, [setConnecting]);

    const handleNodeResize = useCallback((nodeId: string, width: number, height: number, position?: Position) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, width, height, position: position || node.position } : node)));
    }, []);

    const handleNodeResizeStart = useCallback(() => {
        setIsNodeResizing(true);
    }, []);
    const handleNodeResizeEnd = useCallback(() => setIsNodeResizing(false), []);

    const toggleNodeFreeResize = useCallback((nodeId: string) => {
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id !== nodeId) return node;
                const freeResize = !node.metadata?.freeResize;
                if (freeResize || node.type !== CanvasNodeType.Image) return { ...node, metadata: { ...node.metadata, freeResize } };
                const ratio = (node.metadata?.naturalWidth || node.width) / (node.metadata?.naturalHeight || node.height || 1);
                const height = node.width / ratio;
                return { ...node, height, position: { x: node.position.x, y: node.position.y + node.height / 2 - height / 2 }, metadata: { ...node.metadata, freeResize } };
            }),
        );
    }, []);

    const handleNodeContentChange = useCallback((nodeId: string, content: string) => {
        setNodes((prev) =>
            prev.map((node) =>
                node.id === nodeId
                    ? { ...node, metadata: { ...node.metadata, content, texts: node.metadata?.texts?.map((text) => (text.id === node.metadata?.primaryTextId ? { ...text, content } : text)) } }
                    : node,
            ),
        );
    }, []);

    const handleNodeTitleChange = useCallback((nodeId: string, title: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, title } : node)));
    }, []);

    const toggleBatchExpanded = useCallback((nodeId: string) => {
        setExpandedBatchNodeIds((current) => {
            const next = new Set(current);
            if (next.has(nodeId)) next.delete(nodeId);
            else next.add(nodeId);
            return next;
        });
    }, []);

    const setBatchPrimary = useCallback((nodeId: string, itemId: string) => {
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id !== nodeId) return node;
                if (node.type === CanvasNodeType.Text) {
                    const text = node.metadata?.texts?.find((item) => item.id === itemId);
                    return text?.content ? { ...node, metadata: { ...node.metadata, content: text.content, primaryTextId: text.id } } : node;
                }
                const image = node.metadata?.images?.find((item) => item.id === itemId);
                if (!image?.content) return node;
                const edge = Math.max(node.width, node.height);
                const size = node.metadata?.freeResize ? { width: node.width, height: node.height } : fitNodeSize(image.naturalWidth, image.naturalHeight, edge, edge);
                return {
                    ...node,
                    position: { x: node.position.x + node.width / 2 - size.width / 2, y: node.position.y + node.height / 2 - size.height / 2 },
                    ...size,
                    metadata: {
                        ...node.metadata,
                        content: image.content,
                        storageKey: image.storageKey,
                        naturalWidth: image.naturalWidth,
                        naturalHeight: image.naturalHeight,
                        bytes: image.bytes,
                        mimeType: image.mimeType,
                        primaryImageId: image.id,
                    },
                };
            }),
        );
    }, []);

    const duplicateBatchImage = useCallback((node: CanvasNodeData, imageId: string) => {
        const image = node.metadata?.images?.find((item) => item.id === imageId);
        if (!image?.content) return;
        const id = nanoid();
        const edge = Math.max(node.width, node.height);
        const size = fitNodeSize(image.naturalWidth, image.naturalHeight, edge, edge);
        const copy: CanvasNodeData = {
            id,
            type: CanvasNodeType.Image,
            title: node.title,
            position: { x: node.position.x + node.width * 2 + 96, y: node.position.y + node.height / 2 - size.height / 2 },
            ...size,
            metadata: {
                content: image.content,
                storageKey: image.storageKey,
                naturalWidth: image.naturalWidth,
                naturalHeight: image.naturalHeight,
                bytes: image.bytes,
                mimeType: image.mimeType,
                status: NODE_STATUS_SUCCESS,
                prompt: node.metadata?.prompt,
                generationType: node.metadata?.generationType,
                model: node.metadata?.model,
                size: node.metadata?.size,
                quality: node.metadata?.quality,
                background: node.metadata?.background,
                references: node.metadata?.references,
            },
        };
        setNodes((prev) => [...prev, copy]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        setDialogNodeId(id);
    }, []);

    const handleNodePromptChange = useCallback((nodeId: string, prompt: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, prompt } } : node)));
    }, []);

    const handleConfigNodeChange = useCallback((nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? applyNodeConfigPatch(node, patch) : node)));
    }, []);

    const downloadNodeImage = useCallback(
        (node: CanvasNodeData) => {
            if ((node.type !== CanvasNodeType.Image && node.type !== CanvasNodeType.Video && node.type !== CanvasNodeType.Audio) || !node.metadata?.content) return;
            void saveFileWithNotice(
                node.metadata.content,
                `canvas-${node.type}-${node.id}.${node.type === CanvasNodeType.Video ? "mp4" : node.type === CanvasNodeType.Audio ? audioExtension(node.metadata.mimeType) : imageExtension(node.metadata.content)}`,
            );
        },
        [saveFileWithNotice],
    );

    const downloadBatchImage = useCallback(
        (node: CanvasNodeData, imageId: string) => {
            const image = node.metadata?.images?.find((item) => item.id === imageId);
            if (!image?.content) return;
            void saveFileWithNotice(image.content, `canvas-image-${node.id}-${image.id}.${imageExtension(image.content)}`);
        },
        [saveFileWithNotice],
    );

    const captureVideoNodeFrame = useCallback(
        async (nodeId: string, position: VideoFramePosition) => {
            setContextMenu(null);
            const node = nodesRef.current.find((item) => item.id === nodeId);
            const video = Array.from(containerRef.current!.querySelectorAll<HTMLVideoElement>("video[data-canvas-video]")).find((item) => item.dataset.canvasVideo === nodeId);
            if (node?.type !== CanvasNodeType.Video || !node.metadata?.content || !video) return message.error(t("canvas.videoFrames.failed"));
            try {
                const image = await uploadImage(await captureVideoFrame(node.metadata.content, position, video.currentTime));
                const size = fitNodeSize(image.width, image.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                const id = nanoid();
                const x = node.position.x + node.width + 96;
                let y = node.position.y + node.height / 2 - size.height / 2;
                while (nodesRef.current.some((item) => item.id !== node.id && item.position.x < x + size.width && item.position.x + item.width > x && item.position.y < y + size.height && item.position.y + item.height > y)) y += size.height + 24;
                const child: CanvasNodeData = {
                    id,
                    type: CanvasNodeType.Image,
                    title: t(`canvas.videoFrames.${position}Title`, { name: node.title || t("assets.kinds.video") }),
                    position: { x, y },
                    ...size,
                    metadata: imageMetadata(image),
                };
                setNodes((prev) => [...prev, child]);
                setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: id }]);
                setSelectedNodeIds(new Set([id]));
                setSelectedConnectionId(null);
                setDialogNodeId(id);
                message.success(t("canvas.videoFrames.captured"));
            } catch {
                message.error(t("canvas.videoFrames.failed"));
            }
        },
        [message, t],
    );

    const extractAudioNode = useCallback(async (nodeId: string) => {
        setContextMenu(null);
        const node = nodesRef.current.find((item) => item.id === nodeId);
        if (node?.type !== CanvasNodeType.Video || !node.metadata?.content) return;
        try {
            const audio = await uploadMediaFile(await extractVideoAudio(node), "audio");
            const child = createCanvasNode(CanvasNodeType.Audio, { x: node.position.x + node.width / 2, y: node.position.y + node.height + 100 }, audioMetadata(audio));
            child.title = `${node.title || t("assets.kinds.video")} · ${t("canvas.node.audio")}`;
            setNodes((previous) => [...previous, child]);
            setConnections((previous) => [...previous, { id: nanoid(), fromNodeId: node.id, toNodeId: child.id }]);
            setSelectedNodeIds(new Set([child.id]));
            setSelectedConnectionId(null);
            message.success(t("canvas.videoFrames.audioExtracted"));
        } catch (error) {
            message.error(error instanceof Error && error.message === "no-audio-track" ? t("canvas.videoFrames.noAudioTrack") : t("canvas.videoFrames.extractAudioFailed"));
        }
    }, [message, t]);

    const saveNodeAsset = useCallback(
        async (node: CanvasNodeData) => {
            const confirmAsset = async () => {
                try {
                    await useAssetStore.getState().confirmSave();
                    message.success(t("common.addedToAssets"));
                } catch {
                    message.error(t("common.saveToLocalFailed"));
                }
            };
            if (node.type === CanvasNodeType.Text) {
                const content = node.metadata?.content?.trim();
                if (!content) return message.error(t("canvas.projectPage.noTextToSave"));
                addAsset({ kind: "text", title: node.metadata?.prompt?.slice(0, 24) || t("canvas.projectPage.canvasText"), coverUrl: "", tags: [], source: "Canvas", data: { content }, metadata: { source: "canvas", nodeId: node.id } });
                await confirmAsset();
                return;
            }
            if (node.type === CanvasNodeType.Video) {
                if (!node.metadata?.content) return message.error(t("canvas.projectPage.noVideoToSave"));
                addAsset({
                    kind: "video",
                    title: node.metadata?.prompt?.slice(0, 24) || t("canvas.projectPage.canvasVideo"),
                    coverUrl: "",
                    tags: [],
                    source: "Canvas",
                    data: { url: node.metadata.content, storageKey: node.metadata.storageKey, width: node.width, height: node.height, bytes: node.metadata.bytes || 0, mimeType: node.metadata.mimeType || "video/mp4" },
                    metadata: { source: "canvas", nodeId: node.id, prompt: node.metadata?.prompt },
                });
                await confirmAsset();
                return;
            }
            if (!node.metadata?.content) return message.error(t("canvas.projectPage.noImageToSave"));
            const dataUrl = node.metadata.storageKey ? "" : node.metadata.content;
            addAsset({
                kind: "image",
                title: node.metadata?.prompt?.slice(0, 24) || t("canvas.projectPage.canvasImage"),
                coverUrl: node.metadata.content,
                tags: [],
                source: "Canvas",
                data: {
                    dataUrl,
                    storageKey: node.metadata.storageKey,
                    width: node.metadata.naturalWidth || node.width,
                    height: node.metadata.naturalHeight || node.height,
                    bytes: node.metadata.bytes || getDataUrlByteSize(dataUrl),
                    mimeType: node.metadata.mimeType || "image/png",
                },
                metadata: { source: "canvas", nodeId: node.id, prompt: node.metadata?.prompt },
            });
            await confirmAsset();
        },
        [addAsset, message, t],
    );

    // 批量归档：剪辑台只读资产库，进剪辑台前把画布里的图片/视频一次性落成资产。
    const saveCanvasMediaToAssets = useCallback(async () => {
        const result = importCanvasMediaToAssets({
            canvasProjectId: projectId,
            nodes,
            selectedNodeIds,
            archivedNodeIds: archivedCanvasNodeIds(libraryAssets),
            addAsset,
        });
        try {
            await useAssetStore.getState().confirmSave();
        } catch {
            message.error(t("common.saveToLocalFailed"));
            return;
        }
        if (!result.imported) {
            message.info(result.skipped ? t("canvas.projectPage.assetsAlreadyArchived", { count: result.skipped }) : t("canvas.projectPage.noMediaToArchive"));
            return;
        }
        message.success(t("canvas.projectPage.archivedToAssets", { count: result.imported }));
    }, [addAsset, libraryAssets, message, nodes, projectId, selectedNodeIds, t]);

    const openEditingStudio = useCallback(() => {
        const params = new URLSearchParams({ from: projectId });
        if (currentProject?.title) params.set("title", currentProject.title);
        navigate(`/editing-studio?${params.toString()}`);
    }, [currentProject?.title, navigate, projectId]);

    const createImageReversePromptNodes = useCallback(
        (node: CanvasNodeData) => {
            if (node.type !== CanvasNodeType.Image || !node.metadata?.content) {
                message.warning(t("canvas.projectPage.emptyReverse"));
                return;
            }

            const gap = 96;
            const textSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
            const centerY = node.position.y + node.height / 2;
            const textNode = {
                ...createCanvasNode(CanvasNodeType.Text, { x: node.position.x + node.width + gap + textSpec.width / 2, y: centerY }, { prompt: t("canvas.projectPage.reversePreset") }),
                title: t("canvas.projectPage.reverseTitle"),
            };

            setNodes((prev) => [...prev, textNode]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: textNode.id }]);
            setSelectedNodeIds(new Set([textNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(textNode.id);
            setContextMenu(null);
        },
        [message, t],
    );

    const cropImageNode = useCallback(async (node: CanvasNodeData, crop: CanvasImageCropRect) => {
        if (!node.metadata?.content) return;
        const cropped = await cropDataUrl(node.metadata.content, crop);
        const image = await uploadImage(cropped);
        const width = Math.min(node.width, Math.max(220, image.width));
        const childId = nanoid();
        const child: CanvasNodeData = {
            id: childId,
            type: CanvasNodeType.Image,
            title: "Cropped Image",
            position: { x: node.position.x + node.width + 96, y: node.position.y },
            width,
            height: width * (image.height / image.width),
            metadata: {
                ...imageMetadata(image),
                prompt: node.metadata?.prompt,
            },
        };
        setNodes((prev) => [...prev, child]);
        setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
        setSelectedNodeIds(new Set([childId]));
        setDialogNodeId(childId);
        setCropNodeId(null);
    }, []);

    const splitImageNode = useCallback(
        async (node: CanvasNodeData, params: CanvasImageSplitParams) => {
            if (!node.metadata?.content) return;
            setSplitNodeId(null);
            const pieces = await splitDataUrl(node.metadata.content, params);
            const gap = 16;
            const cellWidth = node.width / params.columns;
            const cellHeight = node.height / params.rows;
            const startX = node.position.x + node.width + 96;
            const startY = node.position.y;
            const childNodes = await Promise.all(
                pieces.map(async (piece) => {
                    const image = await uploadImage(piece.dataUrl);
                    const id = nanoid();
                    return {
                        id,
                        type: CanvasNodeType.Image,
                        title: t("canvas.projectPage.splitTitle", { name: node.title || t("assets.kinds.image"), row: piece.row + 1, column: piece.column + 1 }),
                        position: { x: startX + piece.column * (cellWidth + gap), y: startY + piece.row * (cellHeight + gap) },
                        width: cellWidth,
                        height: cellHeight,
                        metadata: {
                            ...imageMetadata(image),
                            prompt: node.metadata?.prompt,
                        },
                    } satisfies CanvasNodeData;
                }),
            );
            setNodes((prev) => [...prev, ...childNodes]);
            setConnections((prev) => [...prev, ...childNodes.map((child) => ({ id: nanoid(), fromNodeId: node.id, toNodeId: child.id }))]);
            setSelectedNodeIds(new Set(childNodes.map((child) => child.id)));
            setSelectedConnectionId(null);
            setDialogNodeId(null);
            message.success(t("canvas.projectPage.splitSuccess", { count: childNodes.length }));
        },
        [message, t],
    );

    const maskEditImageNode = useCallback(
        async (node: CanvasNodeData, payload: CanvasImageMaskEditPayload) => {
            if (!node.metadata?.content) return;
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "image"), count: "1", size: node.metadata?.size || "auto" };
            if (payload.generate && !isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            const userPrompt = payload.prompt.trim();
            const prompt = t("canvas.projectPage.maskPrompt", { source: imageReferenceLabel(0), mask: imageReferenceLabel(1), prompt: userPrompt });
            setMaskEditNodeId(null);
            const maskImage = await uploadImage(payload.maskDataUrl);
            const maskNodeId = nanoid();
            const childId = nanoid();
            const source = { id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey };
            const maskSource = { id: maskNodeId, name: "mask.png", type: maskImage.mimeType || "image/png", dataUrl: maskImage.url, storageKey: maskImage.storageKey };
            const references = [source, maskSource];
            const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, references);
            const childMetadata = payload.generate ? { prompt, status: NODE_STATUS_LOADING, ...generationMetadata } : { prompt };
            setNodes((prev) => [
                ...prev,
                {
                    id: maskNodeId,
                    type: CanvasNodeType.Image,
                    title: t("canvas.projectPage.maskNodeTitle"),
                    position: { x: node.position.x, y: node.position.y + node.height + 96 },
                    width: node.width,
                    height: node.height,
                    metadata: imageMetadata(maskImage),
                },
                {
                    id: childId,
                    type: CanvasNodeType.Image,
                    title: userPrompt.slice(0, 32) || t("canvas.projectPage.maskResult"),
                    position: { x: node.position.x + node.width + 96, y: node.position.y },
                    width: node.width,
                    height: node.height,
                    metadata: childMetadata,
                },
            ]);
            setConnections((prev) => [
                ...prev,
                { id: nanoid(), fromNodeId: node.id, toNodeId: childId },
                { id: nanoid(), fromNodeId: maskNodeId, toNodeId: childId },
            ]);
            setSelectedNodeIds(new Set([childId]));
            setSelectedConnectionId(null);
            setDialogNodeId(childId);
            if (!payload.generate) return;
            setRunningNodeId(childId);
            const controller = startGenerationRequest(childId, node.id, childId);
            try {
                const image = await requestSingleImage(generationConfig, prompt, references, { signal: controller.signal });
                const uploaded = await uploadImage(image.dataUrl, { signal: controller.signal });
                const size = fitNodeSize(uploaded.width, uploaded.height, node.width, node.height);
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, width: size.width, height: size.height, metadata: { ...item.metadata, ...imageMetadata(uploaded), prompt, ...generationMetadata } } : item)));
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.maskFailed");
                message.error(errorDetails);
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails, retryBlocked: retryBlockedByError(error) || undefined } } : item)));
            } finally {
                finishGenerationRequest(childId, controller);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, startGenerationRequest, t],
    );

    const upscaleImageNode = useCallback(async (node: CanvasNodeData, params: CanvasImageUpscaleParams) => {
        if (!node.metadata?.content) return;
        setUpscaleNodeId(null);
        const upscaled = await upscaleDataUrl(node.metadata.content, params);
        const image = await uploadImage(upscaled);
        const size = fitNodeSize(image.width, image.height);
        const childId = nanoid();
        const child: CanvasNodeData = {
            id: childId,
            type: CanvasNodeType.Image,
            title: "Upscaled Image",
            position: { x: node.position.x + node.width + 96, y: node.position.y },
            width: size.width,
            height: size.height,
            metadata: {
                ...imageMetadata(image),
                prompt: node.metadata?.prompt,
            },
        };
        setNodes((prev) => [...prev, child]);
        setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
        setSelectedNodeIds(new Set([childId]));
        setDialogNodeId(childId);
    }, []);

    const superResolveImageNode = useCallback(async (node: CanvasNodeData) => {
        if (!node.metadata?.content) return;
        const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "image"), count: "1" };
        if (!isAiConfigReady(generationConfig, generationConfig.model)) {
            setSuperResolveNodeId(null);
            openConfigDialog(true);
            return;
        }
        setSuperResolveNodeId(null);
        const childId = nanoid();
        const prompt = t("canvas.projectPage.superResolvePrompt");
        const reference = [{ id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey }];
        const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, reference);
        setNodes((previous) => [...previous, {
            id: childId, type: CanvasNodeType.Image, title: t("canvas.projectPage.superResolveResult"),
            position: { x: node.position.x + node.width + 96, y: node.position.y }, width: node.width, height: node.height,
            metadata: { prompt, status: NODE_STATUS_LOADING, ...generationMetadata },
        }]);
        setConnections((previous) => [...previous, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
        setSelectedNodeIds(new Set([childId]));
        setSelectedConnectionId(null);
        setDialogNodeId(childId);
        setRunningNodeId(childId);
        const controller = startGenerationRequest(childId, node.id, childId);
        try {
            const result = await requestSingleImage(generationConfig, prompt, reference, { signal: controller.signal });
            const image = await uploadImage(result.dataUrl, { signal: controller.signal });
            const size = fitNodeSize(image.width, image.height, node.width, node.height);
            setNodes((previous) => previous.map((item) => item.id === childId ? { ...item, width: size.width, height: size.height, metadata: { ...item.metadata, ...imageMetadata(image), prompt, ...generationMetadata } } : item));
        } catch (error) {
            if (isGenerationCanceled(error)) return;
            const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
            message.error(errorDetails);
            setNodes((previous) => previous.map((item) => item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails, retryBlocked: retryBlockedByError(error) || undefined } } : item));
        } finally {
            finishGenerationRequest(childId, controller);
            setRunningNodeId(null);
        }
    }, [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, startGenerationRequest, t]);

    const generateAngleNode = useCallback(
        async (node: CanvasNodeData, params: CanvasImageAngleParams) => {
            if (!node.metadata?.content) return;
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "image"), count: "1" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            const childId = nanoid();
            const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
            const title = buildAngleLabel(params);
            const prompt = buildAnglePrompt(params);
            const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, [
                { id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey },
            ]);
            setAngleNodeId(null);
            setRunningNodeId(childId);
            setNodes((prev) => [
                ...prev,
                {
                    id: childId,
                    type: CanvasNodeType.Image,
                    title,
                    position: { x: node.position.x + node.width + 96, y: node.position.y },
                    width: imageConfig.width,
                    height: imageConfig.height,
                    metadata: { prompt, status: NODE_STATUS_LOADING, ...generationMetadata },
                },
            ]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
            setSelectedNodeIds(new Set([childId]));
            setDialogNodeId(childId);
            const controller = startGenerationRequest(childId, node.id, childId);
            try {
                const image = await requestSingleImage(
                    generationConfig,
                    prompt,
                    [{ id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey }],
                    { signal: controller.signal },
                );
                const uploaded = await uploadImage(image.dataUrl, { signal: controller.signal });
                const size = fitNodeSize(uploaded.width, uploaded.height, imageConfig.width, imageConfig.height);
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, width: size.width, height: size.height, metadata: { ...item.metadata, ...imageMetadata(uploaded), prompt, ...generationMetadata } } : item)));
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails, retryBlocked: retryBlockedByError(error) || undefined } } : item)));
            } finally {
                finishGenerationRequest(childId, controller);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, openConfigDialog, startGenerationRequest, t],
    );

    /**
     * 待确认生成的预估费用。只算「花钱的那几条」，按各自节点当前的张数算。
     * 任一模型没填单价就整体返回 null——报个小数比不报更糟。
     */
    const pendingAgentCost = useMemo(() => {
        const spend = pendingAgentPlan?.plan.pending.filter((verdict) => verdict.reason === "costs_money") ?? [];
        if (!spend.length) return null;
        let amount = 0;
        let currency: string | null = null;
        for (const verdict of spend) {
            const op = verdict.op;
            if (op.type !== "run_generation") continue;
            const target = nodes.find((node) => node.id === op.nodeId);
            const kind = op.mode ?? "image";
            // 音频没有按张计价的单价模型，估不出来就老实返回 null，不编号码。
            if (kind === "audio") return null;
            const config = buildGenerationConfig(effectiveConfig, target, kind);
            const pricing = findChannelModelPricing(config, config.model || config.imageModel);
            const count = Math.max(1, Number(config.count) || 1);
            const cost = estimateGenerationCost({ pricing, kind, outputCount: count, modelId: config.model });
            if (!cost) return null;
            amount += cost.amount;
            currency = currency ?? cost.currency;
        }
        return currency ? `${currency} ${amount.toFixed(2)}` : null;
    }, [pendingAgentPlan, nodes, effectiveConfig]);

    const generatePresetNode = useCallback(
        async (node: CanvasNodeData, presetId: ImagePresetId) => {
            if (!node.metadata?.content) return;
            const preset = resolveImagePreset(presetId);
            // 先收起预设框：配置没填完时不该让它压在配置弹窗底下。
            setPresetNodeId(null);
            // 尺寸由预设固定：三视图的等宽格子被渠道的 1:1 一压就变形，不能跟着节点设置走。
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "image"), count: "1", size: preset.size };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            const reference = [{ id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey }];
            const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
            const originX = node.position.x + node.width + 96;
            const stepY = imageConfig.height + 24;

            // 串行而不是并发：四张同时发容易撞厂商限流，账单也不好看清是哪张失败。
            for (const [index, prompt] of preset.prompts.entries()) {
                const childId = nanoid();
                const title = preset.prompts.length > 1 ? `${preset.title} ${index + 1}` : preset.title;
                const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, reference);
                setNodes((prev) => [
                    ...prev,
                    {
                        id: childId,
                        type: CanvasNodeType.Image,
                        title,
                        position: { x: originX, y: node.position.y + index * stepY },
                        width: imageConfig.width,
                        height: imageConfig.height,
                        metadata: { prompt, status: NODE_STATUS_LOADING, ...generationMetadata },
                    },
                ]);
                setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
                setSelectedNodeIds(new Set([childId]));
                const controller = startGenerationRequest(childId, node.id, childId);
                setRunningNodeId(childId);
                try {
                    const image = await requestSingleImage(generationConfig, prompt, reference, { signal: controller.signal });
                    const uploaded = await uploadImage(image.dataUrl, { signal: controller.signal });
                    const size = fitNodeSize(uploaded.width, uploaded.height, imageConfig.width, imageConfig.height);
                    setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, width: size.width, height: size.height, metadata: { ...item.metadata, ...imageMetadata(uploaded), prompt, ...generationMetadata } } : item)));
                } catch (error) {
                    // 用户取消就停手：后面几张还没买，不该继续花。
                    if (isGenerationCanceled(error)) break;
                    const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                    setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails, retryBlocked: retryBlockedByError(error) || undefined } } : item)));
                } finally {
                    finishGenerationRequest(childId, controller);
                    setRunningNodeId(null);
                }
            }
        },
        [effectiveConfig, finishGenerationRequest, openConfigDialog, startGenerationRequest, t],
    );

    const handleFontSizeChange = useCallback((nodeId: string, fontSize: number) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, fontSize } } : node)));
    }, []);

    const handleUploadRequest = useCallback((nodeId?: string, position?: Position) => {
        uploadTargetRef.current = { nodeId, position };
        imageInputRef.current?.click();
    }, []);

    const handleImageInputChange = useCallback(
        async (event: ReactChangeEvent<HTMLInputElement>) => {
            const files = Array.from(event.target.files || []).filter(
                (f) => f.type.startsWith("image/") || f.type.startsWith("video/") || isAudioFile(f),
            );
            if (!files.length) {
                uploadTargetRef.current = null;
                event.target.value = "";
                return;
            }

            const target = uploadTargetRef.current;
            const basePosition =
                target?.position ||
                screenToCanvas(
                    (containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2,
                    (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2,
                );
            const STAGGER = 40; // Offset between multiple imported files.

            // When replacing a target node, use the first file as the replacement and create the rest nearby.
            if (target?.nodeId) {
                const [first, ...rest] = files;

                // Replace the target node with the first file.
                if (isAudioFile(first)) {
                    const audio = await uploadMediaFile(first, "audio");
                    const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.id === target.nodeId
                                ? {
                                      ...node,
                                      type: CanvasNodeType.Audio,
                                      title: first.name,
                                      position: { x: node.position.x + node.width / 2 - spec.width / 2, y: node.position.y + node.height / 2 - spec.height / 2 },
                                      width: spec.width,
                                      height: spec.height,
                                      metadata: { ...node.metadata, ...audioMetadata(audio), errorDetails: undefined },
                                  }
                                : node,
                        ),
                    );
                    setSelectedNodeIds(new Set([target.nodeId]));
                    setSelectedConnectionId(null);
                } else if (first.type.startsWith("video/")) {
                    const video = await uploadMediaFile(first, "video");
                    const nextSize = fitNodeSize(video.width || 1280, video.height || 720, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.id === target.nodeId
                                ? {
                                      ...node,
                                      type: CanvasNodeType.Video,
                                      title: first.name,
                                      position: { x: node.position.x + node.width / 2 - nextSize.width / 2, y: node.position.y + node.height / 2 - nextSize.height / 2 },
                                      width: nextSize.width,
                                      height: nextSize.height,
                                      metadata: { ...node.metadata, ...videoMetadata(video), errorDetails: undefined },
                                  }
                                : node,
                        ),
                    );
                    setSelectedNodeIds(new Set([target.nodeId]));
                    setSelectedConnectionId(null);
                } else {
                    const image = await uploadImage(first);
                    const s = fitNodeSize(image.width, image.height);
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.id === target.nodeId
                                ? {
                                      ...node,
                                      type: CanvasNodeType.Image,
                                      title: first.name,
                                      width: s.width,
                                      height: s.height,
                                      metadata: {
                                          ...node.metadata,
                                          ...imageMetadata(image),
                                          errorDetails: undefined,
                                          freeResize: false,
                                          images: undefined,
                                          generationType: undefined,
                                          model: undefined,
                                          size: undefined,
                                          quality: undefined,
                                          count: undefined,
                                          references: undefined,
                                          primaryImageId: undefined,
                                      },
                                  }
                                : node,
                        ),
                    );
                    setSelectedNodeIds(new Set([target.nodeId]));
                    setSelectedConnectionId(null);
                }

                // Create the remaining files near the target node.
                for (let i = 0; i < rest.length; i++) {
                    const offsetPos = { x: basePosition.x + (i + 1) * STAGGER, y: basePosition.y + (i + 1) * STAGGER };
                    const f = rest[i];
                    if (isAudioFile(f)) {
                        void createAudioFileNode(f, offsetPos);
                    } else if (f.type.startsWith("video/")) {
                        void createVideoFileNode(f, offsetPos);
                    } else {
                        void createImageFileNode(f, offsetPos);
                    }
                }
            } else {
                // Without a replacement target, create all files near the canvas center.
                for (let i = 0; i < files.length; i++) {
                    const offsetPos = { x: basePosition.x + i * STAGGER, y: basePosition.y + i * STAGGER };
                    const f = files[i];
                    if (isAudioFile(f)) {
                        void createAudioFileNode(f, offsetPos);
                    } else if (f.type.startsWith("video/")) {
                        void createVideoFileNode(f, offsetPos);
                    } else {
                        void createImageFileNode(f, offsetPos);
                    }
                }
            }

            uploadTargetRef.current = null;
            event.target.value = "";
        },
        [createAudioFileNode, createImageFileNode, createVideoFileNode, screenToCanvas, size.height, size.width],
    );

    const handleDrop = useCallback(
        (event: ReactDragEvent<HTMLDivElement>) => {
            event.preventDefault();
            const files = Array.from(event.dataTransfer.files).filter(
                (item) => item.type.startsWith("image/") || item.type.startsWith("video/") || isAudioFile(item),
            );
            if (!files.length) return;

            const basePos = screenToCanvas(event.clientX, event.clientY);
            const STAGGER = 40;
            for (let i = 0; i < files.length; i++) {
                const pos = { x: basePos.x + i * STAGGER, y: basePos.y + i * STAGGER };
                const f = files[i];
                if (isAudioFile(f)) {
                    void createAudioFileNode(f, pos);
                } else if (f.type.startsWith("video/")) {
                    void createVideoFileNode(f, pos);
                } else {
                    void createImageFileNode(f, pos);
                }
            }
        },
        [createAudioFileNode, createImageFileNode, createVideoFileNode, screenToCanvas],
    );

    const startTitleEditing = useCallback(() => {
        setTitleDraft(currentProject?.title || t("canvas.projectPage.untitledCanvas"));
        setTitleEditing(true);
    }, [currentProject?.title, t]);

    const finishTitleEditing = useCallback(() => {
        const nextTitle = titleDraft.trim();
        if (nextTitle) renameProject(projectId, nextTitle);
        setTitleEditing(false);
    }, [projectId, renameProject, titleDraft]);

    const openCanvasContextMenu = useCallback((event: ReactMouseEvent) => {
        if (event.target instanceof Element && event.target.closest("[data-node-id],[data-connection-id],[data-canvas-no-zoom]")) return;
        event.preventDefault();
        if (referencePickerNodeId) return;
        setNodeCreatePosition(null);
        cancelPendingConnectionCreate();
        setContextMenu({ type: "canvas", x: event.clientX, y: event.clientY, position: screenToCanvas(event.clientX, event.clientY) });
    }, [cancelPendingConnectionCreate, referencePickerNodeId, screenToCanvas]);

    const handleGenerateNode = useCallback(
        async (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => {
            if (chainRunRef.current) return;
            const sourceNode = nodesRef.current.find((node) => node.id === nodeId);
            if (sourceNode && hasResumableImageTask(sourceNode)) {
                await pollComfyImageNode(sourceNode);
                return;
            }
            if (sourceNode?.metadata?.retryBlocked) {
                message.warning(t("canvas.node.retryBlockedHint"));
                return;
            }
            const generationConfig = buildGenerationConfig(effectiveConfig, sourceNode, mode);
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                message.warning(t("workbench.configFirst")); // 只弹配置窗口时，看不出是点「生成」触发的。
                return openConfigDialog(true);
            }

            // useBuiltinPanel.writeBackToSelf reuses built-in generation while writing the result back to the plugin node.
            // Image mode currently supports display-only nodes such as panoramas, with a useBuiltinPanel.promptPrefix.
            const builtinPanel = sourceNode ? getNodeDefinition(sourceNode.type)?.useBuiltinPanel : undefined;
            if (sourceNode && builtinPanel?.writeBackToSelf && builtinPanel.mode === "image") {
                const scene = prompt.trim();
                if (!scene) return;
                setRunningNodeId(nodeId);
                const controller = startGenerationRequest(nodeId, nodeId, nodeId);
                setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, prompt: scene, status: NODE_STATUS_LOADING, errorDetails: undefined } } : node)));
                try {
                    const fullPrompt = (builtinPanel.promptPrefix || "") + scene;
                    const context = await hydrateNodeGenerationContext(buildNodeGenerationContext(nodeId, nodesRef.current, connectionsRef.current, fullPrompt));
                    const refs = context.referenceImages;
                    const image = await requestSingleImage({ ...generationConfig, count: "1" }, context.prompt, refs, { signal: controller.signal });
                    const uploaded = await uploadImage(image.dataUrl, { signal: controller.signal });
                    setNodes((prev) =>
                        prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, ...imageMetadata(uploaded), prompt: scene, model: generationConfig.model, status: NODE_STATUS_SUCCESS, errorDetails: undefined } } : node)),
                    );
                    setDialogNodeId(null);
                } catch (error) {
                    if (!isGenerationCanceled(error)) {
                        const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                        message.error(errorDetails);
                        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails, retryBlocked: retryBlockedByError(error) || undefined } } : node)));
                    }
                } finally {
                    finishGenerationRequest(nodeId, controller);
                }
                return;
            }

            setRunningNodeId(nodeId);
            const overwriteExisting = effectiveConfig.nodeRegenerateBehavior === "overwrite";
            const runController = startGenerationRequest(nodeId, nodeId, nodeId);
            const sourceTextContent = sourceNode?.type === CanvasNodeType.Text ? sourceNode.metadata?.content?.trim() || "" : "";
            const editingTextNode = mode === "text" && Boolean(sourceTextContent);
            const generationConnections = connectionsRef.current;
            const generationContext = await hydrateNodeGenerationContext(
                buildNodeGenerationContext(nodeId, nodesRef.current, generationConnections, editingTextNode ? t("canvas.projectPage.editTextPrompt", { source: sourceTextContent, prompt }) : prompt),
            );
            const effectivePrompt = generationContext.prompt.trim();
            if (runController.signal.aborted) {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
                return;
            }
            if (!effectivePrompt && (mode === "text" || mode === "audio")) {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
                return;
            }
            let pendingChildIds: string[] = [];

            try {
                if (mode === "image") {
                    const imageTaskId = isLocalComfyImageWorkflow(generationConfig) ? `image_${nanoid()}` : undefined;
                    const count = getGenerationCount(generationConfig.count);
                    const isImageNode = sourceNode?.type === CanvasNodeType.Image;
                    const isEmptyImageNode = isImageNode && !sourceNode?.metadata?.content;
                    const reuseImageNode = isImageNode && (overwriteExisting || isEmptyImageNode);
                    const versionPlan = reuseImageNode ? prepareMediaGenerationVersion(nodesRef.current, nodeId, nanoid()) : null;
                    const preserveWorkflowReferences = Boolean(modelWorkflowOf(generationConfig, generationConfig.model) && generationContext.referenceImages.length);
                    const sourceReference =
                        isImageNode && sourceNode?.metadata?.content && !overwriteExisting && !preserveWorkflowReferences
                            ? [{ id: sourceNode.id, name: `${sourceNode.title || sourceNode.id}.png`, type: sourceNode.metadata.mimeType || "image/png", dataUrl: sourceNode.metadata.content, storageKey: sourceNode.metadata.storageKey }]
                            : [];
                    const referenceImages = [...new Map([...sourceReference, ...generationContext.referenceImages].map((image) => [image.id, image])).values()];
                    const generationType = referenceImages.length ? ("edit" as const) : ("generation" as const);
                    const generationMetadata = buildImageGenerationMetadata(generationType, generationConfig, count, referenceImages);
                    const parentSize = { width: sourceNode?.width || NODE_DEFAULT_SIZE[CanvasNodeType.Image].width, height: sourceNode?.height || NODE_DEFAULT_SIZE[CanvasNodeType.Image].height };
                    const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
                    const parentPosition = sourceNode?.position || { x: 0, y: 0 };
                    const rootId = reuseImageNode ? nodeId : nanoid();
                    const imageIds = Array.from({ length: count }, () => nanoid());
                    pendingChildIds = [rootId];
                    const rootNode: CanvasNodeData = {
                        id: rootId,
                        type: CanvasNodeType.Image,
                        title: effectivePrompt.slice(0, 32) || "Generated Image",
                        position: {
                            x: reuseImageNode ? parentPosition.x : parentPosition.x + parentSize.width + 96,
                            y: parentPosition.y + parentSize.height / 2 - imageConfig.height / 2,
                        },
                        width: reuseImageNode ? sourceNode?.width || imageConfig.width : imageConfig.width,
                        height: reuseImageNode ? sourceNode?.height || imageConfig.height : imageConfig.height,
                        metadata: {
                            prompt: effectivePrompt,
                            status: NODE_STATUS_LOADING,
                            retrySourceId: nodeId,
                            inputPrompt: prompt,
                            ...(preserveWorkflowReferences ? { composerContent: prompt } : {}),
                            images: imageIds.map((id) => ({ id, status: NODE_STATUS_LOADING, content: "", naturalWidth: 0, naturalHeight: 0, bytes: 0, mimeType: "" })),
                            primaryImageId: undefined,
                            ...generationMetadata,
                            ...(versionPlan?.currentMetadata || {}),
                            imageTaskId,
                        },
                    };

                    const placeRoot = (prev: CanvasNodeData[]) => [
                        ...(versionPlan ? versionPlan.nodes : prev).map((node) =>
                            node.id === nodeId && reuseImageNode
                                ? {
                                      ...node,
                                      position: rootNode.position,
                                      width: rootNode.width,
                                      height: rootNode.height,
                                      title: rootNode.title,
                                      metadata: { ...node.metadata, ...rootNode.metadata, content: undefined, storageKey: undefined, naturalWidth: undefined, naturalHeight: undefined, bytes: undefined, mimeType: undefined, errorDetails: undefined },
                                  }
                                : node,
                        ),
                        ...(reuseImageNode ? [] : [rootNode]),
                    ];
                    // Copy the inputs in submission order so the child resolves the same image labels.
                    const rootConnections = reuseImageNode ? [] : preserveWorkflowReferences
                        ? generationConnections.filter((edge) => edge.toNodeId === nodeId).map((edge) => ({ id: nanoid(), fromNodeId: edge.fromNodeId, toNodeId: rootId }))
                        : [{ id: nanoid(), fromNodeId: nodeId, toNodeId: rootId }];
                    const withRootConnections = (prev: CanvasConnection[]) => rootConnections.length ? [...prev, ...rootConnections] : prev;
                    if (imageTaskId) {
                        const nextNodes = placeRoot(nodesRef.current);
                        const nextConnections = withRootConnections(connectionsRef.current);
                        nodesRef.current = nextNodes;
                        connectionsRef.current = nextConnections;
                        setNodes(nextNodes);
                        setConnections(nextConnections);
                    } else {
                        setNodes(placeRoot);
                        if (rootConnections.length) setConnections(withRootConnections);
                    }
                    setSelectedNodeIds(new Set([nodeId]));
                    setSelectedConnectionId(null);
                    setDialogNodeId(nodeId);

                    const controller = rootId === nodeId ? runController : startGenerationRequest(rootId, nodeId, nodeId, runController);
                    if (imageTaskId) {
                        try {
                            const store = useCanvasStore.getState();
                            store.updateProject(projectId, { nodes: nodesRef.current, connections: connectionsRef.current });
                            await store.confirmSave();
                            controller.signal.throwIfAborted();
                            await submitComfyImageTask(generationConfig, imageTaskId, effectivePrompt, referenceImages, controller.signal);
                            await completeComfyImageNode(rootId, generationConfig, imageTaskId, controller.signal);
                        } finally {
                            if (rootId !== nodeId) finishGenerationRequest(rootId, controller);
                        }
                        return;
                    }
                    let hasSuccess = false;
                    let hasFailure = false;
                    let hasConfirm = false;
                    let firstError = "";
                    await runImageSlots({
                        count: imageIds.length,
                        submit: async (index) => {
                            const imageId = imageIds[index];
                            const image = await requestSingleImage({ ...generationConfig, count: "1" }, effectivePrompt, referenceImages, { signal: controller.signal });
                            const uploaded = await uploadImage(image.dataUrl, { signal: controller.signal });
                            const imageSize = fitNodeSize(uploaded.width, uploaded.height, imageConfig.width, imageConfig.height);
                            const item: CanvasNodeImage = { id: imageId, status: NODE_STATUS_SUCCESS, content: uploaded.url, storageKey: uploaded.storageKey, naturalWidth: uploaded.width, naturalHeight: uploaded.height, bytes: uploaded.bytes, mimeType: uploaded.mimeType };
                            setNodes((prev) =>
                                prev.map((node) => {
                                    if (node.id !== rootId) return node;
                                    const images = node.metadata?.images?.map((image) => (image.id === imageId ? item : image)) || [];
                                    if (node.metadata?.primaryImageId) return { ...node, metadata: { ...node.metadata, images } };
                                    const center = { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 };
                                    return {
                                        ...node,
                                        position: { x: center.x - imageSize.width / 2, y: center.y - imageSize.height / 2 },
                                        ...imageSize,
                                        metadata: {
                                            ...node.metadata,
                                            content: item.content,
                                            storageKey: item.storageKey,
                                            naturalWidth: item.naturalWidth,
                                            naturalHeight: item.naturalHeight,
                                            bytes: item.bytes,
                                            mimeType: item.mimeType,
                                            images,
                                            primaryImageId: imageId,
                                        },
                                    };
                                }),
                            );
                            return imageId;
                        },
                        onSettled: (outcome) => {
                            if (outcome.ok) {
                                hasSuccess = true;
                                return;
                            }
                            if (isGenerationCanceled(outcome.error)) return;
                            const errorDetails = outcome.error instanceof Error ? outcome.error.message : t("canvas.projectPage.generationFailed");
                            if (!firstError) firstError = errorDetails;
                            hasFailure = true;
                            if (retryBlockedByError(outcome.error)) hasConfirm = true;
                            const imageId = imageIds[outcome.index];
                            setNodes((prev) => prev.map((node) => (node.id === rootId ? { ...node, metadata: { ...node.metadata, images: node.metadata?.images?.map((image) => (image.id === imageId ? { ...image, status: NODE_STATUS_ERROR, errorDetails } : image)) } } : node)));
                        },
                    });
                    if (rootId !== nodeId) finishGenerationRequest(rootId, controller);
                    if (controller.signal.aborted) return;
                    if (hasFailure) {
                        message.error(hasSuccess ? t("canvas.projectPage.partialFailed") : firstError || t("canvas.projectPage.generationFailed"));
                    }
                    setNodes((prev) =>
                        prev.map((node) => (node.id === rootId ? { ...node, metadata: { ...node.metadata, status: hasSuccess ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR, errorDetails: hasSuccess ? undefined : t("canvas.projectPage.allFailed"), retryBlocked: hasSuccess ? undefined : hasConfirm || undefined } } : node)),
                    );
                    return;
                }

                if (mode === "video") {
                    const spec = nodeSizeFromRatio(generationConfig.size, NODE_DEFAULT_SIZE[CanvasNodeType.Video].width, NODE_DEFAULT_SIZE[CanvasNodeType.Video].height) || NODE_DEFAULT_SIZE[CanvasNodeType.Video];
                    const isEmptyVideoNode = sourceNode?.type === CanvasNodeType.Video && !sourceNode.metadata?.content;
                    const reuseVideoNode = sourceNode?.type === CanvasNodeType.Video && (overwriteExisting || isEmptyVideoNode);
                    const videoId = reuseVideoNode ? nodeId : nanoid();
                    const parent = sourceNode?.position || { x: 0, y: 0 };
                    const videoNode: CanvasNodeData = {
                        id: videoId,
                        type: CanvasNodeType.Video,
                        title: effectivePrompt.slice(0, 32) || "Generated Video",
                        position: reuseVideoNode ? sourceNode.position : { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y },
                        width: reuseVideoNode ? sourceNode.width : spec.width,
                        height: reuseVideoNode ? sourceNode.height : spec.height,
                        metadata: {
                            prompt: effectivePrompt,
                            status: NODE_STATUS_LOADING,
                            retrySourceId: nodeId,
                            inputPrompt: prompt,
                            model: generationConfig.model,
                            size: generationConfig.size,
                            seconds: generationConfig.videoSeconds,
                            vquality: generationConfig.vquality,
                            generateAudio: generationConfig.videoGenerateAudio,
                            watermark: generationConfig.videoWatermark,
                            videoMode: generationConfig.videoMode,
                            references: generationReferenceUrls(generationContext),
                        },
                    };
                    pendingChildIds = [videoId];
                    setNodes((prev) =>
                        reuseVideoNode
                            ? prev.map((node) => (node.id === nodeId ? { ...node, ...videoNode } : node))
                            : [...prev, videoNode],
                    );
                    if (!reuseVideoNode) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: videoId }]);
                    const controller = startGenerationRequest(videoId, nodeId, nodeId, runController);
                    try {
                        await completeVideoNodeTask(videoId, generationConfig, effectivePrompt, generationContext.referenceImages, controller.signal, {
                            size: generationConfig.size,
                            seconds: generationConfig.videoSeconds,
                            vquality: generationConfig.vquality,
                            generateAudio: generationConfig.videoGenerateAudio,
                            watermark: generationConfig.videoWatermark,
                            videoMode: generationConfig.videoMode,
                            references: generationReferenceUrls(generationContext),
                        }, generationContext.referenceVideos, generationContext.referenceAudios);
                    } finally {
                        finishGenerationRequest(videoId, controller);
                    }
                    return;
                }

                if (mode === "audio") {
                    const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
                    const isEmptyAudioNode = sourceNode?.type === CanvasNodeType.Audio && !sourceNode.metadata?.content;
                    const reuseAudioNode = sourceNode?.type === CanvasNodeType.Audio && (overwriteExisting || isEmptyAudioNode);
                    const audioId = reuseAudioNode ? nodeId : nanoid();
                    const parent = sourceNode?.position || { x: 0, y: 0 };
                    const audioNode: CanvasNodeData = {
                        id: audioId,
                        type: CanvasNodeType.Audio,
                        title: effectivePrompt.slice(0, 32) || "Generated Audio",
                        position: reuseAudioNode ? sourceNode.position : { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y + ((sourceNode?.height || spec.height) - spec.height) / 2 },
                        width: reuseAudioNode ? sourceNode.width : spec.width,
                        height: reuseAudioNode ? sourceNode.height : spec.height,
                        metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, retrySourceId: nodeId, inputPrompt: prompt, ...buildAudioGenerationMetadata(generationConfig) },
                    };
                    pendingChildIds = [audioId];
                    setNodes((prev) =>
                        reuseAudioNode
                            ? prev.map((node) => (node.id === nodeId ? { ...node, ...audioNode } : node))
                            : [...prev, audioNode],
                    );
                    if (!reuseAudioNode) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: audioId }]);
                    const controller = startGenerationRequest(audioId, nodeId, nodeId, runController);
                    try {
                        const audio = await storeGeneratedAudio(await requestAudioGeneration(generationConfig, effectivePrompt, { signal: controller.signal }), generationConfig.audioFormat);
                        setNodes((prev) => prev.map((node) => (node.id === audioId ? { ...node, metadata: { ...node.metadata, ...audioMetadata(audio), prompt: effectivePrompt, ...buildAudioGenerationMetadata(generationConfig) } } : node)));
                    } finally {
                        finishGenerationRequest(audioId, controller);
                    }
                    return;
                }

                const textCount = getGenerationCount(String(sourceNode?.metadata?.textCount || 1));
                const textConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
                const parentSize = { width: sourceNode?.width || textConfig.width, height: sourceNode?.height || textConfig.height };
                const parentPosition = sourceNode?.position || { x: 0, y: 0 };
                const isEmptyTextNode = sourceNode?.type === CanvasNodeType.Text && !sourceTextContent;
                const reuseTextNode = sourceNode?.type === CanvasNodeType.Text && (overwriteExisting || isEmptyTextNode);
                const rootId = reuseTextNode ? nodeId : nanoid();
                const textIds = Array.from({ length: textCount }, () => nanoid());
                const rootNode: CanvasNodeData = {
                    id: rootId,
                    type: CanvasNodeType.Text,
                    title: effectivePrompt.slice(0, 32) || "Generated Text",
                    position: reuseTextNode ? sourceNode.position : { x: parentPosition.x + parentSize.width + 96, y: parentPosition.y + parentSize.height / 2 - textConfig.height / 2 },
                    width: reuseTextNode ? sourceNode.width : textConfig.width,
                    height: reuseTextNode ? sourceNode.height : textConfig.height,
                    metadata: {
                        prompt: effectivePrompt,
                        status: NODE_STATUS_LOADING,
                        retrySourceId: nodeId,
                        inputPrompt: prompt,
                        fontSize: 14,
                        model: generationConfig.model,
                        reasoningEffort: generationConfig.reasoningEffort,
                        textCount,
                        texts: textIds.map((id) => ({ id, status: NODE_STATUS_LOADING, content: "" })),
                        primaryTextId: textIds[0],
                    },
                };
                pendingChildIds = [rootId];
                setNodes((prev) =>
                    reuseTextNode
                        ? prev.map((node) => (node.id === nodeId ? { ...node, ...rootNode } : node))
                        : [...prev, rootNode],
                );
                if (!reuseTextNode) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: rootId }]);
                setSelectedNodeIds(new Set([nodeId]));
                setSelectedConnectionId(null);
                setDialogNodeId(nodeId);

                const controller = rootId === nodeId ? runController : startGenerationRequest(rootId, nodeId, nodeId, runController);
                const results = await Promise.all(
                    textIds.map(async (textId): Promise<CanvasNodeText | null> => {
                        let streamed = "";
                        try {
                            const answer = await requestImageQuestion(
                                generationConfig,
                                buildNodeResponseMessages({ ...generationContext, prompt: effectivePrompt }),
                                (text) => {
                                    streamed = text;
                                    setNodes((prev) =>
                                        prev.map((node) =>
                                            node.id === rootId
                                                ? {
                                                      ...node,
                                                      metadata: {
                                                          ...node.metadata,
                                                          ...(node.metadata?.primaryTextId === textId ? { content: text } : {}),
                                                          texts: node.metadata?.texts?.map((item) => (item.id === textId ? { ...item, content: text } : item)),
                                                      },
                                                  }
                                                : node,
                                        ),
                                    );
                                },
                                { signal: controller.signal },
                            );
                            const content = answer || streamed;
                            setNodes((prev) =>
                                prev.map((node) =>
                                    node.id === rootId
                                        ? {
                                              ...node,
                                              metadata: {
                                                  ...node.metadata,
                                                  ...(node.metadata?.primaryTextId === textId ? { content } : {}),
                                                  texts: node.metadata?.texts?.map((item) => (item.id === textId ? { ...item, content, status: NODE_STATUS_SUCCESS } : item)),
                                              },
                                          }
                                        : node,
                                ),
                            );
                            return { id: textId, status: NODE_STATUS_SUCCESS, content } satisfies CanvasNodeText;
                        } catch (error) {
                            if (isGenerationCanceled(error)) return null;
                            const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                            setNodes((prev) => prev.map((node) => (node.id === rootId ? { ...node, metadata: { ...node.metadata, texts: node.metadata?.texts?.map((item) => (item.id === textId ? { ...item, status: NODE_STATUS_ERROR, errorDetails } : item)) } } : node)));
                            return { id: textId, status: NODE_STATUS_ERROR, content: "", errorDetails } satisfies CanvasNodeText;
                        }
                    }),
                );
                if (rootId !== nodeId) finishGenerationRequest(rootId, controller);
                if (controller.signal.aborted) return;
                const completedTexts = results.flatMap((item) => (item?.status === NODE_STATUS_SUCCESS ? [item] : []));
                const failedTexts = results.filter((item) => item?.status === NODE_STATUS_ERROR);
                const firstText = completedTexts[0];
                if (completedTexts.length <= 1) setExpandedBatchNodeIds((current) => new Set([...current].filter((id) => id !== rootId)));
                if (failedTexts.length) message.error(firstText ? t("canvas.projectPage.partialTextFailed") : failedTexts[0]?.errorDetails || t("canvas.projectPage.generationFailed"));
                setNodes((prev) =>
                    prev.map((node) => {
                        if (node.id === rootId) {
                            const primaryText = completedTexts.find((text) => text.id === node.metadata?.primaryTextId) || firstText;
                            return {
                                ...node,
                                metadata: {
                                    ...node.metadata,
                                    content: primaryText?.content || "",
                                    texts: completedTexts,
                                    primaryTextId: primaryText?.id,
                                    status: primaryText ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR,
                                    errorDetails: primaryText ? undefined : t("canvas.projectPage.generationFailed"),
                                },
                            };
                        }
                        return node;
                    }),
                );
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                message.error(errorDetails);
                setNodes((prev) =>
                    prev.map((node) =>
                        pendingChildIds.includes(node.id)
                            ? {
                                  ...node,
                                  metadata: {
                                      ...node.metadata,
                                      status: NODE_STATUS_ERROR,
                                      errorDetails,
                                      retryBlocked: retryBlockedByError(error) || undefined,
                                      ...(error instanceof ComfyImageTaskFailed ? { imageTaskId: undefined } : {}),
                                      ...(isVideoTaskFailed(error) && node.type === CanvasNodeType.Video ? { videoTaskId: undefined } : {}),
                                  },
                              }
                            : node,
                    ),
                );
            } finally {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId((current) => current === nodeId ? null : current);
            }
        },
        [completeComfyImageNode, completeVideoNodeTask, effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, pollComfyImageNode, projectId, startGenerationRequest, t],
    );
    useEffect(() => {
        generateNodeRef.current = handleGenerateNode;
    }, [handleGenerateNode]);

    const handleRetryNode = useCallback(
        async (node: CanvasNodeData, imageId?: string) => {
            if (chainRunRef.current) return;
            if (hasResumableImageTask(node)) {
                await pollComfyImageNode(node);
                return;
            }
            if (hasResumableVideoTask(node)) {
                await pollVideoNodeTask(node);
                return;
            }
            // 这一单可能已经收单：重试等于新提交一张、再扣一次钱，旧单只能去任务中心核对任务号。
            if (node.metadata?.retryBlocked) {
                message.warning(t("canvas.node.retryBlockedHint"));
                return;
            }
            // 结果节点记录发起生成的源节点（没有记录时回退到直接上游），取它的模型/尺寸与上游参考。
            const retrySourceId = typeof node.metadata?.retrySourceId === "string" ? node.metadata.retrySourceId : undefined;
            const sourceId = retrySourceId || connectionsRef.current.find((connection) => connection.toNodeId === node.id)?.fromNodeId;
            const sourceNode = (sourceId ? nodesRef.current.find((item) => item.id === sourceId) : undefined) || node;
            const savedImageMetadata = node.type === CanvasNodeType.Image ? node.metadata : undefined;
            const hasSavedImageMetadata = Boolean(savedImageMetadata?.generationType);
            const generationConfig =
                hasSavedImageMetadata && savedImageMetadata
                    ? {
                          ...effectiveConfig,
                          model: savedImageMetadata.model || effectiveConfig.imageModel || effectiveConfig.model,
                          quality: savedImageMetadata.quality || effectiveConfig.quality,
                          size: savedImageMetadata.size || effectiveConfig.size,
                          background: savedImageMetadata.background ?? effectiveConfig.background,
                          count: "1",
                      }
                    : { ...buildGenerationConfig(effectiveConfig, sourceNode, node.type === CanvasNodeType.Text ? "text" : node.type === CanvasNodeType.Video ? "video" : node.type === CanvasNodeType.Audio ? "audio" : "image"), count: "1" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }

            const inputPrompt = typeof node.metadata?.inputPrompt === "string" ? node.metadata.inputPrompt : "";
            const context = hasSavedImageMetadata ? null : await hydrateNodeGenerationContext(buildNodeGenerationContext(sourceNode.id, nodesRef.current, connectionsRef.current, inputPrompt || node.metadata?.prompt || sourceNode.metadata?.prompt || ""));
            const prompt = (savedImageMetadata?.prompt || context?.prompt || "").trim();
            if (!prompt) {
                message.warning(t("canvas.projectPage.retryPromptMissing"));
                return;
            }
            const generationType = savedImageMetadata?.generationType;
            const useReferenceImages = generationType ? generationType === "edit" : Boolean(context?.referenceImages.length);
            const retryReferenceImages =
                hasSavedImageMetadata && savedImageMetadata ? await resolveMetadataReferences(savedImageMetadata) : useReferenceImages ? (context?.referenceImages.length ? context.referenceImages : sourceNodeReferenceImages(sourceNode)) : [];
            if (useReferenceImages && !retryReferenceImages) {
                message.error(t("canvas.projectPage.referenceMissing"));
                setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: item.metadata?.content ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR, errorDetails: item.metadata?.content ? undefined : t("canvas.projectPage.referenceMissing"), images: item.metadata?.images?.map((image) => (image.id === imageId ? { ...image, status: NODE_STATUS_ERROR, errorDetails: t("canvas.projectPage.referenceMissing") } : image)) } } : item)));
                return;
            }
            const retryImages = retryReferenceImages || [];

            setRunningNodeId(node.id);
            setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_LOADING, errorDetails: undefined, images: item.metadata?.images?.map((image) => (image.id === imageId ? { ...image, status: NODE_STATUS_LOADING, errorDetails: undefined } : image)) } } : item)));
            const controller = startGenerationRequest(node.id, sourceNode.id, node.id);

            try {
                if (node.type === CanvasNodeType.Text) {
                    if (!context) return;
                    let streamed = "";
                    const answer = await requestImageQuestion(
                        generationConfig,
                        buildNodeResponseMessages({ ...context, prompt }),
                        (text) => {
                            streamed = text;
                            setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, type: CanvasNodeType.Text, metadata: { ...item.metadata, content: text, status: NODE_STATUS_LOADING } } : item)));
                        },
                        { signal: controller.signal },
                    );
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, type: CanvasNodeType.Text, metadata: { ...item.metadata, content: answer || streamed, prompt, status: NODE_STATUS_SUCCESS } } : item)));
                    return;
                }
                if (node.type === CanvasNodeType.Video) {
                    await completeVideoNodeTask(node.id, generationConfig, prompt, retryImages, controller.signal, {
                        size: generationConfig.size,
                        seconds: generationConfig.videoSeconds,
                        vquality: generationConfig.vquality,
                        generateAudio: generationConfig.videoGenerateAudio,
                        watermark: generationConfig.videoWatermark,
                        videoMode: generationConfig.videoMode,
                    }, context?.referenceVideos || [], context?.referenceAudios || []);
                    return;
                }
                if (node.type === CanvasNodeType.Audio) {
                    const audio = await storeGeneratedAudio(await requestAudioGeneration(generationConfig, prompt, { signal: controller.signal }), generationConfig.audioFormat);
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, ...audioMetadata(audio), prompt, ...buildAudioGenerationMetadata(generationConfig) } } : item)));
                    return;
                }

                const image = await requestSingleImage(generationConfig, prompt, useReferenceImages ? retryImages : [], { signal: controller.signal });
                const uploadedImage = await uploadImage(image.dataUrl, { signal: controller.signal });
                const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
                const retryImage: CanvasNodeImage = {
                    id: imageId || node.metadata?.primaryImageId || nanoid(),
                    status: NODE_STATUS_SUCCESS,
                    content: uploadedImage.url,
                    storageKey: uploadedImage.storageKey,
                    naturalWidth: uploadedImage.width,
                    naturalHeight: uploadedImage.height,
                    bytes: uploadedImage.bytes,
                    mimeType: uploadedImage.mimeType,
                };
                const generationMetadata = savedImageMetadata?.generationType
                    ? {
                          generationType: savedImageMetadata.generationType,
                          model: generationConfig.model,
                          size: generationConfig.size,
                          quality: generationConfig.quality,
                          ...(generationConfig.background ? { background: generationConfig.background } : {}),
                          count: savedImageMetadata.count || 1,
                          references: savedImageMetadata.references,
                      }
                    : buildImageGenerationMetadata(useReferenceImages ? "edit" : "generation", generationConfig, 1, retryImages);
                setNodes((prev) =>
                    prev.map((item) => {
                        if (item.id !== node.id) return item;
                        const makePrimary = !imageId || !item.metadata?.content;
                        const edge = imageId ? Math.max(item.width, item.height) : 0;
                        const imageSize = imageId && item.metadata?.freeResize ? { width: item.width, height: item.height } : imageId ? fitNodeSize(uploadedImage.width, uploadedImage.height, edge, edge) : fitNodeSize(uploadedImage.width, uploadedImage.height, imageConfig.width, imageConfig.height);
                        return {
                            ...item,
                            type: CanvasNodeType.Image,
                            ...(makePrimary ? { width: imageSize.width, height: imageSize.height, ...(imageId ? { position: { x: item.position.x + item.width / 2 - imageSize.width / 2, y: item.position.y + item.height / 2 - imageSize.height / 2 } } : {}) } : {}),
                            metadata: {
                                ...item.metadata,
                                ...(makePrimary ? imageMetadata(uploadedImage) : { status: NODE_STATUS_SUCCESS }),
                                images: item.metadata?.images?.map((current) => (current.id === retryImage.id ? retryImage : current)),
                                primaryImageId: makePrimary ? retryImage.id : item.metadata?.primaryImageId,
                                prompt,
                                ...generationMetadata,
                            },
                        };
                    }),
                );
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                message.error(errorDetails);
                setNodes((prev) =>
                    prev.map((item) =>
                        item.id === node.id
                            ? {
                                  ...item,
                                  metadata: {
                                      ...item.metadata,
                                      status: item.metadata?.content ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR,
                                      errorDetails: item.metadata?.content ? undefined : errorDetails,
                                      retryBlocked: retryBlockedByError(error) || undefined,
                                      images: item.metadata?.images?.map((image) => (image.id === imageId ? { ...image, status: NODE_STATUS_ERROR, errorDetails } : image)),
                                      ...(isVideoTaskFailed(error) && item.type === CanvasNodeType.Video ? { videoTaskId: undefined } : {}),
                                  },
                              }
                            : item,
                    ),
                );
            } finally {
                finishGenerationRequest(node.id, controller);
                setRunningNodeId(null);
            }
        },
        [completeVideoNodeTask, effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, pollComfyImageNode, pollVideoNodeTask, startGenerationRequest, t],
    );

    const deleteBatchImage = useCallback((nodeId: string, imageId: string) => {
        const node = nodesRef.current.find((item) => item.id === nodeId);
        if ((node?.metadata?.images?.length || 0) <= 2) setExpandedBatchNodeIds((current) => new Set([...current].filter((id) => id !== nodeId)));
        setNodes((prev) =>
            prev.map((item) => {
                if (item.id !== nodeId) return item;
                const images = item.metadata?.images?.filter((image) => image.id !== imageId) || [];
                return { ...item, metadata: { ...item.metadata, images, count: images.length, primaryImageId: item.metadata?.primaryImageId === imageId ? images[0]?.id : item.metadata?.primaryImageId } };
            }),
        );
    }, []);

    const retryBatchImage = useCallback((node: CanvasNodeData, imageId: string) => void handleRetryNode(node, imageId), [handleRetryNode]);

    const generateImageFromTextNode = useCallback(
        (node: CanvasNodeData) => {
            const prompt = (node.metadata?.content || node.metadata?.prompt || "").trim();
            if (!prompt) {
                message.warning(t("canvas.projectPage.emptyTextImage"));
                return;
            }
            const sourceNode = nodesRef.current.find((item) => item.id === node.id);
            if (!sourceNode) return;
            const nextNodes = nodesRef.current.map((item) => (item.id === sourceNode.id ? { ...item, metadata: { ...item.metadata, content: prompt, prompt, status: NODE_STATUS_SUCCESS } } : item));
            nodesRef.current = nextNodes;
            setNodes(nextNodes);
            void handleGenerateNode(sourceNode.id, "image", prompt);
        },
        [handleGenerateNode, message, t],
    );

    const insertAssets = useCallback(async (payloads: InsertAssetPayload[], position?: Position) => {
        if (!payloads.length) return;
        const newNodes = await Promise.all(payloads.map(async (payload): Promise<CanvasNodeData> => {
            const origin = { x: 0, y: 0 };
            if (payload.kind === "text") {
                return { ...createCanvasNode(CanvasNodeType.Text, origin, { content: payload.content, status: NODE_STATUS_SUCCESS }), title: payload.title };
            }
            if (payload.kind === "video") {
                const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Video];
                const nextSize = fitNodeSize(payload.width || spec.width, payload.height || spec.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                const node = createCanvasNode(CanvasNodeType.Video, origin, {
                    content: payload.url, storageKey: payload.storageKey, status: NODE_STATUS_SUCCESS,
                    naturalWidth: payload.width, naturalHeight: payload.height,
                });
                return { ...node, ...nextSize, title: payload.title };
            }

            const storedImage = payload.storageKey
                ? { url: payload.dataUrl, storageKey: payload.storageKey, width: 1, height: 1, bytes: 0, mimeType: "image/png" }
                : await uploadImage(payload.dataUrl);
            await ensureImagePreview(storedImage.storageKey);
            const meta = storedImage.width === 1 && storedImage.height === 1 ? await readImageMeta(storedImage.url) : storedImage;
            const node = createCanvasNode(CanvasNodeType.Image, origin, {
                ...imageMetadata({ ...storedImage, width: meta.width, height: meta.height }),
                prompt: payload.title,
            });
            return { ...node, ...fitNodeSize(meta.width, meta.height), title: payload.title };
        }));

        const placed = placeAssetNodes(newNodes, position ?? getCanvasCenter());
        setNodes((prev) => [...prev, ...placed]);
        setSelectedNodeIds(new Set(placed.map((node) => node.id)));
        setSelectedConnectionId(null);
        setDialogNodeId(placed.length === 1 && placed[0].type === CanvasNodeType.Image ? placed[0].id : null);
        setViewport((current) => revealNodesInViewport(current, placed, size));
    }, [getCanvasCenter, size]);

    const handleAssetInsert = useCallback((payload: InsertAssetPayload) => {
        void insertAssets([payload]).catch(() => message.error(t("canvas.assetPicker.insertFailed")));
    }, [insertAssets, message, t]);

    const historyOutput = (node: CanvasNodeData, imageId?: string) => {
        if (!imageId) return node;
        const image = node.metadata?.images?.find((item) => item.id === imageId);
        if (!image) return null;
        return { ...node, id: node.metadata?.primaryImageId === image.id ? node.id : `${node.id}:${image.id}`, metadata: { ...node.metadata, ...image } };
    };

    const archiveHistoryOutput = async (node: CanvasNodeData, imageId?: string) => {
        const output = historyOutput(node, imageId);
        if (!output?.metadata?.content) return;
        const store = useAssetStore.getState();
        try {
            if (archivedCanvasNodeIds(store.assets).has(output.id)) {
                await store.confirmSave();
                message.info(t("canvas.projectPage.assetsAlreadyArchived", { count: 1 }));
                return;
            }
            const asset = canvasNodeToAsset(output, projectId);
            if (!asset) return;
            store.addAsset(asset);
            await store.confirmSave();
            message.success(t("common.addedToAssets"));
        } catch {
            message.error(t("common.saveToLocalFailed"));
        }
    };

    // Memoize every callback and render function passed to CanvasNode.
    // CanvasNode uses React.memo, but new prop references would invalidate it on every render and rerender every node
    // during click, hover, or viewport changes, which is especially expensive for Markdown. These useCallback values
    // and their memoized map/handler dependencies remain stable during interaction, so unchanged nodes do not rerender.
    const handleNodeHoverStart = useCallback((nodeId: string) => {
        if (nodeDraggingRef.current) return;
        if (nodeHoverHideTimerRef.current) clearTimeout(nodeHoverHideTimerRef.current);
        nodeHoverHideTimerRef.current = null;
        setHoveredNodeId(nodeId);
    }, []);
    const handleNodeHoverEnd = useCallback((nodeId: string) => {
        if (nodeDraggingRef.current) return;
        if (nodeHoverHideTimerRef.current) clearTimeout(nodeHoverHideTimerRef.current);
        nodeHoverHideTimerRef.current = setTimeout(() => {
            setHoveredNodeId((current) => (current === nodeId ? null : current));
            nodeHoverHideTimerRef.current = null;
        }, 120);
    }, []);
    useEffect(() => () => {
        if (nodeHoverHideTimerRef.current) clearTimeout(nodeHoverHideTimerRef.current);
    }, []);
    const handleNodeViewImage = useCallback((node: CanvasNodeData, imageId?: string) => {
        setPreviewNodeId(node.id);
        setPreviewImageId(imageId || null);
    }, []);
    const handleNodeRetry = useCallback(
        (node: CanvasNodeData) => {
            if (node.type === CanvasNodeType.Text && (node.metadata?.textCount || 1) > 1) {
                void generateNodeRef.current?.(node.id, "text", node.metadata?.prompt || "");
                return;
            }
            void handleRetryNode(node);
        },
        [handleRetryNode],
    );
    const handleNodeContextMenu = useCallback((event: ReactMouseEvent, nodeId: string) => {
        event.preventDefault();
        event.stopPropagation();
        if (referencePickerNodeId) return;
        setNodeCreatePosition(null);
        setSelectedNodeIds((current) => (current.has(nodeId) ? current : new Set([nodeId])));
        setSelectedConnectionId(null);
        setContextMenu({ type: "node", x: event.clientX, y: event.clientY, nodeId });
    }, [referencePickerNodeId]);

    const renderNodePanel = useCallback(
        (panelNode: CanvasNodeData) =>
            getNodeDefinition(panelNode.type)?.Panel ? (
                renderPluginPanel(panelNode)
            ) : (
                <CanvasNodePromptPanel
                    key={panelNode.id}
                    node={panelNode}
                    selectingReferences={referencePickerNodeId === panelNode.id}
                    referencePromptUpdateId={referencePromptUpdate?.nodeId === panelNode.id ? referencePromptUpdate.connectionId : undefined}
                    onFinishReferenceSelection={exitNodeReferenceSelection}
                    nodes={nodes}
                    isRunning={runningNodeId === panelNode.id || generationRequestsRef.current.has(panelNode.id)}
                    mentionReferences={mentionReferencesByNodeId.get(panelNode.id) || EMPTY_REFERENCES}
                    connectedNodes={connectedNodesByNodeId.get(panelNode.id) || []}
                    connections={connections}
                    onPromptChange={handleNodePromptChange}
                    onConfigChange={handleConfigNodeChange}
                    onGenerate={handleGenerateNode}
                    onStop={(id) => confirmStopGeneration(generationRequestsRef.current.get(id)?.runningNodeId ?? id)}
                    onQueryTask={(node) => { void (hasResumableImageTask(node) ? pollComfyImageNode(node) : pollVideoNodeTask(node)); }}
                    onDisconnectReference={disconnectNodeReference}
                    onMoveReference={moveNodeReference}
                    onReplaceReference={replaceNodeReference}
                    onStartReferenceSelection={startNodeReferenceSelection}
                    modeOverride={getNodeDefinition(panelNode.type)?.useBuiltinPanel?.mode}
                    onSettingsOpenChange={setNodeSettingsPopoverOpen}
                />
            ),
        [confirmStopGeneration, connectedNodesByNodeId, connections, disconnectNodeReference, exitNodeReferenceSelection, handleConfigNodeChange, handleGenerateNode, handleNodePromptChange, mentionReferencesByNodeId, moveNodeReference, nodes, pollComfyImageNode, pollVideoNodeTask, referencePickerNodeId, referencePromptUpdate, renderPluginPanel, replaceNodeReference, runningNodeId, startNodeReferenceSelection],
    );

    const hoverPreviewNode = hoverPreviewNodeId ? nodeById.get(hoverPreviewNodeId) || null : null;
    const hoverPreviewMedia =
        hoverPreviewNode && (hoverPreviewNode.type === CanvasNodeType.Image || hoverPreviewNode.type === CanvasNodeType.Video) && hoverPreviewNode.metadata?.content
            ? {
                  video: hoverPreviewNode.type === CanvasNodeType.Video,
                  src: hoverPreviewNode.metadata.content,
                  width: hoverPreviewNode.metadata.naturalWidth || hoverPreviewNode.width,
                  height: hoverPreviewNode.metadata.naturalHeight || hoverPreviewNode.height,
              }
            : null;
    const showHoverPreview = Boolean(hoverPreviewMedia);
    const retainedPreviewRef = useRef<{ video: boolean; src: string; title: string; width: number; height: number } | null>(null);
    // Written during render on purpose: the overlay stays mounted while it fades out, so the last preview has to be
    // retained after the hovered node clears. Sizing reuses the measured container size instead of reading layout here.
    if (hoverPreviewMedia) {
        const previewSize = fitNodeSize(hoverPreviewMedia.width, hoverPreviewMedia.height, size.width * 0.9, size.height * 0.9);
        retainedPreviewRef.current = { video: hoverPreviewMedia.video, src: hoverPreviewMedia.src, title: hoverPreviewNode?.title || "", width: previewSize.width, height: previewSize.height };
    }
    const retainedPreview = retainedPreviewRef.current;
    const activePanelNodeId = referencePickerNodeId ?? (dialogNodeId === singleSelectedNodeId ? dialogNodeId : null);

    useEffect(() => {
        setNodeSettingsPopoverOpen(false);
        if (dialogNodeId && dialogNodeId !== activePanelNodeId) setDialogNodeId(null);
    }, [activePanelNodeId, dialogNodeId]);

    if (!hydrated) return <main className="flex h-full items-center justify-center" style={{ background: theme.canvas.background, color: theme.node.text }}><SnapshotStorageStatus kind="projects" /></main>;
    if (!projectLoaded) return <CanvasRefreshShell />;

    return (
        <main className="flex h-full min-h-0 overflow-hidden" style={{ background: theme.canvas.background, color: theme.node.text }}>
            <CanvasSidePanel
                nodes={nodes}
                selectedNodeIds={selectedNodeIds}
                onFocusNode={(nodeId) => {
                    if (!referencePickerNodeId) {
                        const node = nodeById.get(nodeId);
                        setDialogNodeId(node && node.type !== CanvasNodeType.Group && !getNodeDefinition(node.type)?.hidePanel ? nodeId : null);
                    }
                    requestAnimationFrame(() => focusNodeRef.current(nodeId));
                }}
                onPreviewNode={setPreviewNodeId}
                onHoverNode={setHoverPreviewNodeId}
                onInsertAsset={handleAssetInsert}
            />
            <section className="@container relative flex min-w-0 flex-1 flex-col overflow-hidden">
                <Modal destroyOnHidden open={Boolean(saveBarrier.error)} title={t("storage.leaveFailed")} onCancel={saveBarrier.stay} footer={<><Button onClick={saveBarrier.stay}>{t("storage.stay")}</Button><Button onClick={() => void saveBarrier.retry()}>{t("storage.retrySave")}</Button></>}>
                    <p>{saveBarrier.error}</p>
                </Modal>
                <CanvasTopBar
                    title={currentProject?.title || t("canvas.projectPage.untitledCanvas")}
                    titleDraft={titleDraft}
                    isTitleEditing={titleEditing}
                    onTitleDraftChange={setTitleDraft}
                    onStartTitleEditing={startTitleEditing}
                    onFinishTitleEditing={finishTitleEditing}
                    onCancelTitleEditing={() => setTitleEditing(false)}
                    canUndo={historyState.canUndo}
                    canRedo={historyState.canRedo}
                    onHome={() => navigate("/")}
                    onProjects={() => navigate("/canvas")}
                    onCreateProject={createAndOpenProject}
                    onDeleteProject={deleteCurrentProject}
                    onExportProject={exportCurrentProject}
                    onImportImage={() => handleUploadRequest()}
                    onOpenAssetPicker={() => {
                        assetPickerPositionRef.current = null;
                        setAssetPickerOpen(true);
                    }}
                    canSaveWorkflow={selectedNodeIds.size > 0}
                    onSaveWorkflow={() => void saveWorkflow()}
                    onInsertWorkflow={() => workflowInputRef.current?.click()}
                    canPreviewChain={selectedNodeIds.size > 0}
                    onPreviewChain={() => void previewChain()}
                    onOpenGenerationHistory={() => setGenerationHistoryOpen(true)}
                    onOpenStoryboard={() => setStoryboardOpen(true)}
                    onOpenEditingStudio={openEditingStudio}
                    onArchiveToAssets={() => void saveCanvasMediaToAssets()}
                    onOpenPlugins={() => setPluginManagerOpen(true)}
                    onUndo={undoCanvas}
                    onRedo={redoCanvas}
                    agentOpen={agentPanelOpen}
                    compactAgentStatus={{ connected: localAgentConnected, enabled: localAgentEnabled, activity: localAgentActivity }}
                    onToggleAgent={toggleAgentPanel}
                />

                <CanvasStoryboardDialog
                    open={storyboardOpen}
                    initialScript={storyboardInitialScript}
                    referenceCount={selectedStoryboardReferences.length}
                    onClose={() => setStoryboardOpen(false)}
                    onCreate={createStoryboard}
                />

                <div className="@container relative min-h-0 flex-1">
                <InfiniteCanvas
                    containerRef={containerRef}
                    viewport={viewport}
                    tool={canvasTool}
                    backgroundMode={backgroundMode}
                    onViewportChange={(next) => {
                        if (focusAnimRef.current) {
                            cancelAnimationFrame(focusAnimRef.current);
                            focusAnimRef.current = null;
                        }
                        setViewport(next);
                        setContextMenu(null);
                    }}
                    onCanvasMouseDown={(event) => {
                        if (!referencePickerNodeId) handleCanvasMouseDown(event);
                    }}
                    onCanvasDeselect={referencePickerNodeId ? undefined : deselectCanvas}
                    onCanvasDoubleClick={(event) => {
                        if (referencePickerNodeId) return;
                        setContextMenu(null);
                        setNodeCreateDockAnchor(null);
                        setNodeCreatePosition(screenToCanvas(event.clientX, event.clientY));
                    }}
                    onContextMenu={openCanvasContextMenu}
                    onDrop={handleDrop}
                    emptyNodeCount={nodes.length}
                >
                    <svg className="absolute left-0 top-0 h-[10000px] w-[10000px] overflow-visible" style={{ pointerEvents: "none", transform: "translateZ(0)", zIndex: 0 }}>
                        {visibleConnections.map(({ connection, from, to }) => (
                            <ConnectionPath
                                key={connection.id}
                                connection={connection}
                                from={from}
                                to={to}
                                active={selectedConnectionId === connection.id || relatedHighlight.connectionIds.has(connection.id)}
                                onSelect={() => {
                                    setSelectedConnectionId(connection.id);
                                    setSelectedNodeIds(new Set());
                                    setContextMenu(null);
                                }}
                                onContextMenu={(event) => {
                                    if (referencePickerNodeId) return;
                                    setSelectedConnectionId(connection.id);
                                    setSelectedNodeIds(new Set());
                                    setContextMenu({ type: "connection", x: event.clientX, y: event.clientY, connectionId: connection.id });
                                }}
                            />
                        ))}
                        {connectingParams ? <ActiveConnectionPath node={nodeById.get(connectingParams.nodeId)} handle={connectingParams} mouseWorld={mouseWorld} target={connectionTargetNodeId ? nodeById.get(connectionTargetNodeId) : undefined} /> : null}
                    </svg>

                    {visibleNodes.map((node) => (
                        <CanvasNode
                            key={node.id}
                            data={node}
                            scale={viewport.k}
                            isSelected={selectedNodeIds.has(node.id)}
                            isDragging={isNodeDragging && dragRef.current.movedIds.has(node.id)}
                            isRelated={relatedHighlight.nodeIds.has(node.id)}
                            isFocusRelated={activeNodeId === node.id}
                            isConnectionTarget={connectionTargetNodeId === node.id}
                            isConnecting={Boolean(connectingParams)}
                            referenceSelectionState={!referencePickerNodeId ? undefined : node.id === referencePickerNodeId ? "target" : referenceConnectedNodeIds.has(node.id) || !isCanvasReferenceNode(node, nodes) ? "disabled" : "available"}
                            showPanel={false}
                            groupChildCount={groupChildCountById.get(node.id) || 0}
                            isGroupDropTarget={dropTargetGroupId === node.id}
                            batchExpanded={expandedBatchNodeIds.has(node.id)}
                            showImageInfo={showImageInfo}
                            mentionReferences={mentionReferencesByNodeId.get(node.id) || EMPTY_REFERENCES}
                            pluginHost={pluginHost}
                            registryVersion={nodeRegistryVersion}
                            renderPanel={renderNodePanel}
                            onMouseDown={handleNodeMouseDown}
                            onSelectCapture={handleNodeSelectCapture}
                            onHoverStart={handleNodeHoverStart}
                            onHoverEnd={handleNodeHoverEnd}
                            onConnectStart={handleConnectStart}
                            onConnectQuickAdd={handleConnectQuickAdd}
                            onResizeStart={handleNodeResizeStart}
                            onResize={handleNodeResize}
                            onResizeEnd={handleNodeResizeEnd}
                            onContentChange={handleNodeContentChange}
                            onTitleChange={handleNodeTitleChange}
                            onToggleBatch={toggleBatchExpanded}
                            onSetBatchPrimary={setBatchPrimary}
                            onDuplicateBatchImage={duplicateBatchImage}
                            onDownloadBatchImage={downloadBatchImage}
                            onRetryBatchImage={retryBatchImage}
                            onDeleteBatchImage={deleteBatchImage}
                            onRetry={handleNodeRetry}
                            onViewImage={handleNodeViewImage}
                            onOpenVersions={(node) => setVersionCompareRootId(versionRootIdOf(node))}
                            onSelectReference={selectNodeReference}
                            onContextMenu={handleNodeContextMenu}
                        />
                    ))}

                    {selectionBox ? (
                        <svg
                            className="pointer-events-none absolute z-[100] overflow-visible"
                            style={{
                                left: Math.min(selectionBox.startWorldX, selectionBox.currentWorldX),
                                top: Math.min(selectionBox.startWorldY, selectionBox.currentWorldY),
                                width: Math.abs(selectionBox.currentWorldX - selectionBox.startWorldX),
                                height: Math.abs(selectionBox.currentWorldY - selectionBox.startWorldY),
                            }}
                        >
                            <rect width="100%" height="100%" fill={theme.canvas.selectionFill} stroke={theme.canvas.selectionStroke} strokeOpacity={0.55} strokeWidth={1 / viewport.k} strokeDasharray={`${6 / viewport.k} ${4 / viewport.k}`} />
                        </svg>
                    ) : null}
                </InfiniteCanvas>
                {(dragGuides.x !== undefined || dragGuides.y !== undefined) && <svg aria-hidden className="pointer-events-none absolute inset-0 z-10 h-full w-full" stroke={theme.canvas.selectionStroke} strokeDasharray="4 4">
                    {dragGuides.x !== undefined && <line x1={viewport.x + dragGuides.x * viewport.k} x2={viewport.x + dragGuides.x * viewport.k} y2="100%" />}
                    {dragGuides.y !== undefined && <line y1={viewport.y + dragGuides.y * viewport.k} y2={viewport.y + dragGuides.y * viewport.k} x2="100%" />}
                </svg>}
                {pendingConnectionCreate ? (
                    <ConnectionCreateMenu
                        fromInput={pendingConnectionCreate.connection.handleType === "target"}
                        position={{ x: viewport.x + pendingConnectionCreate.position.x * viewport.k, y: viewport.y + pendingConnectionCreate.position.y * viewport.k }}
                        onCreate={(type) => createConnectedNode(type, pendingConnectionCreate)}
                        onClose={cancelPendingConnectionCreate}
                    />
                ) : null}
                {activePanelNodeId && !selectionBox && !isNodeResizing && (() => {
                    const panelNode = displayNodeById.get(activePanelNodeId);
                    if (!panelNode || panelNode.type === CanvasNodeType.Group || getNodeDefinition(panelNode.type)?.hidePanel) return null;
                    const center = viewport.x + (panelNode.position.x + panelNode.width / 2) * viewport.k;
                    const top = viewport.y + (panelNode.position.y + panelNode.height) * viewport.k + 12;
                    const panelWidth = Math.min(860, Math.max(520, panelNode.width * viewport.k + 120));
                    const sideInset = panelWidth / 2 + 16;
                    return (
                        <div
                            className="pointer-events-none absolute top-14 bottom-20 z-[90] flex max-w-[calc(100%-2rem)] -translate-x-1/2 flex-col @max-[1040px]:bottom-36"
                            style={{ width: panelWidth, left: `clamp(min(${sideInset}px, 50%), ${center}px, max(calc(100% - ${sideInset}px), 50%))`, visibility: pendingConnectionCreate || nodeCreatePosition ? "hidden" : undefined }}
                        >
                            <div aria-hidden className="min-h-0" style={{ height: Math.max(0, top - 56) }} />
                            <motion.div key={panelNode.id} initial={reducedMotion ? false : { opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16, ease: "easeOut" }} className="pointer-events-auto max-h-full shrink-0 overflow-y-auto rounded-[var(--r-lg)] shadow-[var(--shadow-lg)] [--intx-panel-composer:clamp(4rem,9dvh,6rem)]" data-node-panel={panelNode.id}>
                                {renderNodePanel(panelNode)}
                            </motion.div>
                        </div>
                    );
                })()}
                {nodeCreatePosition && (
                    <NodeCreateMenu
                        dockAnchor={Boolean(nodeCreateDockAnchor)}
                        position={{
                            x: Math.max(8, Math.min(size.width - 248, nodeCreateDockAnchor?.x ?? viewport.x + nodeCreatePosition.x * viewport.k)),
                            y: nodeCreateDockAnchor?.y ?? Math.max(8, Math.min(size.height - 340, viewport.y + nodeCreatePosition.y * viewport.k)),
                        }}
                        onCreate={(type) => {
                            createNode(type, nodeCreatePosition);
                        }}
                        onUpload={() => handleUploadRequest(undefined, nodeCreatePosition)}
                        onOpenAssets={() => {
                            assetPickerPositionRef.current = nodeCreatePosition;
                            setAssetPickerOpen(true);
                        }}
                        onOpenHistory={() => setGenerationHistoryOpen(true)}
                        onOpenStoryboard={() => setStoryboardOpen(true)}
                        onClose={() => setNodeCreatePosition(null)}
                    />
                )}


                <div
                    className="pointer-events-none absolute inset-0 z-[80] flex items-center justify-center transition-opacity duration-200 ease-out"
                    style={{ background: `color-mix(in srgb, ${theme.canvas.background} 76%, transparent)`, opacity: showHoverPreview ? 1 : 0 }}
                >
                    <div
                        className="flex flex-col overflow-hidden rounded-2xl border transition-transform duration-200 ease-out"
                        style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, boxShadow: "0 24px 60px rgba(0,0,0,.32)", transform: showHoverPreview ? "scale(1)" : "scale(0.95)" }}
                    >
                        {retainedPreview ? (
                            <>
                                <div className="max-w-full truncate px-3.5 py-2 text-sm font-medium" style={{ color: theme.node.text }}>
                                    {retainedPreview.title || t(retainedPreview.video ? "assets.kinds.video" : "assets.kinds.image")}
                                </div>
                                <div className="overflow-hidden" style={{ width: retainedPreview.width, height: retainedPreview.height }}>
                                    {retainedPreview.video ? <video src={retainedPreview.src} muted playsInline preload="metadata" className="size-full object-contain" /> : <img src={retainedPreview.src} alt={retainedPreview.title} className="size-full object-contain" />}
                                </div>
                            </>
                        ) : null}
                    </div>
                </div>

                <CanvasNodeHoverToolbar
                    node={isNodeResizing || nodeSettingsPopoverOpen || Boolean(referencePickerNodeId) || expandedBatchNodeIds.has(toolbarNode?.id || "") || isEmptyContentToolbarNode || isMediaGeneratingToolbarNode || (Boolean(dialogNodeId) && !activeDialogIsMediaResult) ? null : toolbarNode}
                    panelNodeId={dialogNodeId}
                    viewport={viewport}
                    onKeep={handleNodeHoverStart}
                    onLeave={handleNodeHoverEnd}
                    extraTools={toolbarNode ? buildNodeToolbarItems(toolbarNode) : undefined}
                    onInfo={(node) => setInfoNodeId(node.id)}
                    onDecreaseFont={(node) => handleFontSizeChange(node.id, Math.max(10, (node.metadata?.fontSize || 14) - 2))}
                    onIncreaseFont={(node) => handleFontSizeChange(node.id, Math.min(32, (node.metadata?.fontSize || 14) + 2))}
                    onToggleDialog={(node) => {
                        setSelectedNodeIds(new Set([node.id]));
                        setSelectedConnectionId(null);
                        setDialogNodeId((current) => (current === node.id ? null : node.id));
                    }}
                    onGenerateImage={generateImageFromTextNode}
                    onUpload={(node) => handleUploadRequest(node.id)}
                    onDownload={downloadNodeImage}
                    onOpenVersions={(node) => setVersionCompareRootId(versionRootIdOf(node))}
                    onSaveAsset={(node) => void saveNodeAsset(node)}
                    onMaskEdit={(node) => setMaskEditNodeId(node.id)}
                    onCrop={(node) => setCropNodeId(node.id)}
                    onSplit={(node) => setSplitNodeId(node.id)}
                    onUpscale={(node) => setUpscaleNodeId(node.id)}
                    onSuperResolve={(node) => setSuperResolveNodeId(node.id)}
                    onAngle={(node) => setAngleNodeId(node.id)}
                    onPreset={(node) => setPresetNodeId(node.id)}
                    onViewImage={handleNodeViewImage}
                    onReversePrompt={createImageReversePromptNodes}
                    onRetry={(node) => void handleRetryNode(node)}
                    onToggleFreeResize={(node) => toggleNodeFreeResize(node.id)}
                    onDuplicate={(node) => duplicateNode(node.id)} onDelete={(node) => deleteNodes(new Set([node.id]))}
                    onUngroup={(node) => ungroupSelection(new Set([node.id]))}
                />

                {hasMultipleSelectedNodes && !selectionBox ? (
                    <CanvasSelectionToolbar
                        nodes={dragPreview ? selectedNodes.map((node) => displayNodeById.get(node.id) ?? node) : selectedNodes}
                        viewport={viewport}
                        showToolbar={!isNodeDragging && !isNodeResizing}
                        canGroup={canGroupSelection}
                        canUngroup={canUngroupSelection}
                        onGroup={groupSelection}
                        onUngroup={ungroupSelection}
                        onAlign={alignSelection}
                        onDistribute={distributeSelection}
                        onSaveWorkflow={() => void saveWorkflow()}
                    />
                ) : null}

                <CanvasToolbar
                    selectedCount={selectedNodeIds.size}
                    canvasTool={canvasTool}
                    addMenuActive={Boolean(nodeCreatePosition)}
                    onFocusSelected={focusSelectedNode}
                    onFitCanvas={fitCanvasViewport}
                    canUndo={historyState.canUndo}
                    canRedo={historyState.canRedo}
                    backgroundMode={backgroundMode}
                    snapToGrid={snapToGrid}
                    showImageInfo={showImageInfo}
                    onOpenCreateMenu={(event) => {
                        if (referencePickerNodeId) return;
                        const rect = containerRef.current?.getBoundingClientRect();
                        if (!rect) return;
                        setContextMenu(null);
                        cancelPendingConnectionCreate();
                        const button = event.currentTarget.getBoundingClientRect();
                        setNodeCreateDockAnchor({ x: button.left - rect.left, y: rect.bottom - button.top + 12 });
                        setNodeCreatePosition(nodeCreatePosition ? null : getCanvasCenter());
                    }}
                    onAddGroup={() => createNode(CanvasNodeType.Group)}
                    onAddExtensionNode={(type) => createNode(type)}
                    onUndo={undoCanvas}
                    onRedo={redoCanvas}
                    onDelete={() => deleteNodes(new Set(selectedNodeIds))}
                    onClear={() => setClearConfirmOpen(true)}
                    onCanvasToolChange={setCanvasTool}
                    onBackgroundModeChange={setBackgroundMode}
                    onSnapToGridChange={(enabled) => {
                        window.localStorage.setItem("canvas:snap-to-grid", enabled ? "1" : "0");
                        setSnapToGrid(enabled);
                    }}
                    onShowImageInfoChange={setShowImageInfo}
                />

                {isMiniMapOpen ? <Minimap nodes={displayNodes} viewport={viewport} viewportSize={size} onViewportChange={setViewport} /> : null}

                <CanvasZoomControls
                    canvasImages={nodes.filter((node) => node.type === CanvasNodeType.Image && Boolean(node.metadata?.content || node.metadata?.images?.length))}
                    onFocusImage={focusNode}
                    scale={viewport.k}
                    onScaleChange={setZoomScale}
                    onReset={resetViewport}
                    isMiniMapOpen={isMiniMapOpen}
                    onToggleMiniMap={() => setIsMiniMapOpen((value) => !value)}
                    onInsertAsset={handleAssetInsert}
                    onOpenAssets={() => {
                        assetPickerPositionRef.current = null;
                        setAssetPickerOpen(true);
                    }}
                />

                {contextMenu?.type === "canvas" ? (
                    <CanvasBackgroundContextMenu
                        menu={contextMenu}
                        canPaste={Boolean(clipboardRef.current || navigator.clipboard)}
                        canUndo={historyState.canUndo}
                        canRedo={historyState.canRedo}
                        onClose={() => setContextMenu(null)}
                        onAdd={() => {
                            setNodeCreateDockAnchor(null);
                            setNodeCreatePosition(contextMenu.position);
                        }}
                        onOpenAssets={() => {
                            assetPickerPositionRef.current = contextMenu.position;
                            setAssetPickerOpen(true);
                        }}
                        onUpload={() => handleUploadRequest(undefined, contextMenu.position)}
                        onUndo={undoCanvas}
                        onRedo={redoCanvas}
                        onPaste={() => {
                            const graph = clipboardRef.current;
                            if (graph) insertSubgraph(graph, true, contextMenu.position);
                            else void pasteSystemClipboard(contextMenu.position).catch(() => message.warning(t("canvas.contextMenu.clipboardUnavailable")));
                        }}
                    />
                ) : contextMenu ? (
                    <CanvasNodeContextMenu
                        menu={contextMenu}
                        selectedCount={selectedNodeIds.size}
                        canCaptureVideoFrame={contextMenuNode?.type === CanvasNodeType.Video && Boolean(contextMenuNode.metadata?.content)}
                        canExtractAudio={contextMenuNode?.type === CanvasNodeType.Video && Boolean(contextMenuNode.metadata?.content)}
                        canGroup={contextMenu.type === "node" && canGroupSelection}
                        canUngroup={contextMenu.type === "node" && canUngroupSelection}
                        nodeLocked={Boolean(contextMenuNode?.metadata?.locked)}
                        onClose={() => setContextMenu(null)}
                        onCaptureVideoFrame={(position) => {
                            if (contextMenu.type !== "node") return;
                            void captureVideoNodeFrame(contextMenu.nodeId, position);
                        }}
                        onExtractAudio={() => {
                            if (contextMenu.type !== "node") return;
                            void extractAudioNode(contextMenu.nodeId);
                        }}
                        onDuplicate={() => {
                            if (contextMenu.type !== "node") return;
                            duplicateNode(contextMenu.nodeId);
                            setContextMenu(null);
                        }}
                        onCopySelection={copySelectedNodes}
                        onGroup={groupSelection}
                        onUngroup={ungroupSelection}
                        onToggleLock={() => {
                            if (contextMenu.type !== "node") return;
                            toggleNodeLock(contextMenu.nodeId);
                            setContextMenu(null);
                        }}
                        onDelete={() => {
                            if (contextMenu.type === "node") {
                                deleteNodes(selectedNodeIds.has(contextMenu.nodeId) ? new Set(selectedNodeIds) : new Set([contextMenu.nodeId]));
                            } else {
                                deleteConnection(contextMenu.connectionId);
                            }
                            setContextMenu(null);
                        }}
                    />
                ) : null}

                <input ref={workflowInputRef} type="file" accept=".zip" className="hidden" onChange={(event) => void importWorkflow(event)} />
                <input ref={imageInputRef} type="file" multiple accept="image/*,video/*,audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav" className="hidden" onChange={handleImageInputChange} />

                <CanvasNodeInfoModal node={infoNode} open={Boolean(infoNode)} onClose={() => setInfoNodeId(null)} />
                <CanvasPluginManagerModal open={pluginManagerOpen} onClose={() => setPluginManagerOpen(false)} />

                {cropNode?.metadata?.content ? <CanvasNodeCropDialog dataUrl={cropNode.metadata.content} open={Boolean(cropNode)} onClose={() => setCropNodeId(null)} onConfirm={(crop) => void cropImageNode(cropNode!, crop)} /> : null}

                {maskEditNode?.metadata?.content ? (
                    <CanvasNodeMaskEditDialog dataUrl={maskEditNode.metadata.content} open={Boolean(maskEditNode)} onClose={() => setMaskEditNodeId(null)} onConfirm={(payload) => void maskEditImageNode(maskEditNode!, payload)} />
                ) : null}

                {splitNode?.metadata?.content ? <CanvasNodeSplitDialog dataUrl={splitNode.metadata.content} open={Boolean(splitNode)} onClose={() => setSplitNodeId(null)} onConfirm={(params) => void splitImageNode(splitNode!, params)} /> : null}

                {upscaleNode?.metadata?.content ? (
                    <CanvasNodeUpscaleDialog dataUrl={upscaleNode.metadata.content} open={Boolean(upscaleNode)} onClose={() => setUpscaleNodeId(null)} onConfirm={(params) => void upscaleImageNode(upscaleNode!, params)} />
                ) : null}

                <Modal
                    destroyOnHidden
                    title={t("canvas.projectPage.superResolve")}
                    open={Boolean(superResolveNode?.metadata?.content)}
                    centered
                    onCancel={() => setSuperResolveNodeId(null)}
                    footer={<div className="flex justify-end gap-2"><Button onClick={() => setSuperResolveNodeId(null)}>{t("common.cancel")}</Button><Button type="primary" onClick={() => { if (superResolveNode) void superResolveImageNode(superResolveNode); }}>{t("canvas.projectPage.superResolveConfirmed")}</Button></div>}
                >
                    <div className="space-y-3 py-2">
                        <p>{t("canvas.projectPage.superResolveDescription")}</p>
                        <p className="text-sm opacity-65">{t("canvas.projectPage.superResolveModel", { model: superResolveConfig ? modelOptionLabel(superResolveConfig, superResolveConfig.model) : "" })}</p>
                        <p className="text-sm opacity-65">{superResolveCost ? t("canvas.projectPage.superResolveCost", { currency: superResolveCost.currency, amount: superResolveCost.amount }) : t("canvas.projectPage.superResolveCostUnknown")}</p>
                    </div>
                </Modal>

                {angleNode?.metadata?.content ? <CanvasNodeAngleDialog dataUrl={angleNode.metadata.content} open={Boolean(angleNode)} onClose={() => setAngleNodeId(null)} onConfirm={(params) => void generateAngleNode(angleNode!, params)} /> : null}
                <AgentConfirmDialog
                    plan={pendingAgentPlan?.plan ?? null}
                    open={Boolean(pendingAgentPlan)}
                    costText={pendingAgentCost}
                    onCancel={() => setPendingAgentPlan(null)}
                    onConfirm={() => {
                        const run = pendingAgentPlan?.proceed;
                        setPendingAgentPlan(null);
                        run?.();
                    }}
                />
                {presetNode?.metadata?.content ? <CanvasNodePresetDialog dataUrl={presetNode.metadata.content} open={Boolean(presetNode)} onClose={() => setPresetNodeId(null)} onConfirm={(id) => void generatePresetNode(presetNode!, id)} /> : null}

                <Modal
                    destroyOnHidden
                    title={t("canvas.projectPage.imageDetails")}
                    open={Boolean(previewContent)}
                    centered
                    onCancel={() => setPreviewNodeId(null)}
                    footer={null}
                    width="auto"
                    styles={{ body: { padding: 0, display: "flex", justifyContent: "center", alignItems: "center", maxHeight: "80vh" } }}
                >
                    {previewContent ? (previewNode?.type === CanvasNodeType.Video ? <video src={previewContent} controls className="max-h-[80vh] max-w-full" /> : <img src={previewContent} alt={previewNode?.title || t("assets.kinds.image")} style={{ maxWidth: "100%", maxHeight: "80vh", objectFit: "contain" }} />) : null}
                </Modal>

                <Modal destroyOnHidden title={t("canvas.projectPage.clearTitle")} open={clearConfirmOpen} centered onCancel={() => setClearConfirmOpen(false)} footer={<><Button onClick={() => setClearConfirmOpen(false)}>{t("common.cancel")}</Button><Button danger type="primary" onClick={clearCanvas}>{t("canvas.projectPage.clear")}</Button></>}>
                    <p className="text-sm opacity-60">{t("canvas.projectPage.clearDescription")}</p>
                </Modal>

                <AssetPickerModal open={assetPickerOpen} onInsert={async (payloads) => {
                    await insertAssets(payloads, assetPickerPositionRef.current ?? undefined);
                    setAssetPickerOpen(false);
                }} onClose={() => setAssetPickerOpen(false)} />
                {/* 关闭即卸载：本环境 antd 离场动画会停在 ant-zoom-leave，视觉上关不掉 */}
                {generationHistoryOpen ? (
                    <CanvasGenerationHistoryModal nodes={nodes} onClose={() => setGenerationHistoryOpen(false)}
                        onLocate={(node) => { setGenerationHistoryOpen(false); focusNode(node.id); }}
                        onPreview={(node, imageId) => { setGenerationHistoryOpen(false); handleNodeViewImage(node, imageId); }}
                        onArchive={(node, imageId) => void archiveHistoryOutput(node, imageId)}
                        onInsert={(node, imageId) => {
                            const output = historyOutput(node, imageId);
                            if (!output?.metadata?.content) return;
                            const { content, storageKey, naturalWidth, naturalHeight } = output.metadata;
                            handleAssetInsert(output.type === CanvasNodeType.Video
                                ? { kind: "video", url: content, storageKey, title: output.title, width: naturalWidth || output.width, height: naturalHeight || output.height }
                                : { kind: "image", dataUrl: content, storageKey, title: output.title });
                            setGenerationHistoryOpen(false);
                        }}
                    />
                ) : null}
                {versionCompareRootId ? <CanvasVersionCompareModal open versions={versionCompareVersions} onClose={() => setVersionCompareRootId(null)} onSetPrimary={(nodeId) => setNodes((prev) => setPrimaryMediaVersion(prev, nodeId))} onFocus={(nodeId) => { setVersionCompareRootId(null); focusNode(nodeId); }} /> : null}
                </div>
            </section>
        </main>
    );
}
