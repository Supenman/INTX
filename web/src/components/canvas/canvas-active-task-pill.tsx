import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, FileText, Image as ImageIcon, LocateFixed, Music2, Video } from "lucide-react";
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

/**
 * 画布内活跃生成任务浮标：
 * 只在当前画布存在 `status === "loading"` 节点时出现，方便平移到别处继续创作时
 * 随时查看哪些节点仍在生成并一键居中定位。
 */
export function CanvasActiveTaskPill({
    nodes,
    topOffsetClass = "top-16",
    onFocusNode,
}: {
    nodes: readonly CanvasNodeData[];
    topOffsetClass?: string;
    onFocusNode: (nodeId: string) => void;
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    const activeNodes = useMemo(
        () => nodes.filter((node) => node.metadata?.status === "loading"),
        [nodes],
    );

    useEffect(() => {
        if (!activeNodes.length) setOpen(false);
    }, [activeNodes.length]);

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
                <ChevronDown aria-hidden className={`size-3.5 opacity-60 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
            {open ? (
                <div
                    role="region"
                    aria-label={t("canvas.node.generating")}
                    className="thin-scrollbar max-h-64 w-72 overflow-y-auto rounded-2xl border p-1.5 shadow-xl backdrop-blur"
                    style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                >
                    {activeNodes.map((node) => {
                        const Icon = KIND_ICON[node.type] || FileText;
                        return (
                            <button
                                key={node.id}
                                type="button"
                                onClick={() => { setOpen(false); onFocusNode(node.id); }}
                                className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs transition hover:bg-black/5 dark:hover:bg-white/10"
                                style={{ color: theme.node.text }}
                            >
                                <Icon aria-hidden className="size-4 shrink-0 opacity-70" />
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate font-medium">{node.title || t("canvas.node.untitled")}</span>
                                    {node.metadata?.model ? <span className="block truncate opacity-55">{node.metadata.model}</span> : null}
                                </span>
                                <LocateFixed aria-hidden className="size-3.5 shrink-0 opacity-60" />
                            </button>
                        );
                    })}
                </div>
            ) : null}
        </div>
    );
}
