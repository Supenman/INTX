import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, FileText, Image as ImageIcon, LocateFixed, Music2, Square, Video } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const KIND_ICON: Partial<Record<CanvasNodeData["type"], typeof ImageIcon>> = {
    [CanvasNodeType.Image]: ImageIcon,
    [CanvasNodeType.Video]: Video,
    [CanvasNodeType.Audio]: Music2,
    [CanvasNodeType.Text]: FileText,
};

function formatElapsed(ms: number) {
    const sec = Math.max(0, Math.floor(ms / 1000));
    if (sec < 60) return `${sec}s`;
    return `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, "0")}s`;
}

/**
 * 画布内活跃生成任务浮标：
 * 只在当前画布存在 `status === "loading"` 节点时出现，实时显示已耗时，
 * 展开后支持一键定位对应节点或直接停止生成任务。
 */
export function CanvasActiveTaskPill({
    nodes,
    topOffsetClass = "top-16",
    onFocusNode,
    onStopNode,
}: {
    nodes: readonly CanvasNodeData[];
    topOffsetClass?: string;
    onFocusNode: (nodeId: string) => void;
    onStopNode?: (nodeId: string) => void;
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [open, setOpen] = useState(false);
    const [now, setNow] = useState(() => Date.now());
    const startedAtRef = useRef<Map<string, number>>(new Map());
    const rootRef = useRef<HTMLDivElement>(null);

    const activeNodes = useMemo(
        () => nodes.filter((node) => node.metadata?.status === "loading"),
        [nodes],
    );

    useEffect(() => {
        const activeIds = new Set(activeNodes.map((n) => n.id));
        for (const id of startedAtRef.current.keys()) {
            if (!activeIds.has(id)) startedAtRef.current.delete(id);
        }
        const stamp = Date.now();
        for (const id of activeIds) {
            if (!startedAtRef.current.has(id)) startedAtRef.current.set(id, stamp);
        }
        if (!activeNodes.length) {
            setOpen(false);
            return;
        }
        setNow(Date.now());
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [activeNodes]);

    useEffect(() => {
        if (!open) return;
        const closeOutside = (event: PointerEvent) => {
            if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
        };
        const closeEsc = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpen(false);
        };
        document.addEventListener("pointerdown", closeOutside, true);
        window.addEventListener("keydown", closeEsc);
        return () => {
            document.removeEventListener("pointerdown", closeOutside, true);
            window.removeEventListener("keydown", closeEsc);
        };
    }, [open]);

    if (!activeNodes.length) return null;

    const earliest = Math.min(...activeNodes.map((n) => startedAtRef.current.get(n.id) ?? now));

    return (
        <div
            ref={rootRef}
            data-canvas-no-zoom
            className={`pointer-events-auto absolute right-4 z-[60] flex flex-col items-end gap-2 ${topOffsetClass}`}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
                className="flex h-9 items-center gap-2 rounded-full border px-3 text-xs font-medium shadow-md backdrop-blur transition hover:opacity-90"
                style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            >
                <span className="size-2 rounded-full bg-amber-500 motion-safe:animate-pulse" aria-hidden />
                <span className="tabular-nums">{t("canvas.node.generating")} · {activeNodes.length}</span>
                <span className="font-mono opacity-60 tabular-nums">{formatElapsed(now - earliest)}</span>
                <ChevronDown aria-hidden className={`size-3.5 opacity-60 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
            {open ? (
                <div
                    role="region"
                    aria-label={t("canvas.node.generating")}
                    className="thin-scrollbar max-h-64 w-80 overflow-y-auto rounded-2xl border p-1.5 shadow-xl backdrop-blur"
                    style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                >
                    {activeNodes.map((node) => {
                        const Icon = KIND_ICON[node.type] || FileText;
                        const modelShort = node.metadata?.model?.split("::").pop() || "";
                        const elapsed = formatElapsed(now - (startedAtRef.current.get(node.id) ?? now));
                        return (
                            <div
                                key={node.id}
                                className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-xs transition hover:bg-black/5 dark:hover:bg-white/10"
                                style={{ color: theme.node.text }}
                            >
                                <button
                                    type="button"
                                    onClick={() => { setOpen(false); onFocusNode(node.id); }}
                                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                >
                                    <Icon aria-hidden className="size-4 shrink-0 opacity-70" />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate font-medium">{node.title || t("canvas.node.untitled")}</span>
                                        <span className="flex items-center gap-1.5 truncate opacity-55">
                                            {modelShort ? <span className="truncate">{modelShort}</span> : null}
                                            <span className="shrink-0 font-mono tabular-nums">{elapsed}</span>
                                        </span>
                                    </span>
                                </button>
                                <button
                                    type="button"
                                    title={t("canvas.node.locate")}
                                    aria-label={t("canvas.node.locate")}
                                    onClick={() => { setOpen(false); onFocusNode(node.id); }}
                                    className="grid size-7 shrink-0 place-items-center rounded-lg opacity-70 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
                                >
                                    <LocateFixed className="size-3.5" />
                                </button>
                                {onStopNode ? (
                                    <button
                                        type="button"
                                        title={t("canvas.promptPanel.stopGeneration")}
                                        aria-label={t("canvas.promptPanel.stopGeneration")}
                                        onClick={() => onStopNode(node.id)}
                                        className="grid size-7 shrink-0 place-items-center rounded-lg text-destructive opacity-80 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
                                    >
                                        <Square className="size-3 fill-current" />
                                    </button>
                                ) : null}
                            </div>
                        );
                    })}
                </div>
            ) : null}
        </div>
    );
}
