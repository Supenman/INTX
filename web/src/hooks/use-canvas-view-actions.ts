import { useCallback, useEffect } from "react";

import { autoArrangeCanvasNodes, CANVAS_AUTO_ARRANGE_EVENT } from "@/lib/canvas/canvas-auto-arrange";
import { nudgeSelectedNodes } from "@/lib/canvas/canvas-nudge";
import type { CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";

/**
 * 画布的「视图与整理」动作 + 快捷键。
 *
 * 快捷键：Ctrl/Cmd + = / + / - / 0 缩放与重置，Shift + 1 / 2 适配全部与聚焦选区，
 * 方向键微调选中节点（1px，Shift 16px）。
 *
 * 单独成 hook 而不是塞进 project.tsx：那个文件贴着结构预算上限，而这一组动作
 * 只依赖 viewport / 选区 / 节点三样东西，边界很清楚。
 */
export function useCanvasViewActions({
    enabled,
    viewportRef,
    selectedNodeIdsRef,
    nodesRef,
    connectionsRef,
    setNodes,
    setZoomScale,
    resetViewport,
    fitCanvasViewport,
    focusSelectedNode,
}: {
    enabled: boolean;
    viewportRef: { current: ViewportTransform };
    selectedNodeIdsRef: { current: ReadonlySet<string> };
    nodesRef: { current: CanvasNodeData[] };
    connectionsRef: { current: CanvasConnection[] };
    setNodes: (next: CanvasNodeData[]) => void;
    setZoomScale: (scale: number) => void;
    resetViewport: () => void;
    fitCanvasViewport: () => void;
    focusSelectedNode: () => void;
}) {
    // 选区 ≥ 2 个时只整理选区，否则整理全部；返回同一引用说明位置没变，不必入撤销栈。
    const autoArrange = useCallback(() => {
        const next = autoArrangeCanvasNodes(nodesRef.current, connectionsRef.current, selectedNodeIdsRef.current);
        if (next !== nodesRef.current) setNodes(next);
    }, [connectionsRef, nodesRef, selectedNodeIdsRef, setNodes]);

    // 浮栏与缩放栏通过事件请求整理，页面只挂这一次监听。
    useEffect(() => {
        window.addEventListener(CANVAS_AUTO_ARRANGE_EVENT, autoArrange);
        return () => window.removeEventListener(CANVAS_AUTO_ARRANGE_EVENT, autoArrange);
    }, [autoArrange]);

    useEffect(() => {
        if (!enabled) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            const modifier = event.metaKey || event.ctrlKey;
            const key = event.key.toLowerCase();
            if (event.altKey) return;

            // Ctrl/Cmd + = / + / - / 0
            if (modifier && (key === "=" || key === "+" || key === "-" || key === "0")) {
                event.preventDefault();
                if (key === "0") resetViewport();
                else setZoomScale(Math.min(5, Math.max(0.05, viewportRef.current.k * (key === "-" ? 1 / 1.15 : 1.15))));
                return;
            }

            // Shift + 1 适配全部、Shift + 2 聚焦选区
            if (!modifier && event.shiftKey && (event.code === "Digit1" || event.code === "Digit2")) {
                event.preventDefault();
                if (event.code === "Digit1") fitCanvasViewport();
                else focusSelectedNode();
                return;
            }

            // 方向键微调：锁定节点与未选中的组内子节点由纯函数跳过
            if (!modifier && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key) && selectedNodeIdsRef.current.size) {
                event.preventDefault();
                const step = event.shiftKey ? 16 : 1;
                const next = nudgeSelectedNodes(
                    nodesRef.current,
                    selectedNodeIdsRef.current,
                    event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0,
                    event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0,
                );
                if (next !== nodesRef.current) setNodes(next);
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [enabled, fitCanvasViewport, focusSelectedNode, nodesRef, resetViewport, selectedNodeIdsRef, setNodes, setZoomScale, viewportRef]);

    return { autoArrange };
}
