import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
    ArrowRight,
    ArrowUp,
    AudioLines,
    Clapperboard,
    FolderKanban,
    Image as ImageIcon,
    Images,
    Plus,
    Sparkles,
    Video,
    type LucideIcon,
} from "lucide-react";

import { SnapshotStorageStatus } from "@/components/layout/snapshot-storage-status";
import { CanvasProjectPreview } from "@/components/canvas/canvas-project-card";
import { isImeComposing } from "@/lib/keyboard-event";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType } from "@/types/canvas";
import "./home-page.css";

type CapabilityItem = {
    id: string;
    label: string;
    detail: string;
    icon: LucideIcon;
    action: () => void;
};

function formatProjectDate(value: string, locale: string, fallback: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return fallback;
    return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(date);
}

export default function HomePage() {
    const { i18n, t } = useTranslation();
    const navigate = useNavigate();
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const createProject = useCanvasStore((state) => state.createProject);
    const [agentPrompt, setAgentPrompt] = useState("");
    const [targetProjectId, setTargetProjectId] = useState("");

    const sortedProjects = useMemo(
        () => [...projects].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
        [projects],
    );
    const recentProjects = sortedProjects.slice(0, 4);
    const targetAvailable = !targetProjectId || projects.some((project) => project.id === targetProjectId);
    const canSubmit = hydrated && Boolean(agentPrompt.trim()) && targetAvailable;
    const locale = i18n.resolvedLanguage || "zh-CN";

    const newProject = () => createProject(t("canvas.defaultTitle", { count: projects.length + 1 }));
    const launchCanvas = (initialNodeType?: CanvasNodeType) => {
        if (!hydrated) return;
        const id = newProject();
        navigate(`/canvas/${id}`, initialNodeType ? { state: { homeInitialNodeType: initialNodeType } } : undefined);
    };

    const startCreation = () => {
        const prompt = agentPrompt.trim();
        if (!hydrated || !prompt || !targetAvailable) return;
        const projectId = targetProjectId || newProject();
        navigate(`/canvas/${projectId}`, { state: { homeAgentPrompt: prompt } });
    };

    const starterPrompts = [
        t("home.starters.productAd"),
        t("home.starters.characterSheet"),
        t("home.starters.videoStoryboard"),
    ];

    const capabilities: CapabilityItem[] = [
        { id: "image", label: t("home.shortcuts.image"), detail: t("home.capabilityHints.image"), icon: ImageIcon, action: () => launchCanvas(CanvasNodeType.Image) },
        { id: "video", label: t("home.shortcuts.video"), detail: t("home.capabilityHints.video"), icon: Video, action: () => launchCanvas(CanvasNodeType.Video) },
        { id: "audio", label: t("home.shortcuts.audio"), detail: t("home.capabilityHints.audio"), icon: AudioLines, action: () => launchCanvas(CanvasNodeType.Audio) },
        { id: "studio", label: t("home.shortcuts.editingStudio"), detail: t("home.capabilityHints.editingStudio"), icon: Clapperboard, action: () => navigate("/editing-studio") },
        { id: "projects", label: t("home.shortcuts.projects"), detail: t("home.capabilityHints.projects"), icon: FolderKanban, action: () => navigate("/canvas") },
        { id: "assets", label: t("home.shortcuts.assets"), detail: t("home.capabilityHints.assets"), icon: Images, action: () => navigate("/assets") },
    ];

    return (
        <div className="@container/workspace flex h-full min-w-0 flex-col overflow-hidden bg-background text-foreground">
            <main className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8 lg:px-12 lg:py-9">
                <div className="mx-auto flex w-full max-w-6xl flex-col gap-7">
                    {/* 顶部点阵氛围 Agent 主舞台：聚焦 INTX Agent 对话创作入口，不再重复放「新建画布」按钮 */}
                    <section
                        className="intx-home-hero rounded-2xl border border-border px-4 py-8 sm:px-8 sm:py-10"
                        aria-labelledby="home-hero-title"
                    >
                        <span className="intx-home-dot-grid" aria-hidden />
                        <span className="intx-home-dot-glow" aria-hidden />
                        <div className="absolute right-4 top-3 z-10">
                            <SnapshotStorageStatus kind="projects" />
                        </div>

                        <div className="relative z-10 mx-auto flex max-w-3xl flex-col items-center">
                            <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-[var(--surface-card)] px-3 py-1 text-xs font-medium text-muted-foreground">
                                <Sparkles className="size-3.5 text-foreground" aria-hidden />
                                <span>INTX Agent</span>
                            </div>
                            <h1 id="home-hero-title" className="mt-3 text-center text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                                {t("home.agentHeading")}
                            </h1>
                            <p className="mt-1.5 text-center text-xs text-muted-foreground sm:text-sm">
                                {t("home.description")}
                            </p>

                            <form
                                className="mt-6 w-full"
                                onSubmit={(event) => {
                                    event.preventDefault();
                                    startCreation();
                                }}
                            >
                                <div className="rounded-2xl border border-border bg-[var(--surface-card)] p-2.5 shadow-[var(--shadow-lg)] focus-within:border-ring motion-safe:transition-colors">
                                    <textarea
                                        aria-labelledby="home-hero-title"
                                        className="focus-ring block w-full resize-none rounded-xl bg-transparent px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground"
                                        rows={3}
                                        value={agentPrompt}
                                        placeholder={t("home.agentPlaceholder")}
                                        onChange={(event) => setAgentPrompt(event.target.value)}
                                        onKeyDown={(event) => {
                                            if (!isImeComposing(event) && (event.metaKey || event.ctrlKey) && event.key === "Enter") {
                                                event.preventDefault();
                                                startCreation();
                                            }
                                        }}
                                    />
                                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-1 pt-2">
                                        <div className="flex min-w-0 items-center gap-2">
                                            <label className="flex min-w-0 max-w-full items-center gap-1.5 text-xs text-muted-foreground">
                                                <FolderKanban aria-hidden className="size-3.5 shrink-0" />
                                                <select
                                                    aria-label={t("home.targetProject")}
                                                    className="focus-ring min-w-0 max-w-48 cursor-pointer rounded-lg border border-border bg-[var(--surface-sunken)] px-2.5 py-1 text-xs text-foreground"
                                                    value={targetProjectId}
                                                    disabled={!hydrated}
                                                    onChange={(event) => setTargetProjectId(event.target.value)}
                                                >
                                                    <option value="">{t("home.newCanvasShort")}</option>
                                                    {!targetAvailable && (
                                                        <option value={targetProjectId} disabled>
                                                            {t("home.projectUnavailable")}
                                                        </option>
                                                    )}
                                                    {sortedProjects.map((project) => (
                                                        <option key={project.id} value={project.id}>
                                                            {project.title || t("canvas.project.untitled")}
                                                        </option>
                                                    ))}
                                                </select>
                                            </label>
                                            <span className="hidden text-xs text-muted-foreground/75 sm:inline">Ctrl + Enter</span>
                                        </div>

                                        <button
                                            type="submit"
                                            disabled={!canSubmit}
                                            className={`focus-ring inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3.5 text-xs font-medium motion-safe:transition motion-safe:enabled:active:scale-95 ${
                                                canSubmit
                                                    ? "bg-foreground text-background hover:opacity-90"
                                                    : "cursor-not-allowed bg-[var(--surface-sunken)] text-muted-foreground"
                                            }`}
                                        >
                                            <span>{t("home.continueWithAgent")}</span>
                                            <ArrowUp aria-hidden className="size-3.5" strokeWidth={2.2} />
                                        </button>
                                    </div>
                                </div>

                                <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
                                    {starterPrompts.map((promptText) => (
                                        <button
                                            key={promptText}
                                            type="button"
                                            onClick={() => setAgentPrompt(promptText)}
                                            className="focus-ring max-w-full cursor-pointer truncate rounded-full border border-border bg-[var(--surface-card)] px-3 py-1 text-xs text-muted-foreground transition hover:bg-[var(--surface-card-hover)] hover:text-foreground"
                                        >
                                            {promptText}
                                        </button>
                                    ))}
                                </div>
                            </form>
                        </div>
                    </section>

                    {/* 6 列非重复创作能力直达砖 */}
                    <nav aria-label={t("home.quickActions")}>
                        <div className="grid grid-cols-3 gap-2.5 @min-[760px]/workspace:grid-cols-6">
                            {capabilities.map(({ id, label, detail, icon: Icon, action }) => (
                                <button
                                    key={id}
                                    type="button"
                                    title={detail}
                                    onClick={action}
                                    className="group focus-ring flex min-w-0 cursor-pointer flex-col items-center gap-2 rounded-2xl py-1 text-center"
                                >
                                    <span className="grid h-14 w-full max-w-25 place-items-center rounded-2xl border border-transparent bg-[var(--surface-sunken)] text-foreground/85 group-hover:border-border group-hover:bg-[var(--surface-card-hover)] group-hover:text-foreground motion-safe:transition motion-safe:group-hover:-translate-y-0.5 motion-safe:group-active:scale-95">
                                        <Icon aria-hidden className="size-5.5" strokeWidth={1.7} />
                                    </span>
                                    <span className="w-full truncate text-xs font-medium text-foreground/90 group-hover:text-foreground">
                                        {label}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </nav>

                    {/* 最近项目：4 列横向圆角卡片 + 骨架屏 + 可点击首卡空态 */}
                    <section aria-labelledby="home-recent-title">
                        <div className="mb-3 flex items-center justify-between gap-3 px-1">
                            <div className="flex items-center gap-2">
                                <h2 id="home-recent-title" className="text-base font-medium tracking-tight text-foreground">
                                    {t("home.recentProjects")}
                                </h2>
                                {hydrated && projects.length > 0 ? (
                                    <span className="rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                                        {projects.length}
                                    </span>
                                ) : null}
                            </div>
                            <Link
                                to="/canvas"
                                className="focus-ring inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition hover:text-foreground"
                            >
                                <span>{t("home.viewAllProjects")}</span>
                                <ArrowRight className="size-3.5" aria-hidden />
                            </Link>
                        </div>

                        <div className="grid grid-cols-1 gap-3 @min-[620px]/workspace:grid-cols-2 @min-[1040px]/workspace:grid-cols-4">
                            {!hydrated ? (
                                Array.from({ length: 4 }, (_, index) => (
                                    <div
                                        key={index}
                                        aria-busy="true"
                                        className="intx-home-skeleton h-21 rounded-3xl border border-border"
                                    />
                                ))
                            ) : recentProjects.length > 0 ? (
                                recentProjects.map((project) => (
                                    <RecentProjectCard key={project.id} project={project} locale={locale} />
                                ))
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => launchCanvas()}
                                    className="group focus-ring flex h-21 min-w-0 cursor-pointer items-center gap-3.5 rounded-3xl border border-dashed border-border bg-[var(--surface-card)] p-1.5 pr-4 text-left transition hover:bg-[var(--surface-card-hover)] motion-safe:hover:-translate-y-0.5"
                                >
                                    <span className="grid h-18 w-24 shrink-0 place-items-center rounded-2xl bg-[var(--surface-sunken)] text-muted-foreground transition group-hover:text-foreground">
                                        <Plus className="size-6" aria-hidden />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-medium text-foreground">
                                            {t("home.createFirstCanvas")}
                                        </span>
                                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                            {t("home.emptyProjectsHint")}
                                        </span>
                                    </span>
                                </button>
                            )}
                        </div>
                    </section>
                </div>
            </main>
        </div>
    );
}

function RecentProjectCard({ project, locale }: { project: CanvasProject; locale: string }) {
    const { t } = useTranslation();
    const dateLabel = formatProjectDate(project.updatedAt, locale, t("home.justUpdated"));

    return (
        <Link
            to={`/canvas/${project.id}`}
            className="group focus-ring relative flex h-21 min-w-0 items-center gap-3.5 overflow-hidden rounded-3xl border border-border bg-[var(--surface-card)] p-1.5 pr-9 text-left transition hover:border-ring/60 hover:bg-[var(--surface-card-hover)] motion-safe:hover:-translate-y-0.5 motion-safe:active:scale-[0.99]"
        >
            <span className="h-18 w-24 shrink-0 overflow-hidden rounded-2xl bg-[var(--surface-sunken)] [&>div]:h-full [&>div]:aspect-auto [&>div]:rounded-none">
                <CanvasProjectPreview project={project} />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">
                    {project.title || t("canvas.project.untitled")}
                </span>
                <span className="mt-1 block truncate text-xs tabular-nums text-muted-foreground">
                    {dateLabel} · {t("home.nodeCountShort", { count: project.nodes.length })}
                </span>
            </span>
            <ArrowRight
                aria-hidden
                className="absolute right-3.5 size-4 shrink-0 text-muted-foreground opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100 group-focus-visible:opacity-100"
            />
        </Link>
    );
}
