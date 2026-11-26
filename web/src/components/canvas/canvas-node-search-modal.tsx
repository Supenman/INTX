import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { AudioLines, FileText, Group, Image as ImageIcon, Search, Video, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { restoreCanvasFocus } from "@/lib/canvas/canvas-node-focus";
import { isImeComposing } from "@/lib/keyboard-event";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const NODE_ICONS: Partial<Record<CanvasNodeData["type"], typeof ImageIcon>> = {
    [CanvasNodeType.Image]: ImageIcon,
    [CanvasNodeType.Video]: Video,
    [CanvasNodeType.Audio]: AudioLines,
    [CanvasNodeType.Text]: FileText,
    [CanvasNodeType.Group]: Group,
};

/** 画布内快速搜索：Ctrl/Cmd+F 或缩放栏搜索按钮打开，↑↓ 选择、Enter 居中定位。 */
export function CanvasNodeSearchModal({
    open,
    nodes,
    onSelectNode,
    onClose,
}: {
    open: boolean;
    nodes: CanvasNodeData[];
    onSelectNode: (nodeId: string) => void;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const reducedMotion = useReducedMotion();
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const [query, setQuery] = useState("");
    const [activeIndex, setActiveIndex] = useState(0);

    useEffect(() => {
        if (!open) {
            setQuery("");
            setActiveIndex(0);
            return;
        }
        // 等浮层挂载后再抢焦点，否则输入框还不存在。
        const frame = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
        return () => cancelAnimationFrame(frame);
    }, [open]);

    const matches = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) return nodes;
        return nodes.filter((node) => {
            const snippet = node.type === CanvasNodeType.Text ? node.metadata?.content : "";
            const haystack = [node.title, node.metadata?.prompt, snippet, node.type].filter(Boolean).join(" ").toLowerCase();
            return haystack.includes(needle);
        });
    }, [nodes, query]);

    // 结果变短时索引可能越界，统一夹紧后再用，避免渲染时读到 undefined。
    const safeIndex = matches.length ? Math.min(activeIndex, matches.length - 1) : 0;

    useEffect(() => {
        if (!open) return;
        listRef.current?.querySelector<HTMLElement>(`[data-search-index="${safeIndex}"]`)?.scrollIntoView({ block: "nearest" });
    }, [open, safeIndex]);

    if (!open) return null;

    const closeAndRestore = () => {
        onClose();
        requestAnimationFrame(restoreCanvasFocus);
    };
    const pick = (nodeId: string) => {
        onClose();
        onSelectNode(nodeId);
    };
    const onKeyDown = (event: ReactKeyboardEvent) => {
        if (isImeComposing(event)) return;
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            closeAndRestore();
        } else if (event.key === "ArrowDown" && matches.length) {
            event.preventDefault();
            setActiveIndex((i) => (i + 1) % matches.length);
        } else if (event.key === "ArrowUp" && matches.length) {
            event.preventDefault();
            setActiveIndex((i) => (i - 1 + matches.length) % matches.length);
        } else if (event.key === "Home" && matches.length) {
            event.preventDefault();
            setActiveIndex(0);
        } else if (event.key === "End" && matches.length) {
            event.preventDefault();
            setActiveIndex(matches.length - 1);
        } else if (event.key === "Enter" && matches[safeIndex]) {
            event.preventDefault();
            pick(matches[safeIndex].id);
        }
    };

    return (
        <div
            data-canvas-no-zoom
            className="pointer-events-none absolute inset-x-0 top-16 z-[95] flex justify-center px-4"
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <motion.div
                role="dialog"
                aria-label={t("canvas.sidePanel.searchNodes")}
                initial={reducedMotion ? false : { opacity: 0, y: -8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.14, ease: "easeOut" }}
                className="pointer-events-auto flex w-full max-w-md flex-col overflow-hidden rounded-2xl border shadow-2xl backdrop-blur"
                style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                onKeyDown={onKeyDown}
            >
                <div className="flex items-center gap-2 border-b px-3 py-2.5" style={{ borderColor: theme.toolbar.border }}>
                    <Search aria-hidden className="size-4 shrink-0 opacity-60" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(event) => {
                            setQuery(event.target.value);
                            setActiveIndex(0);
                        }}
                        placeholder={t("canvas.sidePanel.searchNodes")}
                        aria-label={t("canvas.sidePanel.searchNodes")}
                        className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                        style={{ color: theme.node.text }}
                    />
                    <span className="shrink-0 text-xs tabular-nums opacity-50">{matches.length}</span>
                    <button
                        type="button"
                        onClick={closeAndRestore}
                        aria-label={t("canvas.createMenu.close")}
                        className="grid size-7 shrink-0 place-items-center rounded-lg opacity-60 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
                    >
                        <X className="size-4" />
                    </button>
                </div>
                <div ref={listRef} role="listbox" aria-label={t("canvas.sidePanel.searchNodes")} className="thin-scrollbar max-h-72 overflow-y-auto p-1.5">
                    {matches.length ? (
                        matches.map((node, index) => {
                            const Icon = NODE_ICONS[node.type] || FileText;
                            const active = index === safeIndex;
                            const snippet = (node.metadata?.prompt || (node.type === CanvasNodeType.Text ? node.metadata?.content : "") || "").trim();
                            return (
                                <button
                                    key={node.id}
                                    type="button"
                                    role="option"
                                    aria-selected={active}
                                    data-search-index={index}
                                    onMouseEnter={() => setActiveIndex(index)}
                                    onClick={() => pick(node.id)}
                                    className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition"
                                    style={active ? { background: theme.toolbar.activeBg, color: theme.toolbar.activeText } : { color: theme.node.text }}
                                >
                                    <Icon aria-hidden className="size-4 shrink-0 opacity-70" />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate font-medium">{node.title || t("canvas.node.untitled")}</span>
                                        {snippet ? <span className="block truncate text-xs opacity-60">{snippet}</span> : null}
                                    </span>
                                    {node.metadata?.status === "loading" ? <span className="size-1.5 shrink-0 rounded-full bg-amber-500" /> : node.metadata?.status === "error" ? <span className="size-1.5 shrink-0 rounded-full bg-red-500" /> : null}
                                </button>
                            );
                        })
                    ) : (
                        <p className="px-3 py-6 text-center text-sm opacity-60">{t("canvas.createMenu.noResults")}</p>
                    )}
                </div>
            </motion.div>
        </div>
    );
}

/** 画布搜索的打开信号。缩放栏在别的子树里，用一条自定义事件解耦，免得把回调层层透传。 */
export const CANVAS_NODE_SEARCH_EVENT = "intx:canvas-search-nodes";

export function openCanvasNodeSearch() {
    window.dispatchEvent(new Event(CANVAS_NODE_SEARCH_EVENT));
}

/**
 * 画布搜索浮层的接线层：自己持有开关状态，并挂 Ctrl/Cmd+F。
 *
 * 拆出来是为了不让 project.tsx 再多一个 `useState` 加两条监听分支——
 * 那个文件已经贴着结构预算上限，而搜索的开关完全自洽。
 */
export function CanvasNodeSearchLayer({ nodes, onSelectNode }: { nodes: CanvasNodeData[]; onSelectNode: (nodeId: string) => void }) {
    const [open, setOpen] = useState(false);

    useEffect(() => {
        const handleOpen = () => setOpen(true);
        window.addEventListener(CANVAS_NODE_SEARCH_EVENT, handleOpen);
        return () => window.removeEventListener(CANVAS_NODE_SEARCH_EVENT, handleOpen);
    }, []);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
            if (event.key.toLowerCase() !== "f") return;
            const target = event.target instanceof Element ? event.target : null;
            // 焦点在输入框/可编辑区时，Ctrl+F 交给浏览器与编辑器自己处理。
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || target?.closest("[contenteditable='true']")) return;
            event.preventDefault();
            setOpen(true);
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, []);

    return <CanvasNodeSearchModal open={open} nodes={nodes} onSelectNode={onSelectNode} onClose={() => setOpen(false)} />;
}
