import { lazy, Suspense } from "react";
import { Spin } from "antd";
import { motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";

const OpencodeAgentPanel = lazy(() => import("./opencode-agent-panel").then((mod) => ({ default: mod.OpencodeAgentPanel })));
import { usePanelResize } from "@/hooks/use-panel-resize";
import { canvasThemes } from "@/lib/canvas-theme";
import { CANVAS_AGENT_PANEL_MOTION_MS, useAgentStore } from "@/stores/use-agent-store";
import { useThemeStore } from "@/stores/use-theme-store";

const PANEL_MOTION_SECONDS = CANVAS_AGENT_PANEL_MOTION_MS / 1000;

export function AgentPanel() {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const width = useAgentStore((state) => state.width);
    const panelMounted = useAgentStore((state) => state.panelMounted);
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const panelClosing = useAgentStore((state) => state.panelClosing);
    const setAgentState = useAgentStore((state) => state.setAgentState);
    const { resizing, resizeHandle } = usePanelResize(width, 360, 760, -1, (nextWidth) => setAgentState({ width: nextWidth }), "canvas-agent-panel-width");
    const reducedMotion = useReducedMotion();

    if (!panelMounted) return null;

    return (
        <motion.div
            className="relative z-[70] flex h-full shrink-0"
            inert={!panelOpen}
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: panelOpen ? width + 1 : 0, opacity: panelOpen ? 1 : 0 }}
            transition={{ duration: resizing || reducedMotion ? 0 : PANEL_MOTION_SECONDS, ease: [0.16, 1, 0.3, 1] }}
            style={{ overflow: "clip", pointerEvents: panelOpen && !panelClosing ? undefined : "none" }}
        >
            <motion.aside
                className="relative flex h-full shrink-0 flex-col border-l"
                data-canvas-shortcuts-ignore
                initial={{ x: 48 }}
                animate={{ x: panelClosing ? 28 : 0 }}
                transition={{ duration: resizing || reducedMotion ? 0 : PANEL_MOTION_SECONDS, ease: [0.22, 1, 0.36, 1] }}
                style={{ width, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            >
                <button type="button" className="absolute inset-y-0 left-0 z-40 w-4 -translate-x-1/2 touch-none cursor-col-resize" {...resizeHandle} tabIndex={-1} aria-label={t("agent.panel.resize")} />
                <Suspense fallback={<div className="flex h-full items-center justify-center"><Spin size="small" /></div>}><OpencodeAgentPanel /></Suspense>
            </motion.aside>
        </motion.div>
    );
}
