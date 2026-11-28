import { nanoid } from "nanoid";

import type { Asset, AssetKind } from "@/stores/use-asset-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export type AssetTagCount = {
    tag: string;
    count: number;
};

export function collectAssetTagCounts(assets: Asset[], kindFilter: AssetKind | "all"): AssetTagCount[] {
    const counts = new Map<string, number>();
    for (const asset of assets) {
        if (kindFilter !== "all" && asset.kind !== kindFilter) continue;
        const seen = new Set<string>();
        for (const rawTag of asset.tags || []) {
            const tag = rawTag.trim();
            if (!tag || seen.has(tag)) continue;
            seen.add(tag);
            counts.set(tag, (counts.get(tag) ?? 0) + 1);
        }
    }
    return [...counts.entries()]
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export function buildCanvasNodeFromAsset(asset: Asset): CanvasNodeData {
    if (asset.kind === "text") {
        return {
            id: nanoid(),
            type: CanvasNodeType.Text,
            title: asset.title,
            position: { x: 120, y: 120 },
            width: 320,
            height: 220,
            metadata: {
                content: asset.data.content,
                status: "success",
            },
        };
    }

    const naturalWidth = asset.data.width || 1280;
    const naturalHeight = asset.data.height || 720;
    const ratio = naturalHeight > 0 ? naturalWidth / naturalHeight : 16 / 9;
    const width = 360;
    const height = Math.max(180, Math.min(480, Math.round(width / Math.max(0.4, Math.min(2.5, ratio)))));

    if (asset.kind === "video") {
        return {
            id: nanoid(),
            type: CanvasNodeType.Video,
            title: asset.title,
            position: { x: 120, y: 120 },
            width,
            height,
            metadata: {
                content: asset.data.url || asset.coverUrl,
                storageKey: asset.data.storageKey,
                mimeType: asset.data.mimeType,
                bytes: asset.data.bytes,
                naturalWidth,
                naturalHeight,
                status: "success",
            },
        };
    }

    return {
        id: nanoid(),
        type: CanvasNodeType.Image,
        title: asset.title,
        position: { x: 120, y: 120 },
        width,
        height,
        metadata: {
            content: asset.data.dataUrl || asset.coverUrl,
            storageKey: asset.data.storageKey,
            mimeType: asset.data.mimeType,
            bytes: asset.data.bytes,
            naturalWidth,
            naturalHeight,
            status: "success",
        },
    };
}
