import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BookOpen, Bot, Clapperboard, FolderKanban, Images, ListChecks, Plus, ArrowRight, type LucideIcon } from "lucide-react";

import { SnapshotStorageStatus } from "@/components/layout/snapshot-storage-status";
import { PageHeader, PageShell } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { CanvasProjectPreview } from "@/components/canvas/canvas-project-card";
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
        () => [...projects].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 4),
        [projects],
    );
    const createCanvas = () => {
        if (!hydrated) return;
        const id = createProject(t("canvas.defaultTitle", { count: projects.length + 1 }));
        navigate(`/canvas/${id}`);
    };
    const shortcuts: Array<{ label: string; icon: LucideIcon; action: () => void }> = [
        { label: t("home.shortcuts.projects"), icon: FolderKanban, action: () => navigate("/canvas") },
        { label: t("home.shortcuts.editingStudio"), icon: Clapperboard, action: () => navigate("/editing-studio") },
        { label: t("home.shortcuts.assets"), icon: Images, action: () => navigate("/assets") },
        { label: t("home.shortcuts.skills"), icon: BookOpen, action: () => navigate("/skills") },
        { label: t("home.shortcuts.tasks"), icon: ListChecks, action: () => navigate("/tasks") },
        { label: t("home.shortcuts.agent"), icon: Bot, action: toggleAgentPanel },
    ];

    return (
        <PageShell>
            <main className="min-h-0 flex-1 overflow-y-auto pb-4">
                <PageHeader title={t("home.title")} description={t("home.description")} actions={<SnapshotStorageStatus kind="projects" />} />

                <button
                    type="button"
                    disabled={!hydrated}
                    onClick={createCanvas}
                    className="group focus-ring relative mt-4 flex min-h-44 w-full flex-col items-center justify-center overflow-hidden rounded-xl border border-border bg-[var(--surface-card)] px-4 text-center transition hover:bg-[var(--surface-card-hover)] disabled:cursor-wait disabled:opacity-60"
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
                    <div className="grid grid-cols-1 gap-3 @min-[420px]/workspace:grid-cols-2 @min-[680px]/workspace:grid-cols-3">
                        {shortcuts.map(({ label, icon: Icon, action }) => (
                            <button
                                key={label}
                                type="button"
                                onClick={action}
                                className="group focus-ring flex min-h-14 items-center gap-3 rounded-xl border border-border bg-[var(--surface-card)] px-4 text-left text-sm transition hover:bg-[var(--surface-card-hover)]"
                            >
                                <Icon className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
                                <span>{label}</span>
                            </button>
                        ))}
                    </div>
                </section>

                <section className="mt-10" aria-labelledby="home-recent-title">
                    <div className="mb-4 flex items-center justify-between gap-3">
                        <h2 id="home-recent-title" className="typ-heading">{t("home.recentProjects")}</h2>
                        <Link to="/canvas" className="inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground">
                            {t("home.viewAllProjects")} <ArrowRight className="size-4" />
                        </Link>
                    </div>
                    {!hydrated ? (
                        <div aria-busy="true" className="min-h-28 rounded-xl bg-[var(--surface-sunken)]" />
                    ) : recentProjects.length ? (
                        <div className="grid grid-cols-1 gap-4 @min-[480px]/workspace:grid-cols-2 @min-[960px]/workspace:grid-cols-4">
                            {recentProjects.map((project) => <RecentProject key={project.id} project={project} locale={i18n.resolvedLanguage || "zh-CN"} />)}
                        </div>
                    ) : (
                        <EmptyState icon={FolderKanban} title={t("home.emptyProjects")} description={t("home.emptyProjectsHint")} />
                    )}
                </section>
            </main>
        </PageShell>
    );
}

function RecentProject({ project, locale }: { project: CanvasProject; locale: string }) {
    const { t } = useTranslation();
    return (
        <Link to={`/canvas/${project.id}`} className="group focus-ring min-w-0 rounded-xl border border-border bg-[var(--surface-card)] p-3 text-left transition hover:bg-[var(--surface-card-hover)]">
            <CanvasProjectPreview project={project} />
            <span className="mt-2 flex items-center gap-2">
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">{project.title}</span>
                    <span className="typ-caption mt-1 block text-muted-foreground">
                        {t("canvas.project.updated", { date: new Date(project.updatedAt).toLocaleDateString(locale, { month: "short", day: "numeric" }) })}
                    </span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100" />
            </span>
        </Link>
    );
}
