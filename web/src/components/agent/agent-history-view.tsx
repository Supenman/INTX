import { useMemo, useState } from "react";
import { Button, Checkbox, Input, Tooltip } from "antd";
import { FolderOpen, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import type { AgentThreadSummary } from "@/stores/use-agent-store";

export function AgentHistoryView({
    theme,
    threads,
    activeThreadId,
    workspacePath,
    loading,
    busy,
    connected,
    onRefresh,
    onNewThread,
    onResumeThread,
    onDeleteThreads,
    onRenameThread,
}: {
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    threads: AgentThreadSummary[];
    activeThreadId: string;
    workspacePath: string;
    loading: boolean;
    busy: boolean;
    connected: boolean;
    onRefresh: () => void;
    onNewThread: () => void;
    onResumeThread: (threadId: string) => void;
    onDeleteThreads: (threadIds: string[]) => void;
    onRenameThread: (threadId: string, title: string) => void;
}) {
    const { i18n, t } = useTranslation();
    const [selectedIds, setSelectedIds] = useState(() => new Set<string>());
    const [keyword, setKeyword] = useState("");
    const [editingId, setEditingId] = useState("");
    const [editingTitle, setEditingTitle] = useState("");
    const matches = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        if (!query) return threads;
        return threads.filter((thread) => `${thread.name || ""}\n${thread.preview || ""}`.toLowerCase().includes(query));
    }, [keyword, threads]);
    const selectedThreads = threads.filter((thread) => selectedIds.has(thread.id));
    const allSelected = Boolean(threads.length) && selectedThreads.length === threads.length;
    const canResume = connected && !loading && !busy;
    const toggleThread = (threadId: string) => {
        setSelectedIds((current) => {
            const next = new Set(current);
            next.has(threadId) ? next.delete(threadId) : next.add(threadId);
            return next;
        });
    };
    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
            <div className="space-y-3">
                <div className="flex min-w-0 items-center gap-2 text-xs" style={{ color: theme.node.muted }}>
                    <FolderOpen className="size-3.5 shrink-0" />
                    <span className="shrink-0">{t("agent.history.workspace")}</span>
                    <span className="min-w-0 truncate" title={workspacePath}>
                        {workspacePath || t("agent.history.defaultWorkspace")}
                    </span>
                </div>
                <Input
                    allowClear
                    size="small"
                    value={keyword}
                    placeholder={t("agent.history.searchPlaceholder")}
                    aria-label={t("agent.history.searchPlaceholder")}
                    onChange={(event) => setKeyword(event.target.value)}
                    onKeyDown={(event) => event.stopPropagation()}
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm" style={{ color: theme.node.muted }}>
                        {matches.length ? <Checkbox checked={allSelected} indeterminate={Boolean(selectedThreads.length) && !allSelected} disabled={loading || busy} onChange={() => setSelectedIds(allSelected ? new Set() : new Set(matches.map((thread) => thread.id)))} /> : null}
                        <span>{selectedThreads.length ? t("agent.history.selected", { count: selectedThreads.length }) : matches.length ? t("agent.history.count", { count: matches.length }) : connected ? keyword.trim() ? t("agent.history.noMatch") : t("agent.history.empty") : t("agent.status.disconnected")}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        {selectedThreads.length ? (
                            <Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />} disabled={loading || busy} onClick={() => onDeleteThreads(selectedThreads.map((thread) => thread.id))}>
                                {t("agent.history.deleteCount", { count: selectedThreads.length })}
                            </Button>
                        ) : null}
                        <Button size="small" icon={<RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />} disabled={!connected || loading} onClick={onRefresh}>
                            {t("agent.history.refresh")}
                        </Button>
                        <Button size="small" type="primary" icon={<Plus className="size-3.5" />} disabled={!connected || loading || busy} onClick={onNewThread}>
                            {t("agent.history.newThread")}
                        </Button>
                    </div>
                </div>
                <div className="space-y-2">
                    {matches.map((thread) => {
                        const active = thread.id === activeThreadId;
                        const editing = editingId === thread.id;
                        return (
                            <div
                                key={thread.id}
                                role="button"
                                tabIndex={canResume ? 0 : -1}
                                aria-disabled={!canResume}
                                className={`${canResume ? "cursor-pointer hover:bg-black/5 dark:hover:bg-white/10" : "cursor-default opacity-60"} rounded-lg border px-2.5 py-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/20`}
                                style={{ borderColor: active ? theme.node.text : theme.node.stroke, background: "transparent", color: theme.node.text }}
                                onClick={() => {
                                    if (canResume && !editing) onResumeThread(thread.id);
                                }}
                                onKeyDown={(event) => {
                                    if (editing || !canResume || (event.key !== "Enter" && event.key !== " ")) return;
                                    event.preventDefault();
                                    onResumeThread(thread.id);
                                }}
                            >
                                <div className="flex items-center gap-2">
                                    <Checkbox
                                        checked={selectedIds.has(thread.id)}
                                        disabled={loading || busy}
                                        aria-label={t("agent.history.selectThread", { name: thread.name || thread.preview || t("agent.history.untitled") })}
                                        onClick={(event) => event.stopPropagation()}
                                        onKeyDown={(event) => event.stopPropagation()}
                                        onChange={() => toggleThread(thread.id)}
                                    />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex min-w-0 items-center gap-1.5">
                                            {active ? (
                                                <span className="shrink-0 typ-label font-medium" style={{ color: theme.node.text }}>
                                                    {t("agent.history.current")}
                                                </span>
                                            ) : null}
                                            {editing ? (
                                                <Input
                                                    size="small"
                                                    autoFocus
                                                    value={editingTitle}
                                                    onClick={(event) => event.stopPropagation()}
                                                    onKeyDown={(event) => {
                                                        event.stopPropagation();
                                                        if (event.key === "Enter") {
                                                            if (editingTitle.trim()) onRenameThread(thread.id, editingTitle.trim());
                                                            setEditingId("");
                                                        }
                                                        if (event.key === "Escape") setEditingId("");
                                                    }}
                                                    onChange={(event) => setEditingTitle(event.target.value)}
                                                />
                                            ) : (
                                                <>
                                                    <div className="truncate text-sm font-medium leading-5">{thread.name || thread.preview || t("agent.history.untitled")}</div>
                                                    <Tooltip title={t("agent.history.rename")} placement="bottom">
                                                        <button
                                                            type="button"
                                                            aria-label={t("agent.history.rename")}
                                                            disabled={loading || busy}
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                setEditingId(thread.id);
                                                                setEditingTitle(thread.name || thread.preview || "");
                                                            }}
                                                            style={{ color: theme.node.muted, opacity: loading || busy ? 0.4 : 0.8 }}
                                                            className="shrink-0 rounded p-0.5 transition hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/30"
                                                        >
                                                            <Pencil className="size-3" />
                                                        </button>
                                                    </Tooltip>
                                                </>
                                            )}
                                        </div>
                                        <div className="truncate typ-label leading-4 opacity-65">{thread.preview || thread.id}</div>
                                    </div>
                                    <span className="shrink-0 typ-label opacity-55">{formatThreadTime(thread.updatedAt || thread.createdAt, i18n.language)}</span>
                                </div>
                            </div>
                        );
                    })}
                    {!matches.length ? (
                        <div className="px-3 py-8 text-center text-sm" style={{ color: theme.node.muted }}>
                            {keyword.trim() ? t("agent.history.noMatch") : t(connected ? "agent.history.noWorkspaceThreads" : "agent.history.connectHint")}
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

function formatThreadTime(value: number | undefined, locale: string) {
    if (!value) return "";
    // opencode 的会话时间戳已是毫秒，直接传给 Date。
    return new Date(value).toLocaleString(locale);
}
