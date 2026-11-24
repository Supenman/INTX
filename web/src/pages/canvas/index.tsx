import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { App, Button, Input, Modal, Select } from "antd";
import { Download, FileUp, Folder, Plus, RotateCcw, Search, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useSaveNotice } from "@/hooks/use-save-file";
import { readZip } from "@/lib/zip";
import { setMediaBlob } from "@/services/file-storage";
import { setImageBlob } from "@/services/image-storage";
import { CanvasDeleteProjectsDialog } from "@/components/canvas/canvas-delete-projects-dialog";
import { CanvasProjectCard } from "@/components/canvas/canvas-project-card";
import { PageHeader, PageShell } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import type { CanvasExportFile } from "@/types/canvas-export";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { hasAgentUrlBootstrap } from "@/lib/agent/agent-url-bootstrap";
import { SnapshotStorageStatus } from "@/components/layout/snapshot-storage-status";

export default function CanvasPage() {
    const { message, modal } = App.useApp();
    const { t } = useTranslation();
    const saveNotice = useSaveNotice();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const inputRef = useRef<HTMLInputElement>(null);
    const autoOpenRef = useRef(false);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const deletedProjects = useCanvasStore((state) => state.deletedProjects);
    const createProject = useCanvasStore((state) => state.createProject);
    const importProject = useCanvasStore((state) => state.importProject);
    const moveProjectsToFolder = useCanvasStore((state) => state.moveProjectsToFolder);
    const restoreDeletedProjects = useCanvasStore((state) => state.restoreDeletedProjects);
    const permanentlyDeleteProjects = useCanvasStore((state) => state.permanentlyDeleteProjects);
    const cleanupImages = useAssetStore((state) => state.cleanupImages);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const [folderFilter, setFolderFilter] = useState<string>();
    const [keyword, setKeyword] = useState("");
    const [batchFolder, setBatchFolder] = useState<string[]>([]);
    const [showTrash, setShowTrash] = useState(false);
    const folderNames = useMemo(() => [...new Set(projects.map((project) => project.folder?.trim()).filter((folder): folder is string => Boolean(folder)))].sort((a, b) => a.localeCompare(b)), [projects]);
    const trashProjects = useMemo(() => deletedProjects.filter((item) => item.project), [deletedProjects]);
    const unavailableTrashCount = deletedProjects.length - trashProjects.length;
    const visibleProjects = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return projects.filter((project) => (!folderFilter || project.folder === folderFilter) && (!query || [project.title, project.folder].some((value) => value?.toLowerCase().includes(query))));
    }, [folderFilter, keyword, projects]);
    const visibleSelectedIds = selectedIds.filter((id) => visibleProjects.some((project) => project.id === id));
    const moveSelectedToFolder = async (folder?: string) => {
        if (!visibleSelectedIds.length) return;
        moveProjectsToFolder(visibleSelectedIds, folder);
        setBatchFolder([]);
        try {
            await useCanvasStore.getState().confirmSave();
        } catch {
            message.error(t("canvas.project.folderSaveFailed"));
        }
    };
    const restoreProject = async (id: string) => {
        restoreDeletedProjects([id]);
        try {
            await useCanvasStore.getState().confirmSave();
            message.success(t("canvas.trash.restored"));
        } catch {
            message.error(t("canvas.project.folderSaveFailed"));
        }
    };
    const permanentlyDeleteProject = (id: string, title: string) => modal.confirm({
        title: t("canvas.trash.permanentTitle"),
        content: t("canvas.trash.permanentDescription", { name: title }),
        okText: t("canvas.trash.permanentDelete"),
        okButtonProps: { danger: true },
        cancelText: t("common.cancel"),
        onOk: async () => {
            permanentlyDeleteProjects([id]);
            try {
                await useCanvasStore.getState().confirmSave();
                cleanupImages();
                message.success(t("canvas.trash.permanentlyDeleted"));
            } catch {
                message.error(t("canvas.project.deleteSaveFailed"));
            }
        },
    });

    const mode = searchParams.get("mode");
    const agentMode = mode === "new" || mode === "recent" || mode === "choose";
    const agentQuery = agentMode ? `?${searchParams.toString()}` : "";
    const enterProject = (id: string) => {
        const agentHash = hasAgentUrlBootstrap(window.location.hash) ? window.location.hash : "";
        navigate(`/canvas/${id}${agentQuery}${agentHash}`, { replace: Boolean(agentHash) });
    };
    const createAndEnter = () => enterProject(createProject(t("canvas.defaultTitle", { count: projects.length + 1 })));
    const importCanvas = async (file?: File) => {
        if (!file) return;
        try {
            const zip = await readZip(file);
            const projectFile = zip.get("projects.json");
            if (!projectFile) throw new Error("missing projects.json");
            const data = JSON.parse(await projectFile.text()) as CanvasExportFile;
            await Promise.all(
                data.projects.flatMap((project) =>
                    project.files.map(async (item) => {
                        const blob = zip.get(item.path);
                        if (!blob) return;
                        const typedBlob = blob.type ? blob : blob.slice(0, blob.size, item.mimeType);
                        await (item.storageKey.startsWith("image:") ? setImageBlob(item.storageKey, typedBlob) : setMediaBlob(item.storageKey, typedBlob));
                    }),
                ),
            );
            data.projects.forEach((item) => importProject(item.project));
            try {
                await useCanvasStore.getState().confirmSave();
                message.success(t("canvas.imported", { count: data.projects.length }));
            } catch {
                message.error(t("canvas.importSaveFailed"));
            }
        } catch {
            message.error(t("canvas.importFailed"));
        } finally {
            if (inputRef.current) inputRef.current.value = "";
        }
    };

    useEffect(() => {
        if (!hydrated || autoOpenRef.current || (mode !== "new" && mode !== "recent")) return;
        autoOpenRef.current = true;
        enterProject(mode === "new" ? createProject(t("canvas.defaultTitle", { count: projects.length + 1 })) : projects[0]?.id || createProject(t("canvas.defaultTitle", { count: projects.length + 1 })));
    }, [createProject, hydrated, mode, projects, t]);

    if (hydrated && (mode === "new" || mode === "recent")) return <main className="flex h-full items-center justify-center bg-background typ-caption text-muted-foreground">{t("canvas.opening")}</main>;

    return (
        <PageShell>
            <main className="min-h-0 flex-1 overflow-y-auto">
                <div className="pb-4">
                    <PageHeader
                        title={t("navigation.canvas")}
                        description={t("canvas.description")}
                        actions={
                            <>
                                {!showTrash && selectedIds.length ? (
                                    <>
                                        <Button
                                            disabled={!hydrated}
                                            icon={<Download className="size-4" />}
                                            onClick={() => {
                                                void exportCanvasProjects(projects.filter((project) => selectedIds.includes(project.id)), `${t("canvas.title")}-${selectedIds.length}`)
                                                    .then(saveNotice)
                                                    .catch((error) => saveNotice({ status: "failed", error }));
                                            }}
                                        >
                                            {t("canvas.exportSelected")}
                                        </Button>
                                        <Button disabled={!hydrated} onClick={() => setDeleteIds(selectedIds)}>
                                            {t("canvas.deleteSelected")}
                                        </Button>
                                    </>
                                ) : null}
                                {!showTrash && projects.length ? (
                                    <>
                                        <span aria-hidden className="mx-1 h-5 w-px bg-border" />
                                        {/* 危险操作与常规次操作之间加分隔，并给危险色：之前它和其它 text 按钮同权重，看着像普通入口。 */}
                                        <Button disabled={!hydrated} danger type="text" onClick={() => setDeleteIds(projects.map((project) => project.id))}>
                                            {t("canvas.deleteAll")}
                                        </Button>
                                        <span aria-hidden className="mx-1 h-5 w-px bg-border" />
                                    </>
                                ) : null}
                                <Button type="text" disabled={!hydrated} icon={<Trash2 className="size-4" />} onClick={() => setShowTrash((value) => !value)}>
                                    {showTrash ? t("canvas.trash.backToLibrary") : t("canvas.trash.entry", { count: trashProjects.length })}
                                </Button>
                                {!showTrash ? <>
                                    <Button type="text" disabled={!hydrated} icon={<FileUp className="size-4" />} onClick={() => inputRef.current?.click()}>
                                        {t("canvas.import")}
                                    </Button>
                                    <Button disabled={!hydrated} type="primary" icon={<Plus className="size-4" />} onClick={createAndEnter}>
                                        {t("canvas.create")}
                                    </Button>
                                </> : null}
                            </>
                        }
                    />

                    <div className="workspace-toolbar">
                    {!showTrash && projects.length ? <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Input allowClear aria-label={t("canvas.projectSearch")} placeholder={t("canvas.projectSearch")} className="!w-48" prefix={<Search className="size-4 text-muted-foreground" />} value={keyword} onChange={(event) => setKeyword(event.target.value)} />
                        <Select
                            aria-label={t("canvas.folderFilter")}
                            className="min-w-44"
                            allowClear
                            placeholder={t("canvas.allFolders")}
                            value={folderFilter}
                            onChange={setFolderFilter}
                            options={folderNames.map((folder) => ({ value: folder, label: folder }))}
                        />
                        {visibleSelectedIds.length ? <Select
                            mode="tags"
                            className="min-w-48"
                            maxTagCount={1}
                            placeholder={t("canvas.moveToFolder")}
                            value={batchFolder}
                            onChange={(folders) => {
                                setBatchFolder(folders.slice(-1));
                                if (folders.length) void moveSelectedToFolder(folders.at(-1));
                                else void moveSelectedToFolder();
                            }}
                            options={folderNames.map((folder) => ({ value: folder, label: folder }))}
                            suffixIcon={<Folder className="size-4" />}
                        /> : null}
                    </div> : null}
                        <div className="ml-auto min-w-0"><SnapshotStorageStatus kind="projects" /></div>
                    </div>

                    {!hydrated ? (
                        <section className="surface-card mt-4 flex min-h-64 items-center justify-center">
                            <SnapshotStorageStatus kind="projects" />
                        </section>
                    ) : showTrash ? (
                        <>
                            {unavailableTrashCount ? <p className="mt-4 text-xs text-muted-foreground">{t("canvas.trash.unavailable", { count: unavailableTrashCount })}</p> : null}
                            {trashProjects.length ? <div className="mt-4 grid grid-cols-1 gap-4 @min-[480px]/workspace:grid-cols-2 @min-[760px]/workspace:grid-cols-3">
                                {trashProjects.map((item) => <article key={item.id} className="surface-card-interactive flex min-h-40 flex-col justify-between p-4">
                                    <div>
                                        <h2 className="typ-heading line-clamp-1">{item.project!.title}</h2>
                                        <p className="typ-caption mt-2 text-muted-foreground">{t("canvas.project.stats", { nodes: item.project!.nodes.length, connections: item.project!.connections.length })}</p>
                                        <p className="typ-caption mt-1 text-muted-foreground">{t("canvas.trash.deletedAt", { date: new Date(item.deletedAt).toLocaleString() })}</p>
                                    </div>
                                    <div className="mt-5 flex flex-wrap justify-end gap-2">
                                        <Button icon={<RotateCcw className="size-4" />} onClick={() => void restoreProject(item.id)}>{t("canvas.trash.restore")}</Button>
                                        <Button danger icon={<Trash2 className="size-4" />} onClick={() => permanentlyDeleteProject(item.id, item.project!.title)}>{t("canvas.trash.permanentDelete")}</Button>
                                    </div>
                                </article>)}
                            </div> : <EmptyState icon={Trash2} title={t("canvas.trash.empty")} className="mt-4" />}
                        </>
                    ) : visibleProjects.length ? (
                        <div className="mt-4 grid grid-cols-1 gap-4 @min-[480px]/workspace:grid-cols-2 @min-[760px]/workspace:grid-cols-3">
                            {visibleProjects.map((project) => (
                                <CanvasProjectCard key={project.id} project={project} folderNames={folderNames} />
                            ))}
                        </div>
                    ) : projects.length ? (
                        <EmptyState icon={keyword.trim() ? Search : Folder} title={t(keyword.trim() ? "canvas.projectNoResults" : "canvas.emptyFolder")} className="mt-4" action={<Button onClick={() => { setKeyword(""); setFolderFilter(undefined); }}>{t("assets.clearFilters")}</Button>} />
                    ) : (
                        <EmptyState
                            icon={Plus}
                            title={t("canvas.empty")}
                            description={t("canvas.emptyDescription")}
                            className="mt-4"
                            action={
                                <Button type="primary" icon={<Plus className="size-4" />} onClick={createAndEnter}>
                                    {t("canvas.create")}
                                </Button>
                            }
                        />
                    )}
                </div>

                <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importCanvas(event.target.files?.[0])} />
                <CanvasDeleteProjectsDialog />
            </main>
        </PageShell>
    );
}
