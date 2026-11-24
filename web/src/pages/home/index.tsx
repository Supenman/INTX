import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BookOpen, Bot, Clapperboard, FolderKanban, Images, ListChecks, Plus, ArrowRight, type LucideIcon } from "lucide-react";

import { SnapshotStorageStatus } from "@/components/layout/snapshot-storage-status";
import { PageHeader } from "@/components/layout/page-header";
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
        <div className="@container/workspace flex h-full min-w-0 flex-col overflow-hidden bg-background text-foreground">
            <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-10">
                <PageHeader title={t("home.title")} description={t("home.description")} actions={<SnapshotStorageStatus kind="projects" />} />

                <button
                    type="button"
                    disabled={!hydrated}
                    onClick={createCanvas}
                    className="group focus-ring relative mt-4 flex min-h-44 w-full flex-col items-center justify-center overflow-hidden rounded-xl border border-border bg-[var(--surface-card)] px-4 text-center transition hover:bg-[var(--surface-card-hover)] disabled:cursor-wait disabled:opacity-60"
                    style={{ backgroundImage: "radial-gradient(color-mix(in oklch, var(--muted-foreground) 22%, transparent) 1px, transparent 1.5px)", backgroundSize: "20px 20px" }}
                >
                    <span className="flex h-12 w-20 items-center justify-center rounded-2xl bg-foreground text-background shadow-sm motion-safe:transition-transform motion-safe:group-hover:scale-105">
                        <Plus className="size-7" />
                    </span>
                    <span className="mt-3 text-sm font-semibold">{t("home.newCanvas")}</span>
                    <span className="mt-1 text-xs text-muted-foreground">{t("home.newCanvasHint")}</span>
                </button>

                <section className="mt-7" aria-labelledby="home-shortcuts-title">
                    <h2 id="home-shortcuts-title" className="sr-only">{t("home.quickActions")}</h2>
                    <div className="grid grid-cols-2 gap-3 @min-[420px]/workspace:grid-cols-3 @min-[720px]/workspace:grid-cols-6">
                        {shortcuts.map(({ label, icon: Icon, action }) => (
                            <button
                                key={label}
                                type="button"
                                onClick={action}
                                className="group focus-ring flex min-w-0 flex-col items-center gap-2 rounded-xl p-1 text-center text-sm"
                            >
                                <span className="grid h-14 w-full max-w-24 place-items-center rounded-2xl bg-[var(--surface-card)] text-muted-foreground group-hover:bg-[var(--surface-card-hover)] group-hover:text-foreground motion-safe:transition-colors">
                                    <Icon aria-hidden className="size-5" />
                                </span>
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
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-4">
                            {recentProjects.map((project) => <RecentProject key={project.id} project={project} locale={i18n.resolvedLanguage || "zh-CN"} />)}
                        </div>
                    ) : (
                        <EmptyState icon={FolderKanban} title={t("home.emptyProjects")} description={t("home.emptyProjectsHint")} />
                    )}
                </section>
            </main>
        </div>
    );
}

function RecentProject({ project, locale }: { project: CanvasProject; locale: string }) {
    const { t } = useTranslation();
    return (
        <Link to={`/canvas/${project.id}`} className="group focus-ring flex min-w-0 items-center gap-3 rounded-2xl border border-border bg-[var(--surface-card)] p-1.5 pr-3 text-left hover:bg-[var(--surface-card-hover)] motion-safe:transition-colors">
            <div className="w-24 shrink-0">
                <CanvasProjectPreview project={project} />
            </div>
            <span className="flex min-w-0 flex-1 items-center gap-2">
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
