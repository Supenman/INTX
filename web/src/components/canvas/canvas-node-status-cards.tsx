import { useEffect, useState } from "react";
import { AlertCircle, ChevronDown, ChevronUp, Copy, ExternalLink, LoaderCircle, Play, RefreshCw, Video } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { useCopyText } from "@/hooks/use-copy-text";
import { colorGradeFilter } from "@/lib/canvas/color-grade";
import { hasResumableImageTask, hasResumableVideoTask } from "@/lib/canvas/canvas-generation-helpers";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { isBrokenVideoContent } from "@/lib/media-blob";
import type { CanvasNodeData } from "@/types/canvas";

function formatElapsed(seconds: number) {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${String(s).padStart(2, "0")}s`;
}

function formatVideoDuration(seconds: number) {
    if (!Number.isFinite(seconds) || seconds <= 0) return "";
    const total = Math.round(seconds);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
}

/** 节点生成中实时进度卡：展示已耗时、阶段文案、当前模型简称和平滑进度条。 */
export function CanvasNodeLoadingCard({ node, theme }: { node: CanvasNodeData; theme: CanvasTheme }) {
    const { t } = useTranslation();
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
        setElapsed(0);
        const startedAt = Date.now();
        const timer = window.setInterval(() => {
            setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
        }, 1000);
        return () => window.clearInterval(timer);
    }, [node.id]);

    const progress = Math.min(96, Math.round(8 + (1 - Math.exp(-elapsed / 32)) * 88));
    const modelShort = node.metadata?.model?.split("::").pop() || "";

    return (
        <div
            role="status"
            className="flex h-full w-full flex-col justify-between p-4"
            style={{ color: theme.node.text }}
        >
            <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2 text-xs font-medium">
                    <LoaderCircle aria-hidden className="size-4 shrink-0 motion-safe:animate-spin" style={{ color: theme.node.activeStroke }} />
                    <span className="truncate">{t("canvas.node.generating")}</span>
                </div>
                <span className="shrink-0 font-mono text-xs tabular-nums" style={{ color: theme.node.muted }}>
                    {formatElapsed(elapsed)}
                </span>
            </div>

            <div className="my-auto py-2 text-center">
                {modelShort ? (
                    <div className="mx-auto max-w-full truncate rounded-full border px-2.5 py-0.5 text-xs" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                        {modelShort}
                    </div>
                ) : null}
            </div>

            <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs tabular-nums" style={{ color: theme.node.muted }}>
                    <span>{t("canvas.node.inProgress")}</span>
                    <span>{progress}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: theme.node.stroke }}>
                    <div
                        className="h-full rounded-full transition-[width] duration-700 ease-out"
                        style={{ width: `${progress}%`, background: theme.node.activeStroke }}
                    />
                </div>
            </div>
        </div>
    );
}

/** 节点失败态错误卡：可展开/复制详细报错；严格保留任务三态防重复扣费规则。 */
export function CanvasNodeErrorCard({
    node,
    theme,
    onRetry,
}: {
    node: CanvasNodeData;
    theme: CanvasTheme;
    onRetry?: (node: CanvasNodeData) => void;
}) {
    const { t } = useTranslation();
    const copyText = useCopyText();
    const [expanded, setExpanded] = useState(false);
    const canQueryTask = hasResumableImageTask(node) || hasResumableVideoTask(node);
    const detail = node.metadata?.errorDetails?.trim() || t("canvas.node.failed");
    const isLong = detail.length > 72;

    return (
        <div
            className="flex w-full max-w-[280px] flex-col items-center gap-2.5 px-4 py-3 text-center"
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
        >
            <div className="flex items-center gap-1.5 text-xs font-medium text-destructive">
                <AlertCircle aria-hidden className="size-4 shrink-0" />
                <span>{t("canvas.node.failed")}</span>
            </div>
            <div
                role="alert"
                className={`w-full break-words text-xs leading-5 ${expanded ? "max-h-32 overflow-y-auto text-left" : "line-clamp-3"}`}
                style={{ color: theme.node.muted }}
            >
                {detail}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-1.5">
                {isLong ? (
                    <button
                        type="button"
                        className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs transition hover:bg-black/5 dark:hover:bg-white/10"
                        style={{ color: theme.node.muted }}
                        onClick={(event) => {
                            event.stopPropagation();
                            setExpanded((v) => !v);
                        }}
                    >
                        {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                        {t(expanded ? "canvas.node.collapseError" : "canvas.node.expandError")}
                    </button>
                ) : null}
                <button
                    type="button"
                    className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs transition hover:bg-black/5 dark:hover:bg-white/10"
                    style={{ color: theme.node.muted }}
                    onClick={(event) => {
                        event.stopPropagation();
                        copyText(detail, t("canvas.node.errorCopied"));
                    }}
                >
                    <Copy className="size-3.5" />
                    {t("canvas.node.copyError")}
                </button>
            </div>
            {node.metadata?.retryBlocked && !canQueryTask ? (
                <div className="flex flex-col items-center gap-1.5">
                    <span className="typ-label leading-4" style={{ color: theme.node.muted }}>
                        {t("canvas.node.retryBlockedHint")}
                    </span>
                    <Link
                        to="/tasks"
                        className="inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition hover:opacity-85"
                        style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                        onClick={(event) => event.stopPropagation()}
                    >
                        <ExternalLink className="size-3" />
                        {t("navigation.tasks")}
                    </Link>
                </div>
            ) : (
                <button
                    type="button"
                    className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition hover:scale-[1.02]"
                    style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                    onClick={(event) => {
                        event.stopPropagation();
                        onRetry?.(node);
                    }}
                >
                    <RefreshCw className="size-3.5" />
                    {t(canQueryTask ? "canvas.nodeToolbar.queryVideoTask" : "canvas.node.retry")}
                </button>
            )}
        </div>
    );
}

/** 画布视频节点预览：带首帧预加载占位、时长角标与清晰失败恢复入口。 */
export function CanvasVideoPreview({
    node,
    theme,
    onRetry,
}: {
    node: CanvasNodeData;
    theme: CanvasTheme;
    onRetry?: (node: CanvasNodeData) => void;
}) {
    const { t } = useTranslation();
    const [playbackFailed, setPlaybackFailed] = useState(false);
    const [metaReady, setMetaReady] = useState(false);
    const [durationSec, setDurationSec] = useState<number>(() => (node.metadata?.durationMs ? node.metadata.durationMs / 1000 : 0));

    useEffect(() => {
        setPlaybackFailed(false);
        setMetaReady(false);
        setDurationSec(node.metadata?.durationMs ? node.metadata.durationMs / 1000 : 0);
    }, [node.metadata?.content, node.metadata?.durationMs]);

    const broken = isBrokenVideoContent(node.metadata);
    if (!node.metadata?.content && !broken) {
        return (
            <div role="img" aria-label={t("canvas.node.emptyVideo")} className="grid h-full w-full place-items-center" style={{ color: theme.node.muted }}>
                <Play aria-hidden className="size-14 fill-current opacity-30" strokeWidth={1.2} />
            </div>
        );
    }

    if (broken || playbackFailed) {
        const canQuery = hasResumableVideoTask(node);
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2.5 px-4 text-center" style={{ color: theme.node.activeStroke }}>
                <Video className="size-7 opacity-60" />
                <span className="text-xs font-medium">{t("canvas.node.videoLoadFailed")}</span>
                {broken ? <span className="typ-label opacity-70">{t("canvas.node.videoRetryHint")}</span> : null}
                {canQuery && onRetry ? (
                    <button
                        type="button"
                        className="mt-1 inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium"
                        style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                            event.stopPropagation();
                            onRetry(node);
                        }}
                    >
                        <RefreshCw className="size-3" />
                        {t("canvas.nodeToolbar.queryVideoTask")}
                    </button>
                ) : null}
            </div>
        );
    }

    const durationLabel = formatVideoDuration(durationSec);
    return (
        <div className="relative h-full w-full overflow-hidden rounded-[var(--r-lg)]" style={{ background: theme.node.fill }}>
            {!metaReady ? (
                <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center" style={{ color: theme.node.muted }}>
                    <LoaderCircle aria-hidden className="size-5 motion-safe:animate-spin opacity-60" />
                </div>
            ) : null}
            {durationLabel ? (
                <span
                    className="pointer-events-none absolute right-2 top-2 z-10 rounded-md px-1.5 py-0.5 font-mono typ-label tabular-nums backdrop-blur-sm"
                    style={{ background: theme.toolbar.panel, color: theme.node.text }}
                >
                    {durationLabel}
                </span>
            ) : null}
            <video
                src={node.metadata?.content}
                controls
                preload="metadata"
                playsInline
                className="h-full w-full object-contain"
                style={{ filter: colorGradeFilter(node.metadata?.colorGrade) }}
                data-canvas-video={node.id}
                onLoadedMetadata={(event) => {
                    setMetaReady(true);
                    const d = event.currentTarget.duration;
                    if (Number.isFinite(d) && d > 0) setDurationSec(d);
                }}
                onError={() => setPlaybackFailed(true)}
            />
        </div>
    );
}
