import { Check, Download, Ellipsis, FolderKanban, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { App, Button, Dropdown, Input, Select } from "antd";
import { useTranslation } from "react-i18next";

import { useSaveNotice } from "@/hooks/use-save-file";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { hasAgentUrlBootstrap } from "@/lib/agent/agent-url-bootstrap";
import { cn } from "@/lib/utils";
import { ensureImagePreview, getImagePreviewRevision, previewUrlFor, subscribeImagePreviews } from "@/services/image-storage";
import { CanvasNodeType } from "@/types/canvas";

export function CanvasProjectPreview({ project }: { project: CanvasProject }) {
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const cover = project.nodes.find((node) => node.type === CanvasNodeType.Image && (node.metadata?.storageKey || node.metadata?.content))?.metadata;
    const storageKey = cover?.storageKey;
    useEffect(() => {
        if (storageKey) void ensureImagePreview(storageKey).catch(() => {});
    }, [storageKey]);
    const src = previewUrlFor(storageKey) || (cover?.content?.startsWith("image:") ? undefined : cover?.content);

    return (
        <div className="grid aspect-[16/9] w-full place-items-center overflow-hidden rounded-lg bg-[var(--surface-sunken)] text-muted-foreground">
            {src ? <img src={src} alt="" loading="lazy" className="size-full object-cover" /> : <FolderKanban aria-hidden className="size-6" />}
        </div>
    );
}

export function CanvasProjectCard({ project, folderNames }: { project: CanvasProject; folderNames: string[] }) {
    const { message } = App.useApp();
    const { i18n, t } = useTranslation();
    const saveNotice = useSaveNotice();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const renameProject = useCanvasStore((state) => state.renameProject);
    const moveProjectsToFolder = useCanvasStore((state) => state.moveProjectsToFolder);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const editingId = useCanvasUiStore((state) => state.editingProjectId);
    const editingTitle = useCanvasUiStore((state) => state.editingProjectTitle);
    const startEditing = useCanvasUiStore((state) => state.startEditingProject);
    const setEditingTitle = useCanvasUiStore((state) => state.setEditingProjectTitle);
    const stopEditing = useCanvasUiStore((state) => state.stopEditingProject);
    const toggleSelected = useCanvasUiStore((state) => state.toggleSelectedProjectId);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const editing = editingId === project.id;
    const selected = selectedIds.includes(project.id);
    const open = () => {
        const agentHash = hasAgentUrlBootstrap(window.location.hash) ? window.location.hash : "";
        navigate(`/canvas/${project.id}${searchParams.toString() ? `?${searchParams.toString()}` : ""}${agentHash}`, { replace: Boolean(agentHash) });
    };
    const saveTitle = () => {
        renameProject(project.id, editingTitle);
        stopEditing();
    };
    const saveFolder = async (folders: string[]) => {
        moveProjectsToFolder([project.id], folders.at(-1));
        try {
            await useCanvasStore.getState().confirmSave();
        } catch {
            message.error(t("canvas.project.folderSaveFailed"));
        }
    };

    return (
        <article
            className={cn(
                "surface-card-interactive group flex min-h-44 cursor-pointer flex-col justify-between p-4 hover:bg-[var(--surface-card-hover)] focus-within:bg-[var(--surface-card-hover)]",
                selected && "ring-1 ring-inset ring-[var(--ring)]",
            )}
            onClick={() => !editing && open()}
        >
            <div className="mb-3 motion-safe:transition-transform motion-safe:duration-200 motion-safe:group-hover:scale-[1.015] motion-safe:group-focus-within:scale-[1.015]"><CanvasProjectPreview project={project} /></div>
            <div className="flex items-start gap-3">
                <input
                    type="checkbox"
                    checked={selected}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => toggleSelected(project.id, event.target.checked)}
                    className={cn("mt-1 size-4 accent-foreground transition-opacity", selected ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100")}
                    aria-label={t("canvas.project.select", { name: project.title })}
                />
                {editing ? (
                    <Input className="min-w-0" value={editingTitle} onClick={(event) => event.stopPropagation()} onChange={(event) => setEditingTitle(event.target.value)} onKeyDown={(event) => event.key === "Enter" && saveTitle()} autoFocus />
                ) : (
                    <button
                        type="button"
                        className="focus-ring min-w-0 cursor-pointer rounded-sm text-left"
                        onClick={(event) => {
                            event.stopPropagation();
                            open();
                        }}
                    >
                        <h2 className="typ-heading line-clamp-1 text-foreground">{project.title}</h2>
                        <p className="typ-caption mt-2 text-muted-foreground">{t("canvas.project.stats", { nodes: project.nodes.length, connections: project.connections.length })}</p>
                    </button>
                )}
            </div>
            <div className="mt-4 flex flex-wrap items-end justify-between gap-2">
                <div className="min-w-0 space-y-2">
                    <p className="typ-caption text-muted-foreground">{t("canvas.project.updated", { date: new Date(project.updatedAt).toLocaleString(i18n.resolvedLanguage, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) })}</p>
                    <Select
                        aria-label={t("canvas.project.folder")}
                        mode="tags"
                        size="small"
                        className="w-36"
                        maxTagCount={1}
                        allowClear
                        placeholder={t("canvas.project.addFolder")}
                        value={project.folder ? [project.folder] : []}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(folders) => void saveFolder(folders)}
                        options={folderNames.map((folder) => ({ value: folder, label: folder }))}
                    />
                </div>
                <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                    {editing ? (
                        <>
                            <Button type="text" size="small" shape="circle" icon={<Check className="size-4" />} onClick={saveTitle} aria-label={t("canvas.project.saveName")} />
                            <Button type="text" size="small" shape="circle" icon={<X className="size-4" />} onClick={stopEditing} aria-label={t("canvas.project.cancelRename")} />
                        </>
                    ) : (
                        <Dropdown
                            trigger={["click"]}
                            menu={{
                                items: [
                                    {
                                        key: "export",
                                        icon: <Download className="size-3.5" />,
                                        label: t("canvas.project.export"),
                                        onClick: () => void exportCanvasProjects([project], project.title || t("canvas.title")).then(saveNotice).catch((error) => saveNotice({ status: "failed", error })),
                                    },
                                    {
                                        key: "rename",
                                        icon: <Pencil className="size-3.5" />,
                                        label: t("canvas.project.rename"),
                                        onClick: () => startEditing(project.id, project.title),
                                    },
                                    { type: "divider" },
                                    {
                                        key: "delete",
                                        danger: true,
                                        icon: <Trash2 className="size-3.5" />,
                                        label: t("canvas.project.delete"),
                                        onClick: () => setDeleteIds([project.id]),
                                    },
                                ],
                            }}
                        >
                            <Button type="text" size="small" shape="circle" icon={<Ellipsis className="size-4" />} aria-label={t("common.more")} />
                        </Dropdown>
                    )}
                </div>
            </div>
        </article>
    );
}
