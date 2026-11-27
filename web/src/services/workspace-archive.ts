import { unzipSync, zipSync, type Zippable } from "fflate";
import localforage from "localforage";

import { isDesktopApp } from "@/lib/runtime/capabilities";
import { saveFile, type SaveFileOutcome } from "@/lib/runtime/save-file";
import { getMediaBlob, resolveMediaUrl, setMediaBlob } from "@/services/file-storage";
import { getImageBlob, resolveImageUrl, setImageBlob } from "@/services/image-storage";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import { useCanvasStore, type CanvasDeletedProject, type CanvasProject } from "@/stores/canvas/use-canvas-store";

type StoredLog = Record<string, unknown> & { id?: string };
export type ArchiveDomainKey = "canvas" | "assets" | "image-workbench" | "video-workbench";
type CanvasDomainData = { projects: CanvasProject[]; deleted: CanvasDeletedProject[] };
type AssetDomainData = { assets: Asset[] };
type LogDomainData = { logs: StoredLog[] };

type ArchiveFileEntry = {
    storageKey: string;
    path: string;
    mimeType: string;
    bytes: number;
};

type WorkspaceManifest = {
    app: "intx";
    version: 1;
    exportedAt: string;
    domains: {
        canvas: CanvasDomainData;
        assets: AssetDomainData;
        "image-workbench": LogDomainData;
        "video-workbench": LogDomainData;
    };
    files: ArchiveFileEntry[];
};

export type WorkspaceArchiveResult = {
    projects: number;
    assets: number;
    records: number;
    files: number;
    bytes: number;
    path?: string;
    canceled?: boolean;
};

export type ArchiveProgress = (stage: string) => void;

const ARCHIVE_MANIFEST_NAME = "manifest.json";
const STORAGE_KEY_PATTERN = /^(image|video|audio|file|video-reference|audio-reference):/;
const imageLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });
const videoLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" });

type DirectoryHandleLike = {
    name: string;
    getDirectoryHandle: (name: string, options?: { create?: boolean }) => Promise<DirectoryHandleLike>;
    getFileHandle: (name: string, options?: { create?: boolean }) => Promise<{
        getFile: () => Promise<File>;
        createWritable: () => Promise<{ write: (data: Blob | Uint8Array | string) => Promise<void>; close: () => Promise<void> }>;
    }>;
};

export function collectStorageKeys(value: unknown, keys = new Set<string>()): string[] {
    if (typeof value === "string") {
        if (STORAGE_KEY_PATTERN.test(value)) keys.add(value);
        return [...keys];
    }
    if (!value || typeof value !== "object") return [...keys];
    if ("storageKey" in value && typeof value.storageKey === "string" && STORAGE_KEY_PATTERN.test(value.storageKey)) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectStorageKeys(child, keys)) : collectStorageKeys(item, keys)));
    return [...keys];
}

export async function collectActiveStorageKeys(): Promise<Set<string>> {
    await Promise.all([useCanvasStore.getState().load(), useAssetStore.getState().load()]);
    const { projects, deletedProjects } = useCanvasStore.getState();
    const { assets } = useAssetStore.getState();
    const [imageLogs, videoLogs] = await Promise.all([readStoredLogs(imageLogStore), readStoredLogs(videoLogStore)]);
    const keys = new Set<string>();
    collectStorageKeys({ projects, deletedProjects, assets, imageLogs, videoLogs }, keys);
    return keys;
}

async function buildSnapshot(onProgress?: ArchiveProgress) {
    onProgress?.("读取本地项目与资产…");
    await Promise.all([useCanvasStore.getState().load(), useAssetStore.getState().load()]);
    const { projects, deletedProjects } = useCanvasStore.getState();
    const { assets } = useAssetStore.getState();
    const [imageLogs, videoLogs] = await Promise.all([readStoredLogs(imageLogStore), readStoredLogs(videoLogStore)]);

    const domains: WorkspaceManifest["domains"] = {
        canvas: { projects, deleted: deletedProjects },
        assets: { assets },
        "image-workbench": { logs: imageLogs },
        "video-workbench": { logs: videoLogs },
    };

    const storageKeys = collectStorageKeys(domains);
    const files: ArchiveFileEntry[] = [];
    const blobs = new Map<string, Blob>();
    let totalBytes = 0;

    for (let i = 0; i < storageKeys.length; i++) {
        const storageKey = storageKeys[i];
        onProgress?.(`收集媒体文件 (${i + 1}/${storageKeys.length})…`);
        const blob = storageKey.startsWith("image:") ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
        if (!blob || !blob.size) continue;
        const mimeType = blob.type || "application/octet-stream";
        const path = `files/${safeFileName(storageKey)}.${fileExtension(mimeType, storageKey)}`;
        files.push({ storageKey, path, mimeType, bytes: blob.size });
        blobs.set(path, blob);
        totalBytes += blob.size;
    }

    const manifest: WorkspaceManifest = {
        app: "intx",
        version: 1,
        exportedAt: new Date().toISOString(),
        domains,
        files,
    };
    return { manifest, blobs, totalBytes };
}

async function applyImportedSnapshot(
    manifest: WorkspaceManifest,
    readMedia: (entry: ArchiveFileEntry) => Promise<Blob | null>,
    onProgress?: ArchiveProgress,
): Promise<WorkspaceArchiveResult> {
    onProgress?.("加载当前本地数据…");
    await Promise.all([useCanvasStore.getState().load(), useAssetStore.getState().load()]);

    let restoredFiles = 0;
    let restoredBytes = 0;
    const entries = Array.isArray(manifest.files) ? manifest.files : [];
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        onProgress?.(`恢复媒体文件 (${i + 1}/${entries.length})…`);
        const existing = entry.storageKey.startsWith("image:") ? await getImageBlob(entry.storageKey) : await getMediaBlob(entry.storageKey);
        if (existing) continue;
        const blob = await readMedia(entry);
        if (!blob || !blob.size) continue;
        const typedBlob = blob.type ? blob : blob.slice(0, blob.size, entry.mimeType);
        await (entry.storageKey.startsWith("image:") ? setImageBlob(entry.storageKey, typedBlob) : setMediaBlob(entry.storageKey, typedBlob));
        restoredFiles += 1;
        restoredBytes += typedBlob.size;
    }

    onProgress?.("合并画布、资产与记录…");
    const localCanvas = useCanvasStore.getState();
    const mergedCanvas = mergeCanvasData(
        { projects: localCanvas.projects, deleted: localCanvas.deletedProjects },
        manifest.domains.canvas || { projects: [], deleted: [] },
    );
    localCanvas.replaceProjects(mergedCanvas.projects, mergedCanvas.deleted);
    await useCanvasStore.getState().confirmSave();

    const localAssets = useAssetStore.getState().assets;
    const mergedAssets = mergeById(localAssets, manifest.domains.assets?.assets || [], "updatedAt");
    useAssetStore.getState().replaceAssets(await Promise.all(mergedAssets.map(hydrateAsset)));
    await useAssetStore.getState().confirmSave();

    const [localImgLogs, localVidLogs] = await Promise.all([readStoredLogs(imageLogStore), readStoredLogs(videoLogStore)]);
    const mergedImgLogs = mergeById(localImgLogs, manifest.domains["image-workbench"]?.logs || [], "createdAt");
    const mergedVidLogs = mergeById(localVidLogs, manifest.domains["video-workbench"]?.logs || [], "createdAt");
    await Promise.all([replaceStoredLogs(imageLogStore, mergedImgLogs), replaceStoredLogs(videoLogStore, mergedVidLogs)]);

    return {
        projects: mergedCanvas.projects.length,
        assets: mergedAssets.length,
        records: mergedImgLogs.length + mergedVidLogs.length,
        files: restoredFiles,
        bytes: restoredBytes,
    };
}

export async function exportWorkspacePackage(onProgress?: ArchiveProgress): Promise<{ outcome: SaveFileOutcome; result: WorkspaceArchiveResult }> {
    const { manifest, blobs, totalBytes } = await buildSnapshot(onProgress);
    onProgress?.("正在打包工程文件…");

    const entries: Zippable = {
        [ARCHIVE_MANIFEST_NAME]: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
    };
    for (const [path, blob] of blobs.entries()) {
        entries[path] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
    }

    const zipped = zipSync(entries, { level: 1 });
    const archiveBlob = new Blob([new Uint8Array(zipped)], { type: "application/zip" });
    const stamp = formatTimestamp(new Date());
    onProgress?.("等待选择保存位置…");
    const outcome = await saveFile(archiveBlob, `intx-workspace-${stamp}.intx.zip`);

    return {
        outcome,
        result: {
            projects: manifest.domains.canvas.projects.length,
            assets: manifest.domains.assets.assets.length,
            records: manifest.domains["image-workbench"].logs.length + manifest.domains["video-workbench"].logs.length,
            files: manifest.files.length,
            bytes: totalBytes || archiveBlob.size,
            path: outcome.status === "saved" ? outcome.path : undefined,
            canceled: outcome.status === "canceled",
        },
    };
}

export async function importWorkspacePackage(file: File, onProgress?: ArchiveProgress): Promise<WorkspaceArchiveResult> {
    onProgress?.("正在解析工程包…");
    const bytes = new Uint8Array(await file.arrayBuffer());
    let extracted: Record<string, Uint8Array>;
    try {
        extracted = unzipSync(bytes);
    } catch {
        throw new Error("无法解压工程包，请确认选择的是有效的 .intx.zip 文件。");
    }

    const manifestBytes = extracted[ARCHIVE_MANIFEST_NAME];
    if (!manifestBytes) throw new Error("工程包缺少 manifest.json 清单文件。");
    const manifest = parseManifest(new TextDecoder().decode(manifestBytes));

    return applyImportedSnapshot(
        manifest,
        async (entry) => {
            const raw = extracted[entry.path];
            if (!raw) return null;
            return new Blob([new Uint8Array(raw)], { type: entry.mimeType });
        },
        onProgress,
    );
}

export async function backupWorkspaceToFolder(onProgress?: ArchiveProgress): Promise<WorkspaceArchiveResult> {
    if (isDesktopApp()) {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({ directory: true, multiple: false, title: "选择备份文件夹" });
        if (!selected || Array.isArray(selected)) return { projects: 0, assets: 0, records: 0, files: 0, bytes: 0, canceled: true };

        const { mkdir, writeFile, exists } = await import("@tauri-apps/plugin-fs");
        const { manifest, blobs } = await buildSnapshot(onProgress);
        const rootDir = joinPath(selected, "intx-workspace");
        const filesDir = joinPath(rootDir, "files");
        await mkdir(filesDir, { recursive: true });

        let writtenFiles = 0;
        let writtenBytes = 0;
        const entries = [...blobs.entries()];
        for (let i = 0; i < entries.length; i++) {
            const [relPath, blob] = entries[i];
            const target = joinPath(rootDir, relPath);
            if (await exists(target)) continue;
            onProgress?.(`写入媒体文件 (${i + 1}/${entries.length})…`);
            await writeFile(target, new Uint8Array(await blob.arrayBuffer()));
            writtenFiles += 1;
            writtenBytes += blob.size;
        }

        onProgress?.("写入工作区清单…");
        await writeFile(joinPath(rootDir, ARCHIVE_MANIFEST_NAME), new TextEncoder().encode(JSON.stringify(manifest, null, 2)));
        return {
            projects: manifest.domains.canvas.projects.length,
            assets: manifest.domains.assets.assets.length,
            records: manifest.domains["image-workbench"].logs.length + manifest.domains["video-workbench"].logs.length,
            files: writtenFiles,
            bytes: writtenBytes,
            path: rootDir,
        };
    }

    const picker = (window as unknown as { showDirectoryPicker?: (opts?: { mode?: string }) => Promise<DirectoryHandleLike> }).showDirectoryPicker;
    if (!picker) throw new Error("当前环境不支持直接读写本地文件夹，请使用下方「导出工程包」功能。");

    let parentHandle: DirectoryHandleLike;
    try {
        parentHandle = await picker({ mode: "readwrite" });
    } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return { projects: 0, assets: 0, records: 0, files: 0, bytes: 0, canceled: true };
        throw err;
    }

    const { manifest, blobs } = await buildSnapshot(onProgress);
    const rootHandle = await parentHandle.getDirectoryHandle("intx-workspace", { create: true });
    const filesHandle = await rootHandle.getDirectoryHandle("files", { create: true });

    let writtenFiles = 0;
    let writtenBytes = 0;
    const entries = [...blobs.entries()];
    for (let i = 0; i < entries.length; i++) {
        const [relPath, blob] = entries[i];
        const fileName = relPath.replace(/^files\//, "");
        onProgress?.(`写入媒体文件 (${i + 1}/${entries.length})…`);
        const fileHandle = await filesHandle.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        writtenFiles += 1;
        writtenBytes += blob.size;
    }

    onProgress?.("写入工作区清单…");
    const manifestHandle = await rootHandle.getFileHandle(ARCHIVE_MANIFEST_NAME, { create: true });
    const manifestWritable = await manifestHandle.createWritable();
    await manifestWritable.write(JSON.stringify(manifest, null, 2));
    await manifestWritable.close();

    return {
        projects: manifest.domains.canvas.projects.length,
        assets: manifest.domains.assets.assets.length,
        records: manifest.domains["image-workbench"].logs.length + manifest.domains["video-workbench"].logs.length,
        files: writtenFiles,
        bytes: writtenBytes,
        path: `${parentHandle.name}/intx-workspace`,
    };
}

export async function restoreWorkspaceFromFolder(onProgress?: ArchiveProgress): Promise<WorkspaceArchiveResult> {
    if (isDesktopApp()) {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({ directory: true, multiple: false, title: "选择备份文件夹（含 intx-workspace 或 manifest.json）" });
        if (!selected || Array.isArray(selected)) return { projects: 0, assets: 0, records: 0, files: 0, bytes: 0, canceled: true };

        const { readFile, exists } = await import("@tauri-apps/plugin-fs");
        let baseDir = selected;
        if (!(await exists(joinPath(baseDir, ARCHIVE_MANIFEST_NAME)))) {
            const nested = joinPath(selected, "intx-workspace");
            if (await exists(joinPath(nested, ARCHIVE_MANIFEST_NAME))) baseDir = nested;
            else throw new Error("所选文件夹中未找到 INTX 备份清单（manifest.json）。");
        }

        const rawManifest = await readFile(joinPath(baseDir, ARCHIVE_MANIFEST_NAME));
        const manifest = parseManifest(new TextDecoder().decode(rawManifest));
        const result = await applyImportedSnapshot(
            manifest,
            async (entry) => {
                const fullPath = joinPath(baseDir, entry.path);
                if (!(await exists(fullPath))) return null;
                const raw = await readFile(fullPath);
                return new Blob([new Uint8Array(raw)], { type: entry.mimeType });
            },
            onProgress,
        );
        return { ...result, path: baseDir };
    }

    const picker = (window as unknown as { showDirectoryPicker?: (opts?: { mode?: string }) => Promise<DirectoryHandleLike> }).showDirectoryPicker;
    if (!picker) throw new Error("当前环境不支持直接读取本地文件夹，请使用下方「导入工程包」功能。");

    let picked: DirectoryHandleLike;
    try {
        picked = await picker({ mode: "read" });
    } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return { projects: 0, assets: 0, records: 0, files: 0, bytes: 0, canceled: true };
        throw err;
    }

    let rootHandle = picked;
    let manifestFile: File;
    try {
        manifestFile = await (await rootHandle.getFileHandle(ARCHIVE_MANIFEST_NAME)).getFile();
    } catch {
        try {
            rootHandle = await picked.getDirectoryHandle("intx-workspace");
            manifestFile = await (await rootHandle.getFileHandle(ARCHIVE_MANIFEST_NAME)).getFile();
        } catch {
            throw new Error("所选文件夹中未找到 INTX 备份清单（manifest.json）。");
        }
    }

    const manifest = parseManifest(await manifestFile.text());
    let filesHandle: DirectoryHandleLike | null = null;
    try {
        filesHandle = await rootHandle.getDirectoryHandle("files");
    } catch {
        filesHandle = null;
    }

    const result = await applyImportedSnapshot(
        manifest,
        async (entry) => {
            if (!filesHandle) return null;
            try {
                const fileName = entry.path.replace(/^files\//, "");
                return await (await filesHandle.getFileHandle(fileName)).getFile();
            } catch {
                return null;
            }
        },
        onProgress,
    );
    return { ...result, path: rootHandle.name };
}

function parseManifest(raw: string): WorkspaceManifest {
    const parsed = JSON.parse(raw) as Partial<WorkspaceManifest>;
    if ((parsed.app !== "intx" && (parsed.app as unknown as string) !== "infinite-canvas") || !parsed.domains) {
        throw new Error("清单格式无效，不是有效的 INTX 工作区备份。");
    }
    return {
        app: "intx",
        version: 1,
        exportedAt: parsed.exportedAt || new Date().toISOString(),
        domains: {
            canvas: parsed.domains.canvas || { projects: [], deleted: [] },
            assets: parsed.domains.assets || { assets: [] },
            "image-workbench": parsed.domains["image-workbench"] || { logs: [] },
            "video-workbench": parsed.domains["video-workbench"] || { logs: [] },
        },
        files: Array.isArray(parsed.files) ? parsed.files : [],
    };
}

async function hydrateAsset(asset: Asset): Promise<Asset> {
    if (asset.kind === "image" && asset.data.storageKey) {
        const dataUrl = await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl);
        return { ...asset, coverUrl: asset.coverUrl.startsWith("blob:") ? dataUrl : asset.coverUrl, data: { ...asset.data, dataUrl } };
    }
    if (asset.kind === "video" && asset.data.storageKey) {
        const url = await resolveMediaUrl(asset.data.storageKey, asset.data.url);
        return { ...asset, coverUrl: asset.coverUrl.startsWith("blob:") ? url : asset.coverUrl, data: { ...asset.data, url } };
    }
    return asset;
}

async function readStoredLogs(store: typeof imageLogStore) {
    const logs: StoredLog[] = [];
    await store.iterate<StoredLog, void>((value) => {
        if (value && typeof value === "object") logs.push(value);
    });
    return logs;
}

async function replaceStoredLogs(store: typeof imageLogStore, logs: StoredLog[]) {
    await store.clear();
    for (const log of logs) {
        if (typeof log.id === "string" && log.id) await store.setItem(log.id, log);
    }
}

function mergeCanvasData(local: CanvasDomainData, remote: CanvasDomainData): CanvasDomainData {
    const tombstoneById = new Map<string, CanvasDeletedProject>();
    for (const item of [...(remote.deleted || []), ...(local.deleted || [])]) {
        if (!item.id || !item.deletedAt) continue;
        const current = tombstoneById.get(item.id);
        if (!current || item.deletedAt > current.deletedAt) tombstoneById.set(item.id, item.purged ? item : { ...item, project: item.project || current?.project });
        else if (item.deletedAt === current.deletedAt && item.purged && !current.purged) tombstoneById.set(item.id, item);
    }

    const projects = mergeById(local.projects || [], remote.projects || [], "updatedAt").filter((project) => {
        const tombstone = tombstoneById.get(project.id);
        if (!tombstone) return true;
        if (getTime(project as Record<string, unknown>, "updatedAt") > Date.parse(tombstone.deletedAt)) {
            tombstoneById.delete(project.id);
            return true;
        }
        return false;
    });
    return { projects, deleted: [...tombstoneById.values()] };
}

function mergeById<T extends { id?: string }>(local: T[], remote: T[], timeKey: string) {
    const items = new Map<string, T>();
    remote.forEach((item) => {
        if (item.id) items.set(item.id, item);
    });
    local.forEach((item) => {
        if (!item.id) return;
        const current = items.get(item.id);
        if (!current || getTime(item as Record<string, unknown>, timeKey) >= getTime(current as Record<string, unknown>, timeKey)) items.set(item.id, item);
    });
    return Array.from(items.values()).sort((a, b) => getTime(b as Record<string, unknown>, timeKey) - getTime(a as Record<string, unknown>, timeKey));
}

function getTime(item: Record<string, unknown>, key: string) {
    const value = item[key];
    if (typeof value === "number") return value;
    if (typeof value === "string") return Date.parse(value) || 0;
    return 0;
}

function joinPath(base: string, ...parts: string[]) {
    const sep = base.includes("\\") ? "\\" : "/";
    return [base.replace(/[\\/]+$/, ""), ...parts.map((part) => part.replace(/^[\\/]+|[\\/]+$/g, "").replace(/[\\/]+/g, sep))].join(sep);
}

function safeFileName(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, "_");
}

function fileExtension(mimeType: string, storageKey: string) {
    if (mimeType.includes("png")) return "png";
    if (mimeType.includes("jpeg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("webm")) return "webm";
    if (mimeType.includes("wav")) return "wav";
    if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
    return storageKey.startsWith("image:") ? "png" : "bin";
}

function formatTimestamp(date: Date) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}
