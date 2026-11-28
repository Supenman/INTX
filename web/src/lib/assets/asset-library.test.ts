import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
    if (typeof globalThis.localStorage === "undefined") {
        const storage = new Map<string, string>();
        Object.defineProperty(globalThis, "localStorage", {
            value: {
                getItem: (key: string) => storage.get(key) ?? null,
                setItem: (key: string, value: string) => { storage.set(key, String(value)); },
                removeItem: (key: string) => { storage.delete(key); },
                clear: () => { storage.clear(); },
            },
            configurable: true,
        });
    }
});

import type { Asset } from "@/stores/use-asset-store";
import { CanvasNodeType } from "@/types/canvas";
import { buildCanvasNodeFromAsset, collectAssetTagCounts } from "./asset-library";

describe("asset-library", () => {
    const sampleAssets: Asset[] = [
        {
            id: "a1",
            kind: "text",
            title: "Hero Prompt",
            coverUrl: "",
            tags: ["角色", "主角", " 角色 "],
            createdAt: "2026-10-01T00:00:00.000Z",
            updatedAt: "2026-10-01T00:00:00.000Z",
            data: { content: "Cinematic close-up portrait" },
        },
        {
            id: "a2",
            kind: "image",
            title: "Hero Portrait",
            coverUrl: "blob:cover",
            tags: ["角色", "分镜"],
            createdAt: "2026-10-02T00:00:00.000Z",
            updatedAt: "2026-10-02T00:00:00.000Z",
            data: { dataUrl: "blob:img", storageKey: "image:hero", width: 1024, height: 1536, bytes: 204800, mimeType: "image/png" },
        },
        {
            id: "a3",
            kind: "video",
            title: "Opening Shot",
            coverUrl: "blob:vcover",
            tags: ["分镜"],
            createdAt: "2026-10-03T00:00:00.000Z",
            updatedAt: "2026-10-03T00:00:00.000Z",
            data: { url: "blob:vid", storageKey: "media:shot", width: 1920, height: 1080, bytes: 1048576, mimeType: "video/mp4" },
        },
    ];

    it("collects deduplicated tag counts sorted by frequency and respects kind filter", () => {
        expect(collectAssetTagCounts(sampleAssets, "all")).toEqual([
            { tag: "分镜", count: 2 },
            { tag: "角色", count: 2 },
            { tag: "主角", count: 1 },
        ]);
        expect(collectAssetTagCounts(sampleAssets, "video")).toEqual([
            { tag: "分镜", count: 1 },
        ]);
    });

    it("builds valid canvas nodes for text, image, and video assets", () => {
        const textNode = buildCanvasNodeFromAsset(sampleAssets[0]);
        expect(textNode.type).toBe(CanvasNodeType.Text);
        expect(textNode.metadata?.content).toBe("Cinematic close-up portrait");

        const imageNode = buildCanvasNodeFromAsset(sampleAssets[1]);
        expect(imageNode.type).toBe(CanvasNodeType.Image);
        expect(imageNode.metadata?.storageKey).toBe("image:hero");
        expect(imageNode.width).toBe(360);
        expect(imageNode.height).toBe(480);

        const videoNode = buildCanvasNodeFromAsset(sampleAssets[2]);
        expect(videoNode.type).toBe(CanvasNodeType.Video);
        expect(videoNode.metadata?.storageKey).toBe("media:shot");
        expect(videoNode.width).toBe(360);
        expect(videoNode.height).toBe(203);
    });
});
