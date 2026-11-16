import { useCallback, useEffect, useMemo, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import i18n from "@/i18n";
import { useAgentStore } from "@/stores/use-agent-store";
import { applyCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { confirmedOps, executableOps, planAgentOps, type AgentPermissionMode, type AgentPlanVerdict } from "@/lib/canvas/agent-permissions";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import type { CanvasConnection, CanvasNodeData, ContextMenuState, ViewportTransform } from "@/types/canvas";

type GenerateNodeRef = MutableRefObject<((nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => Promise<void>) | null>;

type AgentBridgeParams = {
    projectId: string;
    title: string | undefined;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    selectedNodeIds: Set<string>;
    viewport: ViewportTransform;
    nodesRef: MutableRefObject<CanvasNodeData[]>;
    connectionsRef: MutableRefObject<CanvasConnection[]>;
    selectedNodeIdsRef: MutableRefObject<Set<string>>;
    viewportRef: MutableRefObject<ViewportTransform>;
    generateNodeRef: GenerateNodeRef;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    setViewport: Dispatch<SetStateAction<ViewportTransform>>;
    setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
    /** 三档权限：request 每步问、automatic 只问花钱和删除、full 全自动。 */
    agentPermission: AgentPermissionMode;
    /** 有需要用户点头的 op 时回调，由上层弹确认卡。 */
    onAgentPlanPending: (plan: AgentPlanVerdict, proceed: () => void) => void;
};

/**
 * Bridge between the canvas and local Agent: publish the current snapshot and apply/undo capabilities
 * to the Agent store for the local Agent panel. All members except applyAgentOps are internal.
 */
export function useAgentBridge(params: AgentBridgeParams) {
    const {
        projectId,
        title,
        nodes,
        connections,
        selectedNodeIds,
        viewport,
        nodesRef,
        connectionsRef,
        selectedNodeIdsRef,
        viewportRef,
        generateNodeRef,
        setNodes,
        setConnections,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setViewport,
        setContextMenu,
        agentPermission,
        onAgentPlanPending,
    } = params;
    const setAgentCanvasContext = useAgentStore((state) => state.setCanvasContext);
    const [agentUndoSnapshot, setAgentUndoSnapshot] = useState<CanvasAgentSnapshot | null>(null);
    const projectTitle = title || i18n.t("canvas.project.untitled");

    const agentSnapshot = useMemo<CanvasAgentSnapshot>(() => ({ projectId, title: projectTitle, nodes, connections, selectedNodeIds: Array.from(selectedNodeIds), viewport }), [connections, projectTitle, nodes, projectId, selectedNodeIds, viewport]);

    const currentSnapshot = useCallback(
        (): CanvasAgentSnapshot => ({ projectId, title: projectTitle, nodes: nodesRef.current, connections: connectionsRef.current, selectedNodeIds: Array.from(selectedNodeIdsRef.current), viewport: viewportRef.current }),
        [projectId, projectTitle],
    );

    /**
     * 真正把 op 落到画布上。权限已经在 applyAgentOps 里筛过，这里只管执行。
     *
     * `origin` 是撤销快照。一批 op 可能分两次进来（先跑能跑的，确认后再跑剩下的），
     * 两次都得记同一份「批次开始前」的快照，否则撤销只能收回后半截。
     */
    const commitAgentOps = useCallback(
        (safeOps: CanvasAgentOp[], origin?: CanvasAgentSnapshot) => {
            const before = origin ?? currentSnapshot();
            const generationOps = safeOps.filter((op): op is Extract<CanvasAgentOp, { type: "run_generation" }> => op.type === "run_generation" && Boolean(op.nodeId));
            const next = applyCanvasAgentOps(
                before,
                safeOps.filter((op) => op.type !== "run_generation"),
            );
            nodesRef.current = next.nodes;
            connectionsRef.current = next.connections;
            selectedNodeIdsRef.current = new Set(next.selectedNodeIds);
            viewportRef.current = next.viewport;
            setAgentUndoSnapshot(before);
            setNodes(next.nodes);
            setConnections(next.connections);
            setSelectedNodeIds(new Set(next.selectedNodeIds));
            setSelectedConnectionId(null);
            setViewport(next.viewport);
            setContextMenu(null);
            if (generationOps.length) {
                queueMicrotask(() =>
                    generationOps.forEach((op) => {
                        const target = nodesRef.current.find((node) => node.id === op.nodeId);
                        const prompt = op.prompt?.trim() ? op.prompt : (target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "");
                        void generateNodeRef.current?.(op.nodeId, op.mode || target?.metadata?.generationMode || "image", prompt);
                    }),
                );
            }
            return { ...next, projectId, title: projectTitle };
        },
        [currentSnapshot, projectTitle, projectId],
    );

    /**
     * Agent 操作入口。**任何 op 都要先过权限表**：花钱和删除不点确认就不执行。
     * 待确认的部分交给上层弹卡，用户点「确认」后只重放**那一部分**。
     */
    const applyAgentOps = useCallback(
        (ops?: CanvasAgentOp[]) => {
            const safeOps = Array.isArray(ops) ? ops.filter((op) => op?.type) : [];
            const plan = planAgentOps(safeOps, agentPermission);
            const runnable = executableOps(plan);
            // 批次开始前的画面，两次提交共用，撤销时能一次收回整批。
            const origin = currentSnapshot();
            // 先把可直接跑的做掉：用户已经等着了，不该因为另一条要确认就全部卡住。
            const result = runnable.length ? commitAgentOps(runnable, origin) : null;
            if (plan.pending.length) {
                // 只重放待确认的那几条。回放全量会让已执行的 op 再跑一遍（节点重复、重复下单）。
                onAgentPlanPending(plan, () => void commitAgentOps(confirmedOps(plan), origin));
            }
            // 没有任何可执行内容时也要回传当前快照，否则上层拿不到 projectId。
            return result ?? { projectId, title: projectTitle, nodes: nodesRef.current, connections: connectionsRef.current, selectedNodeIds: Array.from(selectedNodeIdsRef.current), viewport: viewportRef.current };
        },
        [agentPermission, commitAgentOps, currentSnapshot, onAgentPlanPending],
    );
    const undoAgentOps = useCallback(() => {
        if (!agentUndoSnapshot) return null;
        nodesRef.current = agentUndoSnapshot.nodes;
        connectionsRef.current = agentUndoSnapshot.connections;
        selectedNodeIdsRef.current = new Set(agentUndoSnapshot.selectedNodeIds);
        viewportRef.current = agentUndoSnapshot.viewport;
        setNodes(agentUndoSnapshot.nodes);
        setConnections(agentUndoSnapshot.connections);
        setSelectedNodeIds(new Set(agentUndoSnapshot.selectedNodeIds));
        setSelectedConnectionId(null);
        setViewport(agentUndoSnapshot.viewport);
        setContextMenu(null);
        setAgentUndoSnapshot(null);
        return { ...agentUndoSnapshot, projectId, title: projectTitle };
    }, [agentUndoSnapshot, projectTitle, projectId]);

    useEffect(() => {
        setAgentCanvasContext({ snapshot: agentSnapshot, applyOps: applyAgentOps, undoOps: undoAgentOps, canUndo: Boolean(agentUndoSnapshot) });
        return () => setAgentCanvasContext(null);
    }, [agentSnapshot, applyAgentOps, agentUndoSnapshot, setAgentCanvasContext, undoAgentOps]);

    return { applyAgentOps };
}
