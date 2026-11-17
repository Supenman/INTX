import { App, Button, Drawer, Input, Segmented, Spin, Tag } from "antd";
import dayjs from "dayjs";
import { saveAs } from "file-saver";
import { ClipboardList, Copy, Download, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { PageHeader, PageShell } from "@/components/layout/page-header";
import type { Task } from "@/domain/task/model";
import { readTaskOutcome, type OutcomeReason } from "@/domain/task/outcome";
import { useCopyText } from "@/hooks/use-copy-text";
import { loadTaskLog, useTaskLogStore } from "@/services/generation";

type Bucket = "all" | "running" | "succeeded" | "ended";

const BUCKETS: Bucket[] = ["all", "running", "succeeded", "ended"];

function bucketOf(task: Task): Exclude<Bucket, "all"> {
    if (task.status === "queued" || task.status === "running") return "running";
    if (task.status === "succeeded") return "succeeded";
    return "ended";
}

function durationMs(task: Task): number | null {
    const start = task.startedAt ?? task.createdAt;
    const end = task.finishedAt ?? Date.now();
    return end > start ? end - start : null;
}

function formatDuration(ms: number | null): string {
    if (ms === null) return "—";
    const seconds = ms / 1000;
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${Math.round(seconds % 60)}s`;
}

/** 只读台账：没有重发按钮——已收单的旧单重新提交就是再买一张。 */
export default function TasksPage() {
    const { t } = useTranslation();
    const copyText = useCopyText();
    const tasks = useTaskLogStore((state) => state.tasks);
    const loading = useTaskLogStore((state) => state.loading);
    const hydrated = useTaskLogStore((state) => state.hydrated);
    const loadError = useTaskLogStore((state) => state.loadError);
    const [bucket, setBucket] = useState<Bucket>("all");
    const [keyword, setKeyword] = useState("");
    const [selectedId, setSelectedId] = useState<string | null>(null);

    useEffect(() => {
        void loadTaskLog();
    }, []);

    const counts = useMemo(() => {
        const out: Record<Bucket, number> = { all: tasks.length, running: 0, succeeded: 0, ended: 0 };
        for (const task of tasks) out[bucketOf(task)] += 1;
        return out;
    }, [tasks]);

    const filtered = useMemo(() => {
        const q = keyword.trim().toLowerCase();
        return tasks.filter((task) => {
            if (bucket !== "all" && bucketOf(task) !== bucket) return false;
            if (!q) return true;
            const haystack = [task.params.prompt, task.params.model, task.id, task.upstreamRef ?? ""].join(" ").toLowerCase();
            return haystack.includes(q);
        });
    }, [tasks, bucket, keyword]);

    const selected = useMemo(() => tasks.find((task) => task.id === selectedId) ?? null, [tasks, selectedId]);

    const exportDiagnostics = (task: Task) => {
        const { revision: _revision, ...value } = task as Task & { revision?: number };
        const payload = {
            exportedAt: new Date().toISOString(),
            note: "本地任务台账快照；不含 API Key、Base URL 与参考图数据",
            task: value,
            outcome: readTaskOutcome(task),
        };
        saveAs(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), `task-${task.id}.json`);
    };

    const reasonText = (reason: OutcomeReason) => t(`tasks.reason.${reason}`, { defaultValue: reason });

    return (
        <PageShell className="px-6 py-5">
            <main className="min-h-0 flex-1 overflow-y-auto">
                <PageHeader
                    title={t("tasks.title")}
                    description={t("tasks.description")}
                    actions={
                        <Input
                            allowClear
                            className="w-60"
                            prefix={<Search className="size-4 text-muted-foreground" />}
                            placeholder={t("tasks.search")}
                            value={keyword}
                            onChange={(event) => setKeyword(event.target.value)}
                        />
                    }
                />

                <div className="mt-4">
                    <Segmented<Bucket>
                        value={bucket}
                        onChange={(value) => setBucket(value)}
                        options={BUCKETS.map((value) => ({
                            value,
                            label: `${t(`tasks.filter.${value}`)} ${counts[value]}`,
                        }))}
                    />
                </div>

                <div className="mt-4 pb-6">
                    {loadError ? (
                        <div role="alert" className="mb-3 rounded-lg border border-red-200 px-4 py-3 text-sm text-red-600 dark:border-red-900/60 dark:text-red-400">
                            {loadError}{" "}
                            <Button size="small" onClick={() => void loadTaskLog()}>
                                {t("tasks.actions.reload")}
                            </Button>
                        </div>
                    ) : null}

                    {!hydrated && loading ? (
                        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
                            <Spin size="small" className="mr-2" />
                            {t("tasks.loading")}
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-border px-4 py-16 text-center text-sm text-muted-foreground">
                            <ClipboardList className="mx-auto mb-2 size-5" />
                            <div className="text-foreground">{t(tasks.length === 0 ? "tasks.empty.none" : "tasks.empty.noMatch")}</div>
                            <div className="mt-1">{t(tasks.length === 0 ? "tasks.empty.noneHint" : "tasks.empty.noMatchHint")}</div>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {filtered.map((task) => {
                                const outcome = readTaskOutcome(task);
                                const needsConfirm = outcome?.regenerate === "confirm";
                                return (
                                    <button
                                        key={task.id}
                                        type="button"
                                        onClick={() => setSelectedId(task.id)}
                                        className="block w-full rounded-lg border border-border px-4 py-3 text-left transition hover:border-stone-300 hover:bg-stone-50/60 dark:hover:border-stone-700 dark:hover:bg-stone-900/40"
                                    >
                                        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                                            <div className="min-w-0 flex-1">
                                                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                                    <span className={`inline-block size-1.5 rounded-full ${task.status === "running" ? "bg-emerald-500" : task.status === "failed" ? "bg-red-500" : task.status === "canceled" ? "bg-stone-400" : task.status === "succeeded" ? "bg-stone-500" : "bg-amber-500"}`} />
                                                    <span>{t(`tasks.kind.${task.kind}`, { defaultValue: task.kind })}</span>
                                                    <span>·</span>
                                                    <span className="min-w-0 break-all">{task.params.model || "—"}</span>
                                                    <span>·</span>
                                                    <span>{t(`tasks.status.${task.status}`)}</span>
                                                    {task.status === "running" && task.phase ? <span>· {t(`tasks.phase.${task.phase}`)}</span> : null}
                                                </div>
                                                <div className="mt-1.5 truncate text-sm text-foreground">{task.params.prompt || "—"}</div>
                                                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                                    <span>{dayjs(task.createdAt).format("MM-DD HH:mm")}</span>
                                                    <span>{t("tasks.detail.duration")} {formatDuration(durationMs(task))}</span>
                                                    {task.params.count ? <span>{t("tasks.detail.count")} {task.params.count}</span> : null}
                                                    {task.resultAssetIds.length ? <span>{t("tasks.detail.results")} {task.resultAssetIds.length}</span> : null}
                                                    {task.cost ? <span>{task.cost.amount} {task.cost.currency}</span> : null}
                                                </div>
                                            </div>
                                            <div className="flex shrink-0 items-center gap-2">
                                                {needsConfirm ? <Tag color="gold">{t("tasks.policy.confirm")}</Tag> : null}
                                                {task.upstreamRef ? (
                                                    <Tag
                                                        className="cursor-pointer font-mono"
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            copyText(task.upstreamRef ?? "", t("tasks.actions.copied"));
                                                        }}
                                                    >
                                                        {task.upstreamRef.slice(0, 12)}
                                                    </Tag>
                                                ) : null}
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            </main>

            {selected ? (
                <Drawer
                    open
                    size="large"
                    onClose={() => setSelectedId(null)}
                    title={`${t(`tasks.kind.${selected.kind}`, { defaultValue: selected.kind })} · ${t(`tasks.status.${selected.status}`)}`}
                    destroyOnHidden
                >
                    <TaskDetail task={selected} reasonText={reasonText} onCopy={copyText} onExport={exportDiagnostics} />
                </Drawer>
            ) : null}
        </PageShell>
    );
}

function TaskDetail({
    task,
    reasonText,
    onCopy,
    onExport,
}: {
    task: Task;
    reasonText: (reason: OutcomeReason) => string;
    onCopy: (text: string, successMessage?: string) => void;
    onExport: (task: Task) => void;
}) {
    const { t } = useTranslation();
    const outcome = readTaskOutcome(task);
    const policy = outcome?.regenerate ?? null;
    const reason = outcome?.reason ?? null;
    const rows: Array<[string, string]> = [
        [t("tasks.detail.id"), task.id],
        [t("tasks.detail.model"), task.params.model || "—"],
        [t("tasks.detail.status"), `${t(`tasks.status.${task.status}`)}${task.phase ? ` · ${t(`tasks.phase.${task.phase}`)}` : ""}`],
        [t("tasks.detail.attempt"), String(task.attempt)],
        [t("tasks.detail.created"), dayjs(task.createdAt).format("YYYY-MM-DD HH:mm:ss")],
        [t("tasks.detail.started"), task.startedAt ? dayjs(task.startedAt).format("YYYY-MM-DD HH:mm:ss") : "—"],
        [t("tasks.detail.finished"), task.finishedAt ? dayjs(task.finishedAt).format("YYYY-MM-DD HH:mm:ss") : "—"],
        [t("tasks.detail.duration"), formatDuration(durationMs(task))],
        [t("tasks.detail.aspect"), task.params.aspectRatio ?? "—"],
        [t("tasks.detail.count"), task.params.count ? String(task.params.count) : "—"],
        [t("tasks.detail.references"), String(task.params.inputAssetIds.length)],
        [t("tasks.detail.results"), String(task.resultAssetIds.length)],
        [t("tasks.detail.cost"), task.cost ? `${task.cost.amount} ${task.cost.currency}` : "—"],
        [t("tasks.detail.errorCode"), task.error?.code ?? "—"],
    ];

    return (
        <div className="space-y-4 text-sm">
            <div className="rounded-lg border border-border px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                        <div className="text-xs text-muted-foreground">{t("tasks.detail.upstreamRef")}</div>
                        <div className="mt-0.5 truncate font-mono text-foreground">{task.upstreamRef || "—"}</div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                        <Button size="small" icon={<Copy className="size-3.5" />} disabled={!task.upstreamRef} onClick={() => onCopy(task.upstreamRef ?? "", t("tasks.actions.copied"))}>
                            {t("tasks.actions.copyRef")}
                        </Button>
                        <Button size="small" icon={<Download className="size-3.5" />} onClick={() => onExport(task)}>
                            {t("tasks.actions.export")}
                        </Button>
                    </div>
                </div>
            </div>

            {policy && policy !== "allowed" ? (
                <div className={`rounded-lg border px-3 py-2 text-xs ${policy === "confirm" ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300" : "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"}`}>
                    <div className="font-semibold">{t(`tasks.policy.${policy}`)}</div>
                    {reason ? <div className="mt-1">{reasonText(reason)}</div> : null}
                    {policy === "confirm" ? <div className="mt-1">{t("tasks.redLine")}</div> : null}
                </div>
            ) : null}

            <dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-1.5 text-xs">
                {rows.map(([label, value]) => (
                    <div key={label} className="contents">
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="break-all font-mono text-foreground">{value}</dd>
                    </div>
                ))}
            </dl>

            {task.error?.message ? (
                <div>
                    <div className="text-xs text-muted-foreground">{t("tasks.detail.errorMessage")}</div>
                    <div className="mt-1 whitespace-pre-wrap rounded-lg border border-border px-3 py-2 text-xs text-foreground">{task.error.message}</div>
                </div>
            ) : null}

            <div>
                <div className="text-xs text-muted-foreground">{t("tasks.detail.prompt")}</div>
                <div className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border px-3 py-2 text-xs text-foreground">{task.params.prompt || "—"}</div>
            </div>

            {task.resultAssetIds.length ? (
                <div>
                    <div className="text-xs text-muted-foreground">{t("tasks.detail.resultIds")}</div>
                    <div className="mt-1 break-all font-mono text-xs text-muted-foreground">{task.resultAssetIds.join(", ")}</div>
                </div>
            ) : null}
        </div>
    );
}
