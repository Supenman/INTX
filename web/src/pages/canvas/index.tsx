import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { App, Button } from "antd";
import { Download, FileUp, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { readZip } from "@/lib/zip";
import { setMediaBlob } from "@/services/file-storage";
import { setImageBlob } from "@/services/image-storage";
import { CanvasDeleteProjectsDialog } from "@/components/canvas/canvas-delete-projects-dialog";
import { CanvasProjectCard } from "@/components/canvas/canvas-project-card";
import { PageHeader, PageShell } from "@/components/layout/page-header";
import type { CanvasExportFile } from "@/types/canvas-export";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { hasAgentUrlBootstrap } from "@/lib/agent/agent-url-bootstrap";
import { SnapshotStorageStatus } from "@/components/layout/snapshot-storage-status";

export default function CanvasPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const inputRef = useRef<HTMLInputElement>(null);
    const autoOpenRef = useRef(false);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const createProject = useCanvasStore((state) => state.createProject);
    const importProject = useCanvasStore((state) => state.importProject);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);

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
        <PageShell className="px-4 py-4 sm:px-6 sm:py-5">
            <main className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-6xl pb-4">
                    <PageHeader
                        title={t("canvas.title")}
                        description={t("canvas.description")}
                        actions={
                            <>
                                {selectedIds.length ? (
                                    <>
                                        <Button
                                            disabled={!hydrated}
                                            icon={<Download className="size-4" />}
                                            onClick={() => void exportCanvasProjects(projects.filter((project) => selectedIds.includes(project.id)), `${t("canvas.title")}-${selectedIds.length}`)}
                                        >
                                            {t("canvas.exportSelected")}
                                        </Button>
                                        <Button disabled={!hydrated} onClick={() => setDeleteIds(selectedIds)}>
                                            {t("canvas.deleteSelected")}
                                        </Button>
                                    </>
                                ) : null}
                                {projects.length ? (
                                    <Button disabled={!hydrated} type="text" onClick={() => setDeleteIds(projects.map((project) => project.id))}>
                                        {t("canvas.deleteAll")}
                                    </Button>
                                ) : null}
                                <Button type="text" disabled={!hydrated} icon={<FileUp className="size-4" />} onClick={() => inputRef.current?.click()}>
                                    {t("canvas.import")}
                                </Button>
                                <Button disabled={!hydrated} type="primary" icon={<Plus className="size-4" />} onClick={createAndEnter}>
                                    {t("canvas.create")}
                                </Button>
                            </>
                        }
                    />

                    <div className="mt-3">
                        <SnapshotStorageStatus kind="projects" />
                    </div>

                    {!hydrated ? (
                        <section className="mt-4 flex min-h-[360px] items-center justify-center rounded-xl bg-[var(--surface-sunken)]">
                            <SnapshotStorageStatus kind="projects" />
                        </section>
                    ) : projects.length ? (
                        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                            {projects.map((project) => (
                                <CanvasProjectCard key={project.id} project={project} />
                            ))}
                        </div>
                    ) : (
                        <section className="mt-4 flex min-h-[360px] flex-col items-center justify-center rounded-xl bg-[var(--surface-sunken)] px-6 text-center">
                            <div className="flex size-11 items-center justify-center rounded-full bg-[var(--surface-card)] text-muted-foreground">
                                <Plus className="size-5" />
                            </div>
                            <p className="typ-heading mt-4">{t("canvas.empty")}</p>
                            <p className="typ-caption mt-1.5 max-w-xs text-muted-foreground">{t("canvas.emptyDescription")}</p>
                            <Button type="primary" className="mt-5" icon={<Plus className="size-4" />} onClick={createAndEnter}>
                                {t("canvas.create")}
                            </Button>
                        </section>
                    )}
                </div>

                <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importCanvas(event.target.files?.[0])} />
                <CanvasDeleteProjectsDialog />
            </main>
        </PageShell>
    );
}
