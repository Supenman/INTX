import { Tag } from "antd";
import dayjs from "dayjs";
import { FileText, Image as ImageIcon, Video } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { Task } from "@/domain/task/model";
import { readTaskOutcome } from "@/domain/task/outcome";
import { cn } from "@/lib/utils";
import { assetCoverUrl, type Asset } from "@/stores/use-asset-store";

export function TaskGridCard({
    task,
    previewAsset,
    durationLabel,
    onOpen,
    onCopyRef,
}: {
    task: Task;
    previewAsset?: Asset;
    durationLabel: string;
    onOpen: (trigger: HTMLButtonElement) => void;
    onCopyRef: (ref: string) => void;
}) {
    const { t } = useTranslation();
    const outcome = readTaskOutcome(task);
    const needsConfirm = outcome?.regenerate === "confirm";
    const previewUrl = previewAsset ? assetCoverUrl(previewAsset) : "";
    const isRunning = task.status === "running" || task.status === "queued";
    const progressPct = task.upstreamProgress != null ? Math.max(0, Math.min(100, Math.round(task.upstreamProgress * 100))) : null;
    const FallbackIcon = task.kind === "video" ? Video : task.kind === "image" ? ImageIcon : FileText;

    return (
        <article className="surface-card-interactive group flex flex-col overflow-hidden hover:bg-[var(--surface-card-hover)] focus-within:bg-[var(--surface-card-hover)]">
            <button
                type="button"
                onClick={(event) => onOpen(event.currentTarget)}
                className="focus-ring relative block aspect-[16/10] w-full overflow-hidden bg-[var(--surface-sunken)] text-left"
            >
                {previewAsset && previewUrl ? (
                    previewAsset.kind === "video" ? (
                        <video src={`${previewUrl}#t=0.1`} muted playsInline preload="metadata" className="size-full object-cover" />
                    ) : (
                        <img src={previewUrl} alt="" loading="lazy" className="size-full object-cover motion-safe:transition-transform motion-safe:duration-200 motion-safe:group-hover:scale-[1.02]" />
                    )
                ) : (
                    <div className="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground">
                        <FallbackIcon className="size-6 opacity-70" />
                        <span className="typ-caption">{t(`tasks.kind.${task.kind}`, { defaultValue: task.kind })}</span>
                    </div>
                )}
                <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded-md border border-border bg-card/90 px-2 py-0.5 text-xs backdrop-blur-sm">
                    <span
                        className={cn(
                            "inline-block size-1.5 rounded-full",
                            task.status === "running"
                                ? "bg-emerald-500"
                                : task.status === "failed"
                                  ? "bg-red-500"
                                  : task.status === "canceled"
                                    ? "bg-muted-foreground/50"
                                    : task.status === "succeeded"
                                      ? "bg-muted-foreground"
                                      : "bg-amber-500",
                        )}
                    />
                    <span className="font-medium text-foreground">{t(`tasks.status.${task.status}`)}</span>
                </div>
                {needsConfirm ? (
                    <div className="absolute right-2 top-2">
                        <Tag color="gold" className="m-0">{t("tasks.policy.confirm")}</Tag>
                    </div>
                ) : null}
            </button>

            <div className="flex flex-1 flex-col justify-between p-3">
                <button
                    type="button"
                    onClick={(event) => onOpen(event.currentTarget)}
                    className="focus-ring block w-full rounded-sm text-left"
                >
                    <p className="line-clamp-2 text-sm font-medium text-foreground">{task.params.prompt || "—"}</p>
                    <div className="typ-caption mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground">
                        <span className="truncate">{task.params.model?.split("::").pop() || "—"}</span>
                        <span>·</span>
                        <span className="tabular-nums">{durationLabel}</span>
                    </div>
                </button>

                {isRunning && progressPct !== null ? (
                    <div className="mt-2.5" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPct}>
                        <div className="typ-caption mb-1 flex items-center justify-between text-muted-foreground">
                            <span>{task.phase ? t(`tasks.phase.${task.phase}`) : t("tasks.status.running")}</span>
                            <span className="tabular-nums">{progressPct}%</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-sunken)]">
                            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
                        </div>
                    </div>
                ) : null}

                <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-border/60 pt-2 text-xs text-muted-foreground">
                    <span className="tabular-nums">{dayjs(task.createdAt).format("MM-DD HH:mm")}</span>
                    {task.upstreamRef ? (
                        <Tag
                            className="m-0 cursor-pointer font-mono"
                            onClick={(event) => {
                                event.stopPropagation();
                                onCopyRef(task.upstreamRef ?? "");
                            }}
                        >
                            {task.upstreamRef.slice(0, 10)}
                        </Tag>
                    ) : task.resultAssetIds.length ? (
                        <span className="tabular-nums">{t("tasks.detail.results")} {task.resultAssetIds.length}</span>
                    ) : null}
                </div>
            </div>
        </article>
    );
}
