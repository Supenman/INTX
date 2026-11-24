import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BookOpen, Bot, Clapperboard, FolderKanban, Images, Layers3, ListChecks, Plus, ArrowRight, type LucideIcon } from "lucide-react";

import { SnapshotStorageStatus } from "@/components/layout/snapshot-storage-status";
import { useAgentStore } from "@/stores/use-agent-store";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";

export default function HomePage() {
    const { i18n, t } = useTranslation();
    const navigate = useNavigate();
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const createProject = useCanvasStore((state) => state.createProject);
    const toggleAgentPanel = useAgentStore((state) => state.togglePanel);
    const recentProjects = useMemo(
        () => [...projects].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 3),
        [projects],
    );
    const createCanvas = () => {
        if (!hydrated) return;
        const id = createProject(t("canvas.defaultTitle", { count: projects.length + 1 }));
        navigate(`/canvas/${id}`);
    };
    const shortcuts: Array<{ label: string; icon: LucideIcon; action: () => void }> = [
        { label: t("home.shortcuts.canvas"), icon: Layers3, action: createCanvas },
        { label: t("home.shortcuts.projects"), icon: FolderKanban, action: () => navigate("/canvas") },
        { label: t("home.shortcuts.editingStudio"), icon: Clapperboard, action: () => navigate("/editing-studio") },
        { label: t("home.shortcuts.assets"), icon: Images, action: () => navigate("/assets") },
        { label: t("home.shortcuts.skills"), icon: BookOpen, action: () => navigate("/skills") },
        { label: t("home.shortcuts.tasks"), icon: ListChecks, action: () => navigate("/tasks") },
        { label: t("home.shortcuts.agent"), icon: Bot, action: toggleAgentPanel },
    ];

    return (
        <main className="h-full overflow-y-auto bg-background px-6 py-8 lg:px-10">
            <div className="mx-auto w-full max-w-6xl">
                <header className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <p className="typ-caption text-muted-foreground">INTX</p>
                        <h1 className="typ-title mt-1">{t("home.title")}</h1>
                        <p className="typ-caption mt-1.5 text-muted-foreground">{t("home.description")}</p>
                    </div>
                    <SnapshotStorageStatus kind="projects" />
                </header>

                <button
                    type="button"
                    disabled={!hydrated}
                    onClick={createCanvas}
                    className="group relative mt-8 flex min-h-40 w-full flex-col items-center justify-center overflow-hidden rounded-2xl border border-border bg-[var(--surface-card)] transition hover:bg-[var(--surface-card-hover)] disabled:cursor-wait disabled:opacity-60"
                    style={{ backgroundImage: "radial-gradient(color-mix(in oklch, var(--muted-foreground) 22%, transparent) 1px, transparent 1.5px)", backgroundSize: "20px 20px" }}
                >
                    <span className="flex size-14 items-center justify-center rounded-2xl bg-foreground text-background shadow-sm transition-transform group-hover:scale-105">
                        <Plus className="size-7" />
                    </span>
                    <span className="mt-3 text-sm font-semibold">{t("home.newCanvas")}</span>
                    <span className="mt-1 text-xs text-muted-foreground">{t("home.newCanvasHint")}</span>
                </button>

                <section className="mt-7" aria-labelledby="home-shortcuts-title">
                    <h2 id="home-shortcuts-title" className="sr-only">{t("home.quickActions")}</h2>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-7">
                        {shortcuts.map(({ label, icon: Icon, action }) => (
                            <button
                                key={label}
                                type="button"
                                onClick={action}
                                className="group flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl bg-[var(--surface-card)] text-sm transition hover:bg-[var(--surface-card-hover)]"
                            >
                                <span className="flex size-12 items-center justify-center rounded-xl bg-background text-foreground transition-transform group-hover:-translate-y-0.5">
                                    <Icon className="size-5" />
                                </span>
                                <span>{label}</span>
                            </button>
                        ))}
                    </div>
                </section>

                <section className="mt-10" aria-labelledby="home-recent-title">
                    <div className="mb-4 flex items-center justify-between gap-3">
                        <h2 id="home-recent-title" className="text-base font-semibold">{t("home.recentProjects")}</h2>
                        <span className="flex items-center gap-4">
                            <button type="button" onClick={createCanvas} className="inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground">
                                {t("home.newCanvasShort")} <Plus className="size-4" />
                            </button>
                            <button type="button" onClick={() => navigate("/canvas")} className="inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground">
                                {t("home.viewAllProjects")} <ArrowRight className="size-4" />
                            </button>
                        </span>
                    </div>
                    {recentProjects.length ? (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                            {recentProjects.map((project) => <RecentProject key={project.id} project={project} locale={i18n.resolvedLanguage || "zh-CN"} onClick={() => navigate(`/canvas/${project.id}`)} />)}
                        </div>
                    ) : (
                        <button type="button" disabled={!hydrated} onClick={createCanvas} className="flex min-h-28 w-full flex-col items-center justify-center rounded-xl bg-[var(--surface-sunken)] px-5 text-center transition hover:bg-[var(--surface-card-hover)] disabled:opacity-60">
                            <span className="text-sm font-medium">{t("home.emptyProjects")}</span>
                            <span className="mt-1 text-xs text-muted-foreground">{t("home.emptyProjectsHint")}</span>
                        </button>
                    )}
                </section>
            </div>
        </main>
    );
}

function RecentProject({ project, locale, onClick }: { project: CanvasProject; locale: string; onClick: () => void }) {
    const { t } = useTranslation();
    return (
        <button type="button" onClick={onClick} className="group flex min-h-24 items-center gap-4 rounded-xl bg-[var(--surface-card)] p-4 text-left transition hover:bg-[var(--surface-card-hover)]">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-background text-muted-foreground">
                <FolderKanban className="size-6" />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">{project.title}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                    {t("canvas.project.stats", { nodes: project.nodes.length, connections: project.connections.length })} · {new Date(project.updatedAt).toLocaleDateString(locale, { month: "short", day: "numeric" })}
                </span>
            </span>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
        </button>
    );
}
