import type { ImageAsset, VideoAsset } from "@/application/persistence/types";
import { getDataUrlByteSize } from "@/lib/image-utils";
import { previewUrlFor } from "@/services/image-storage";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

/**
 * 画布素材 → 资产库。
 *
 * 剪辑台的「从素材库导入」只读资产库，所以画布上已经生成/导入的图片和视频
 * 必须先落成资产，才能在剪辑台里一次选到。判定「已归档」用
 * `metadata.nodeId === node.id`，与画布单个节点「保存到资产」写入的元数据一致。
 */

/** 与 store 的 `addAsset` 入参同构；按 kind 判别，避免联合类型被 as 压平。 */
export type CanvasAssetInput =
    | (Omit<ImageAsset, "id" | "createdAt" | "updatedAt">)
    | (Omit<VideoAsset, "id" | "createdAt" | "updatedAt">);

export type CanvasAssetImportResult = {
    imported: number;
    skipped: number;
    /** 选中节点里内容缺失、无法建档的数量。 */
    failed: number;
};

export function collectCanvasMediaNodes(nodes: CanvasNodeData[]): CanvasNodeData[] {
    return nodes.filter((node) => {
        if (!node.metadata?.content) return false;
        return node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video;
    });
}

export function canvasNodeToAsset(node: CanvasNodeData, canvasProjectId: string): CanvasAssetInput | null {
    const metadata = node.metadata ?? {};
    const content = metadata.content ?? "";
    const title = metadata.prompt?.slice(0, 24) || node.title;
    if (node.type === CanvasNodeType.Video) {
        return {
            kind: "video",
            title,
            coverUrl: "",
            tags: [],
            source: "Canvas",
            data: {
                url: content,
                storageKey: metadata.storageKey,
                width: node.width,
                height: node.height,
                bytes: metadata.bytes || 0,
                mimeType: metadata.mimeType || "video/mp4",
            },
            metadata: { source: "canvas", nodeId: node.id, canvasProjectId, prompt: metadata.prompt },
        };
    }
    if (node.type !== CanvasNodeType.Image) return null;
    const useStorageKey = Boolean(metadata.storageKey);
    return {
        kind: "image",
        title,
        coverUrl: (useStorageKey ? previewUrlFor(metadata.storageKey) : undefined) || content,
        tags: [],
        source: "Canvas",
        data: {
            // 有 storageKey 时不在快照里存 base64，读取走 storageKey，避免快照翻倍。
            dataUrl: useStorageKey ? "" : content,
            storageKey: metadata.storageKey,
            width: metadata.naturalWidth || node.width,
            height: metadata.naturalHeight || node.height,
            bytes: metadata.bytes || getDataUrlByteSize(useStorageKey ? "" : content),
            mimeType: metadata.mimeType || "image/png",
        },
        metadata: { source: "canvas", nodeId: node.id, canvasProjectId, prompt: metadata.prompt },
    };
}

/**
 * 把画布里的图片/视频归档到资产库。
 * `selectedNodeIds` 为空表示全部；`archivedNodeIds` 由调用方从现有资产里收集。
 */
export function importCanvasMediaToAssets({
    canvasProjectId,
    nodes,
    selectedNodeIds,
    archivedNodeIds,
    addAsset,
}: {
    canvasProjectId: string;
    nodes: CanvasNodeData[];
    selectedNodeIds: ReadonlySet<string>;
    archivedNodeIds: ReadonlySet<string>;
    addAsset: (asset: CanvasAssetInput) => unknown;
}): CanvasAssetImportResult {
    const result: CanvasAssetImportResult = { imported: 0, skipped: 0, failed: 0 };
    for (const node of collectCanvasMediaNodes(nodes)) {
        if (selectedNodeIds.size && !selectedNodeIds.has(node.id)) continue;
        if (archivedNodeIds.has(node.id)) {
            result.skipped += 1;
            continue;
        }
        const asset = canvasNodeToAsset(node, canvasProjectId);
        if (!asset) {
            result.failed += 1;
            continue;
        }
        addAsset(asset);
        result.imported += 1;
    }
    return result;
}

/** 资产库里已归档到某个画布节点的 nodeId 集合。 */
export function archivedCanvasNodeIds(assets: { metadata?: Record<string, unknown> }[]): Set<string> {
    const ids = new Set<string>();
    for (const asset of assets) {
        const nodeId = asset.metadata?.nodeId;
        if (typeof nodeId === "string" && nodeId) ids.add(nodeId);
    }
    return ids;
}
