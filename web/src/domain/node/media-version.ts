import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

/** 版本标签只用 A-Z；到 Z 后不再递增，避免生成非法标签。 */
const LABEL_A = "A".charCodeAt(0);
const LABEL_Z = "Z".charCodeAt(0);
const VERSION_SUFFIX = /\s·\s[A-Z]$/;

/** 快照只保留媒体内容、生成参数和版本族关系，剥掉会把旧版本渲染成运行中/失败的运行态字段。 */
const RUNTIME_KEYS = [
    "status",
    "errorDetails",
    "retryBlocked",
    "imageTaskId",
    "videoTaskId",
    "videoTaskProvider",
    "primaryImageId",
    "imageBatchExpanded",
    "isBatchRoot",
    "batchRootId",
    "batchChildIds",
    "generationOutputNodeIds",
    "batchFailedCount",
    "generationErrorCode",
    "generationErrorSummary",
    "generationProviderCode",
    "taskId",
    "taskStatus",
    "taskProgress",
    "taskStage",
    "taskCreatedAt",
    "taskUpdatedAt",
    "taskFailureDiagnostics",
    "taskProviderRequestId",
    "failedPromptFingerprint",
    "failedInputFingerprint",
] as const;

export function versionRootIdOf(node: CanvasNodeData): string {
    return node.metadata?.versionOfNodeId || node.id;
}

export function nextVersionLabel(nodes: readonly CanvasNodeData[], rootId: string): string {
    const labels = nodes.filter((node) => versionRootIdOf(node) === rootId).map((node) => node.metadata?.versionLabel).filter((label): label is string => Boolean(label));
    if (!labels.length) return "A";
    const highest = Math.max(...labels.map((label) => label.charCodeAt(0) || LABEL_A), LABEL_A);
    return String.fromCharCode(Math.min(LABEL_Z, Math.max(LABEL_A, highest + 1)));
}

export function stripVersionSuffix(title: string): string {
    return title.replace(VERSION_SUFFIX, "");
}

export function clearVersionFields(metadata: CanvasNodeMetadata | undefined): CanvasNodeMetadata | undefined {
    if (!metadata) return undefined;
    const next = { ...metadata } as CanvasNodeMetadata & Record<string, unknown>;
    delete next.versionOfNodeId;
    delete next.versionLabel;
    delete next.versionPrimary;
    return next;
}

function snapshotMetadata(metadata: CanvasNodeMetadata | undefined, rootId: string, label: string): CanvasNodeMetadata {
    const snapshot = { ...metadata } as CanvasNodeMetadata & Record<string, unknown>;
    for (const key of RUNTIME_KEYS) delete snapshot[key];
    snapshot.versionOfNodeId = rootId;
    snapshot.versionLabel = label;
    snapshot.versionPrimary = false;
    snapshot.status = snapshot.content || (Array.isArray(snapshot.images) && snapshot.images.some((image) => image.content)) ? "success" : "idle";
    if (Array.isArray(snapshot.images)) {
        snapshot.images = snapshot.images.map((image) => ({ ...image, status: image.content ? "success" : "idle", errorDetails: undefined }));
    }
    return snapshot;
}

export type MediaVersionPlan = {
    nodes: CanvasNodeData[];
    currentMetadata: CanvasNodeMetadata;
    versionRootId: string;
    versionLabel: string;
    snapshotLabel: string | null;
    snapshotId: string | null;
};

/**
 * 为「原地重新生成」准备版本族：旧媒体另存为快照，当前节点保留稳定 ID 并升到下一版。
 * 空节点没有旧媒体可保存，只建立版本族。函数纯计算，ID 由调用方传入。
 */
export function prepareMediaGenerationVersion(nodes: readonly CanvasNodeData[], nodeId: string, snapshotId: string, offset = 36): MediaVersionPlan | null {
    const source = nodes.find((node) => node.id === nodeId);
    if (!source) return null;
    const versionRootId = versionRootIdOf(source);
    const sourceLabel = source.metadata?.versionLabel || "A";
    const hasMedia = [CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio].includes(source.type as CanvasNodeType) && Boolean(source.metadata?.content || source.metadata?.images?.some((image) => image.content));
    const labels = nodes.filter((node) => versionRootIdOf(node) === versionRootId).map((node) => (node.id === nodeId ? sourceLabel : node.metadata?.versionLabel)).filter((label): label is string => Boolean(label));
    const highest = Math.max(...labels.map((label) => label.charCodeAt(0) || LABEL_A), LABEL_A);
    const versionLabel = hasMedia || source.metadata?.versionLabel ? String.fromCharCode(Math.min(LABEL_Z, Math.max(LABEL_A, highest + 1))) : sourceLabel;
    const currentMetadata: CanvasNodeMetadata = { ...source.metadata, versionOfNodeId: versionRootId, versionLabel, versionPrimary: true };
    const updated = nodes.map((node) => {
        if (versionRootIdOf(node) !== versionRootId) return node;
        if (node.id === nodeId) return { ...node, metadata: currentMetadata };
        return { ...node, metadata: { ...node.metadata, versionPrimary: false } };
    });
    if (!hasMedia) return { nodes: updated, currentMetadata, versionRootId, versionLabel, snapshotLabel: null, snapshotId: null };
    const snapshot: CanvasNodeData = {
        ...source,
        id: snapshotId,
        title: `${stripVersionSuffix(source.title)} · ${sourceLabel}`,
        position: { x: source.position.x + offset, y: source.position.y + offset },
        metadata: snapshotMetadata(source.metadata, versionRootId, sourceLabel),
    };
    return { nodes: [...updated, snapshot], currentMetadata, versionRootId, versionLabel, snapshotLabel: sourceLabel, snapshotId };
}

export function listMediaVersions(nodes: readonly CanvasNodeData[], rootId: string): CanvasNodeData[] {
    return nodes.filter((node) => versionRootIdOf(node) === rootId && Boolean(node.metadata?.versionLabel)).sort((a, b) => (a.metadata?.versionLabel || "").localeCompare(b.metadata?.versionLabel || ""));
}

export function setPrimaryMediaVersion(nodes: readonly CanvasNodeData[], nodeId: string): CanvasNodeData[] {
    const target = nodes.find((node) => node.id === nodeId);
    if (!target) return [...nodes];
    const rootId = versionRootIdOf(target);
    return nodes.map((node) => (versionRootIdOf(node) === rootId ? { ...node, metadata: { ...node.metadata, versionPrimary: node.id === nodeId } } : node));
}
