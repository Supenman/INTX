import { useEffect, useMemo, useState } from "react";
import localforage from "localforage";
import { App, Button, Checkbox, Input, Modal, Spin } from "antd";
import { ArrowLeft, Check, Clapperboard, Import, Image as ImageIcon, Pencil, Video, X } from "lucide-react";
import { Toaster } from "sonner";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { EditorCore } from "@/lib/opencut/core";
import { EditorProvider } from "@/lib/opencut/components/providers/editor-provider";
import { AssetsPanel } from "@/lib/opencut/components/editor/panels/assets";
import { PropertiesPanel } from "@/lib/opencut/components/editor/panels/properties";
import { ExportButton } from "@/lib/opencut/components/editor/export-button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/lib/opencut/components/ui/resizable";
import { Timeline } from "@/lib/opencut/timeline/components";
import { PreviewPanel } from "@/lib/opencut/preview/components";
import { usePanelStore } from "@/lib/opencut/editor/panel-store";
import { usePasteMedia } from "@/lib/opencut/media/use-paste-media";
import { useEditor } from "@/lib/opencut/editor/use-editor";
import { createPreviewOverlayControl, isPreviewOverlayVisible, mergePreviewOverlaySources } from "@/lib/opencut/preview/overlays";
import { usePreviewStore } from "@/lib/opencut/preview/preview-store";
import { getGuidePreviewOverlaySource } from "@/lib/opencut/guides";
import { bookmarkNotesPreviewOverlay, getBookmarkPreviewOverlaySource } from "@/lib/opencut/timeline/bookmarks";
import { processMediaAssets } from "@/lib/opencut/media/processing";
import { storageService } from "@/lib/opencut/services/storage/service";
import { getImageBlob } from "@/services/image-storage";
import { getMediaBlob } from "@/services/file-storage";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import { SnapshotStorageStatus } from "@/components/layout/snapshot-storage-status";
import { TooltipProvider } from "@/lib/opencut/components/ui/tooltip";
import "./editor.css";

const projectStore = localforage.createInstance({ name: "intx-editing-studio", storeName: "project" });
type LocalMediaAsset = Exclude<Asset, { kind: "text" }>;

export default function EditingStudioPage() {
    const { t } = useTranslation();
    const [projectId, setProjectId] = useState("");
    const [loadError, setLoadError] = useState("");
    const hydrated = useAssetStore((state) => state.hydrated);
    const assetLoadError = useAssetStore((state) => state.loadError);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                await useAssetStore.getState().load();
                const savedId = await projectStore.getItem<string>("active-project");
                const saved = savedId ? await storageService.loadProject({ id: savedId }) : null;
                const id = savedId && saved ? savedId : await EditorCore.getInstance().project.createNewProject({ name: "INTX 剪辑项目" });
                if (!savedId || !saved) await projectStore.setItem("active-project", id);
                if (!cancelled) setProjectId(id);
            } catch (error) {
                if (!cancelled) setLoadError(error instanceof Error ? error.message : t("editingStudio.loadFailed"));
            }
        })();
        return () => { cancelled = true; };
    }, [t]);

    if (!hydrated) return <div className="flex h-full items-center justify-center"><SnapshotStorageStatus kind="assets" /></div>;
    if (assetLoadError) return <div className="flex h-full items-center justify-center"><SnapshotStorageStatus kind="assets" /></div>;
    if (loadError) return <div className="flex h-full items-center justify-center text-sm text-destructive">{t("editingStudio.loadFailed", { message: loadError })}</div>;
    if (!projectId) return <div className="flex h-full items-center justify-center"><Spin tip={t("editingStudio.loading")} /></div>;

    return <EditorProvider projectId={projectId}><EditorWorkspace /></EditorProvider>;
}

function EditorWorkspace() {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const fromCanvasId = searchParams.get("from") || "";
    const editor = useEditor();
    const activeProject = useEditor((state) => state.project.getActive());
    const libraryAssets = useAssetStore((state) => state.assets);
    const [libraryOpen, setLibraryOpen] = useState(false);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [importing, setImporting] = useState(false);
    const [renaming, setRenaming] = useState(false);
    const [projectName, setProjectName] = useState(activeProject?.metadata.name || "");
    const importedSourceIds = useMemo(() => new Set(editor.media.getAssets().map((asset) => asset.sourceAssetId).filter((id): id is string => Boolean(id))), [editor, libraryOpen, importing, editor.media.getAssets().length]);
    const mediaAssets = useMemo(() => libraryAssets.filter((asset): asset is LocalMediaAsset => asset.kind === "image" || asset.kind === "video"), [libraryAssets]);
    // 从画布进入时把该画布的素材置顶，避免在整库列表里翻找。
    const orderedAssets = useMemo(() => {
        if (!fromCanvasId) return mediaAssets;
        const isFromCanvas = (asset: LocalMediaAsset) => Boolean(asset.metadata?.canvasProjectId && asset.metadata.canvasProjectId === fromCanvasId);
        return [...mediaAssets.filter(isFromCanvas), ...mediaAssets.filter((asset) => !isFromCanvas(asset))];
    }, [fromCanvasId, mediaAssets]);
    const fromCanvasCount = useMemo(() => orderedAssets.filter((asset) => asset.metadata?.canvasProjectId === fromCanvasId).length, [fromCanvasId, orderedAssets]);
    const fromCanvasTitle = searchParams.get("title") || "";

    const saveProjectName = async () => {
        const name = projectName.trim();
        if (!activeProject || !name) return;
        const renamed = await editor.project.renameProject({ id: activeProject.metadata.id, name });
        if (!renamed) {
            message.error(t("editingStudio.renameFailed"));
            return;
        }
        setRenaming(false);
        message.success(t("editingStudio.projectRenamed"));
    };

    const importSelected = async () => {
        if (!activeProject) return;
        setImporting(true);
        const chosen = mediaAssets.filter((asset) => selectedIds.includes(asset.id) && !importedSourceIds.has(asset.id));
        let imported = 0;
        try {
            for (const asset of chosen) {
                const blob = asset.kind === "image"
                    ? asset.data.storageKey ? await getImageBlob(asset.data.storageKey) : await (await fetch(asset.data.dataUrl)).blob()
                    : asset.data.storageKey ? await getMediaBlob(asset.data.storageKey) : await (await fetch(asset.data.url)).blob();
                if (!blob) throw new Error(t("editingStudio.assetMissing", { name: asset.title }));
                const mimeType = blob.type || asset.data.mimeType || (asset.kind === "image" ? "image/png" : "video/mp4");
                const extension = mimeType.split("/")[1]?.split(";")[0] || (asset.kind === "image" ? "png" : "mp4");
                const file = new File([blob], `${asset.title}.${extension}`, { type: mimeType });
                const [processed] = await processMediaAssets({ files: [file] });
                if (!processed) throw new Error(t("editingStudio.assetImportFailed", { name: asset.title }));
                const saved = await editor.media.addMediaAsset({ projectId: activeProject.metadata.id, asset: { ...processed, sourceAssetId: asset.id } });
                if (!saved) throw new Error(t("editingStudio.assetImportFailed", { name: asset.title }));
                imported += 1;
            }
            setSelectedIds([]);
            setLibraryOpen(false);
            if (imported) message.success(t("editingStudio.importSuccess", { count: imported }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("editingStudio.assetImportFailedGeneric"));
        } finally {
            setImporting(false);
        }
    };

    return (
        <TooltipProvider>
        <div className="opencut-editor flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
            <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
                <div className="flex min-w-0 items-center gap-3">
                    <Button type="text" icon={<ArrowLeft className="size-4" />} onClick={() => navigate(fromCanvasId ? `/canvas/${fromCanvasId}` : "/canvas")}>{t(fromCanvasId ? "editingStudio.backToCanvas" : "editingStudio.back")}</Button>
                    <div className="flex min-w-0 items-center gap-2 border-l border-border pl-3 text-sm font-medium"><Clapperboard className="size-4 shrink-0" />{renaming ? <><Input size="small" autoFocus value={projectName} onChange={(event) => setProjectName(event.target.value)} onPressEnter={() => void saveProjectName()} className="w-48" /><Button type="text" size="small" icon={<Check className="size-4" />} onClick={() => void saveProjectName()} /><Button type="text" size="small" icon={<X className="size-4" />} onClick={() => { setProjectName(activeProject?.metadata.name || ""); setRenaming(false); }} /></> : <><span className="truncate">{activeProject?.metadata.name || t("editingStudio.title")}</span><Button type="text" size="small" aria-label={t("editingStudio.renameProject")} icon={<Pencil className="size-3.5" />} onClick={() => { setProjectName(activeProject?.metadata.name || ""); setRenaming(true); }} /></>}</div>
                </div>
                <div className="flex items-center gap-2">
                    <Button icon={<Import className="size-4" />} onClick={() => setLibraryOpen(true)}>{t("editingStudio.importFromLibrary")}</Button>
                    <ExportButton />
                </div>
            </header>
            <div className="min-h-0 flex-1">
                <EditorLayout />
            </div>
            <Modal title={t("editingStudio.libraryTitle")} open={libraryOpen} onCancel={() => setLibraryOpen(false)} onOk={() => void importSelected()} okText={t("editingStudio.importSelected")} cancelText={t("common.cancel")} confirmLoading={importing}>
                <p className="mb-3 text-sm text-muted-foreground">{t("editingStudio.libraryHint")}</p>
                {fromCanvasId ? (
                    <p className="mb-3 text-xs text-muted-foreground">
                        {fromCanvasCount ? t("editingStudio.libraryFromCanvas", { count: fromCanvasCount, title: fromCanvasTitle || t("editingStudio.fromCanvasFallback") }) : t("editingStudio.libraryFromCanvasEmpty", { title: fromCanvasTitle || t("editingStudio.fromCanvasFallback") })}
                    </p>
                ) : null}
                <div className="max-h-[55vh] overflow-y-auto divide-y divide-border">
                    {orderedAssets.map((asset) => {
                        const alreadyImported = importedSourceIds.has(asset.id);
                        return <label key={asset.id} className="flex cursor-pointer items-center gap-3 py-2.5">
                            <Checkbox disabled={alreadyImported} checked={alreadyImported || selectedIds.includes(asset.id)} onChange={(event) => setSelectedIds((ids) => event.target.checked ? [...ids, asset.id] : ids.filter((id) => id !== asset.id))} />
                            {asset.kind === "image" ? <ImageIcon className="size-4 shrink-0 text-muted-foreground" /> : <Video className="size-4 shrink-0 text-muted-foreground" />}
                            <span className="min-w-0 flex-1 truncate text-sm">{asset.title}</span>
                            <span className="text-xs text-muted-foreground">{alreadyImported ? t("editingStudio.imported") : t(`assets.kinds.${asset.kind}`)}</span>
                        </label>;
                    })}
                    {!orderedAssets.length && <p className="py-8 text-center text-sm text-muted-foreground">{t("editingStudio.emptyLibrary")}</p>}
                </div>
            </Modal>
            <Toaster position="bottom-right" />
        </div>
        </TooltipProvider>
    );
}

function EditorLayout() {
    usePasteMedia();
    const { panels, setPanel } = usePanelStore();
    const activeScene = useEditor((editor) => editor.scenes.getActiveSceneOrNull());
    const currentTime = useEditor((editor) => editor.playback.getCurrentTime());
    const activeGuide = usePreviewStore((state) => state.activeGuide);
    const overlays = usePreviewStore((state) => state.overlays);
    const setOverlayVisibility = usePreviewStore((state) => state.setOverlayVisibility);
    const showBookmarkNotes = isPreviewOverlayVisible({ overlay: bookmarkNotesPreviewOverlay, overlays });
    const overlaySource = useMemo(() => mergePreviewOverlaySources({ sources: [
        getGuidePreviewOverlaySource({ guideId: activeGuide }),
        activeScene ? getBookmarkPreviewOverlaySource({ bookmarks: activeScene.bookmarks, time: currentTime, isVisible: showBookmarkNotes }) : { definitions: [bookmarkNotesPreviewOverlay], instances: [] },
    ] }), [activeGuide, activeScene, currentTime, showBookmarkNotes]);
    const overlayControls = useMemo(() => overlaySource.definitions.map((overlay) => createPreviewOverlayControl({ overlay, overlays })), [overlaySource.definitions, overlays]);

    return <ResizablePanelGroup direction="vertical" className="size-full gap-[0.18rem]" onLayout={(sizes) => {
        setPanel({ panel: "mainContent", size: sizes[0] ?? panels.mainContent });
        setPanel({ panel: "timeline", size: sizes[1] ?? panels.timeline });
    }}>
        <ResizablePanel defaultSize={panels.mainContent} minSize={30} maxSize={85} className="min-h-0">
            <ResizablePanelGroup direction="horizontal" className="size-full gap-[0.19rem] px-3" onLayout={(sizes) => {
                setPanel({ panel: "tools", size: sizes[0] ?? panels.tools });
                setPanel({ panel: "preview", size: sizes[1] ?? panels.preview });
                setPanel({ panel: "properties", size: sizes[2] ?? panels.properties });
            }}>
                <ResizablePanel defaultSize={panels.tools} minSize={15} maxSize={40} className="min-w-0"><AssetsPanel /></ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={panels.preview} minSize={30} className="min-h-0 min-w-0 flex-1"><PreviewPanel overlayControls={overlayControls} overlayInstances={overlaySource.instances} onOverlayVisibilityChange={setOverlayVisibility} /></ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={panels.properties} minSize={15} maxSize={40} className="min-w-0"><PropertiesPanel /></ResizablePanel>
            </ResizablePanelGroup>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={panels.timeline} minSize={15} maxSize={70} className="min-h-0 px-3 pb-3"><Timeline /></ResizablePanel>
    </ResizablePanelGroup>;
}
