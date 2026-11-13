import { create } from "zustand";
import { nanoid } from "nanoid";
import { ok, err } from "@/domain/shared/result";
import type { Asset } from "@/application/persistence/types";
import type { AssetRepository, AssetSnapshot } from "@/application/ports/snapshotRepositories";
import { SnapshotPersistenceError } from "@/application/persistence/error";
import { createIndexedDBAssetRepository } from "@/infrastructure/storage/indexeddb-snapshot-repositories";
import { createAssetWriteQueue } from "@/infrastructure/storage/write-queue";
import { cleanupUnusedImages, ensureImagePreview, previewUrlFor, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { cleanupUnusedMedia, resolveMediaUrl } from "@/services/file-storage";

export type { AssetKind, TextAsset, ImageAsset, VideoAsset, Asset } from "@/application/persistence/types";

type AssetStore = AssetSnapshot & {
    hydrated: boolean;
    loadError: string | null;
    persistence: ReturnType<ReturnType<typeof createAssetWriteQueue>["getState"]>;
    load: () => Promise<void>;
    flush: () => Promise<void>;
    retrySave: () => Promise<void>;
    addAsset: (asset: Omit<Asset, "id" | "createdAt" | "updatedAt">) => string;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "createdAt">>) => void;
    removeAsset: (id: string) => void;
    replaceAssets: (assets: Asset[]) => void;
    cleanupImages: (extra?: unknown) => void;
};

// 卡片用缩略图渲染，自定义封面（远程地址或单独上传的封面）保持原样。
export function assetCoverUrl(asset: Asset) {
    const own = asset.kind === "image" ? asset.data.dataUrl : "";
    const cover = asset.coverUrl || own;
    return asset.kind === "image" && cover === own ? previewUrlFor(asset.data.storageKey) || cover : cover;
}

type AssetMedia = {
    restore: (assets: Asset[]) => Promise<Asset[]>;
    cleanup: (used: unknown) => Promise<void>;
};

/** 测试可注入纯 repository 和媒体适配；媒体异步步骤永远不在 IDB 事务里。 */
export function createAssetStore(repository: AssetRepository, media?: AssetMedia) {
    const queue = createAssetWriteQueue({
        ...repository,
        async load() {
            const result = await repository.load();
            if (!result.ok || !media) return result;
            try { return ok({ ...result.value, value: { assets: await media.restore(result.value.value.assets) } }); }
            catch { return err({ code: "read_failed" as const, message: "素材媒体恢复失败，未将错误当作空集合" }); }
        },
    });
    let loading: Promise<void> | null = null;
    let cleanupPending = false;
    const ensureReady = () => {
        if (!store.getState().hydrated) throw new SnapshotPersistenceError({ code: "unavailable", message: "素材尚未成功加载，已阻止修改原数据" });
    };
    const save = async (retry = false) => {
        ensureReady();
        const result = await (retry ? queue.retry() : queue.flush());
        if (!result.ok) throw new SnapshotPersistenceError(result.error);
    };
    const store = create<AssetStore>()((set, get) => ({
        hydrated: false, loadError: null, assets: [], persistence: queue.getState(),
        load: () => {
            if (get().hydrated) return Promise.resolve();
            if (loading) return loading;
            set({ loadError: null });
            loading = (async () => {
                const result = await queue.load();
                if (!result.ok) throw new SnapshotPersistenceError(result.error);
                set({ ...result.value.value, hydrated: true });
            })().catch((error: unknown) => {
                set({ loadError: error instanceof Error ? error.message : "素材读取失败" });
                throw error;
            }).finally(() => { loading = null; });
            return loading;
        },
        flush: () => save(), retrySave: () => save(true),
        addAsset: (asset) => {
            ensureReady();
            const now = new Date().toISOString();
            const id = nanoid();
            set((state) => ({ assets: [{ ...asset, id, createdAt: now, updatedAt: now } as Asset, ...state.assets] }));
            return id;
        },
        updateAsset: (id, patch) => {
            ensureReady();
            set((state) => ({ assets: state.assets.map((asset) => asset.id === id ? { ...asset, ...patch, updatedAt: new Date().toISOString() } as Asset : asset) }));
        },
        removeAsset: (id) => {
            ensureReady();
            cleanupPending = true;
            set((state) => ({ assets: state.assets.filter((asset) => asset.id !== id) }));
        },
        replaceAssets: (assets) => { ensureReady(); set({ assets }); },
        cleanupImages: (extra) => {
            // 原有调用方可以同步调度，但两类元数据确认之前不运行媒体删除。
            void (async () => {
                await save();
                if (media) await media.cleanup({ assets: get().assets, committedAssets: queue.getState().committedValue?.assets, extra });
            })().catch(() => { /* 保存失败已经可见；不启动媒体清理。 */ });
        },
    }));
    queue.subscribe((persistence) => {
        store.setState({ persistence });
        if (cleanupPending && persistence.loadState === "ready" && !persistence.dirty && !persistence.saving && !persistence.error) {
            cleanupPending = false;
            store.getState().cleanupImages();
        }
    });
    store.subscribe((state, previous) => {
        if (!previous.hydrated || state.assets === previous.assets) return;
        // 非法草稿保留在内存并显示保存失败；由 flush/retry 明确拒绝，不在订阅里打断渲染。
        queue.enqueue({ assets: state.assets });
    });
    return store;
}

const browserMedia: AssetMedia = {
    async restore(assets) {
        return Promise.all(assets.map(async (asset) => {
            if (asset.kind === "video" && asset.data.storageKey) return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } };
            if (asset.kind !== "image") return asset;
            if (asset.data.storageKey) {
                void ensureImagePreview(asset.data.storageKey).catch(() => { /* 预览不影响元数据加载。 */ });
                return {
                    ...asset, coverUrl: asset.coverUrl.startsWith("blob:") ? await resolveImageUrl(asset.data.storageKey, asset.coverUrl) : asset.coverUrl,
                    data: { ...asset.data, dataUrl: await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl) },
                };
            }
            if (!asset.data.dataUrl.startsWith("data:image/")) return asset;
            const image = await uploadImage(asset.data.dataUrl);
            return { ...asset, coverUrl: asset.coverUrl.startsWith("data:image/") ? image.url : asset.coverUrl, data: { ...asset.data, dataUrl: image.url, storageKey: image.storageKey, bytes: image.bytes, mimeType: image.mimeType } };
        }));
    },
    async cleanup(used) {
        const { useCanvasStore } = await import("@/stores/canvas/use-canvas-store");
        await useCanvasStore.getState().load();
        await useCanvasStore.getState().flush();
        // 沿用 0ms 媒体清理调度；延迟到此处之前已经确认项目/素材写入。
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        const state = useCanvasStore.getState();
        const references = { used, assets: useAssetStore.getState().assets, projects: state.projects, committedProjects: state.persistence.committedValue?.projects };
        await cleanupUnusedImages(references);
        await cleanupUnusedMedia(references);
    },
};
export const useAssetStore = createAssetStore(createIndexedDBAssetRepository(), browserMedia);
void useAssetStore.getState().load().catch(() => { /* 读取错误留在 store，由 UI 显示和重试。 */ });
