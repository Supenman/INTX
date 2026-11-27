import { LocateFixed, Minus, Plus, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

/**
 * 画布专注模式顶部浮条：
 * 隐藏顶栏、底部工具坞与缩放栏后，仅保留退出、缩放步进与适配全部内容，
 * 适合大画布审片与演示。
 */
export function CanvasFocusModeBar({
    scale,
    onZoomIn,
    onZoomOut,
    onFitAll,
    onExit,
}: {
    scale: number;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onFitAll: () => void;
    onExit: () => void;
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const reducedMotion = useReducedMotion();

    return (
        <motion.div
            data-canvas-no-zoom
            role="toolbar"
            aria-label={t("canvas.toolbar.focusMode")}
            initial={reducedMotion ? false : { opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="pointer-events-auto absolute left-1/2 top-3 z-[75] flex -translate-x-1/2 items-center gap-0.5 rounded-full border p-1 shadow-xl backdrop-blur"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <Tooltip title={`${t("canvas.toolbar.exitFocusMode")} (Esc)`}>
                <button
                    type="button"
                    onClick={onExit}
                    aria-label={t("canvas.toolbar.exitFocusMode")}
                    className="grid size-8 place-items-center rounded-full transition hover:bg-black/5 dark:hover:bg-white/10"
                    style={{ color: theme.node.text }}
                >
                    <X className="size-4" />
                </button>
            </Tooltip>
            <span className="mx-0.5 h-4 w-px" style={{ background: theme.toolbar.border }} />
            <Tooltip title={t("canvas.editors.zoomOut")}>
                <button type="button" onClick={onZoomOut} aria-label={t("canvas.editors.zoomOut")} className="grid size-8 place-items-center rounded-full transition hover:bg-black/5 dark:hover:bg-white/10" style={{ color: theme.node.text }}>
                    <Minus className="size-3.5" />
                </button>
            </Tooltip>
            <Tooltip title={t("canvas.toolbar.fitAll")}>
                <button type="button" onClick={onFitAll} className="flex h-8 min-w-14 items-center justify-center gap-1 rounded-full px-2 text-xs font-medium tabular-nums transition hover:bg-black/5 dark:hover:bg-white/10" style={{ color: theme.node.text }}>
                    <LocateFixed aria-hidden className="size-3.5 opacity-60" />
                    <span>{Math.round(scale * 100)}%</span>
                </button>
            </Tooltip>
            <Tooltip title={t("canvas.editors.zoomIn")}>
                <button type="button" onClick={onZoomIn} aria-label={t("canvas.editors.zoomIn")} className="grid size-8 place-items-center rounded-full transition hover:bg-black/5 dark:hover:bg-white/10" style={{ color: theme.node.text }}>
                    <Plus className="size-3.5" />
                </button>
            </Tooltip>
        </motion.div>
    );
}
