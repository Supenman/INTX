/**
 * React Flow 画布试点（手感对比用，不接入生产业务）。
 *
 * 数据来源：public/pilot-data/project.json —— 从用户真实导出的「无限画布 1.zip」
 * 抽出的 5 个节点（2 图片 / 2 视频 / 1 音频）与 2 条连线，尺寸与相对位置保持原样。
 *
 * 目的：用真实素材回答「换成 React Flow 后画布是否更顺手」。
 * 不做：分组、撤销、持久化、时间线、AI 请求、节点编辑面板。
 *
 * 若结论为「明显更好」，再把这些能力逐项接回 pages/canvas/project.tsx。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
    Background,
    BackgroundVariant,
    Controls,
    Handle,
    MiniMap,
    Position as FlowPosition,
    ReactFlow,
    ReactFlowProvider,
    useNodesState,
    type Edge,
    type Node,
    type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

type ShotData = {
    title: string;
    kind: "image" | "video" | "audio";
    file: string;
    width: number;
    height: number;
};

type ShotNode = Node<ShotData>;

type PilotProject = {
    title: string;
    nodes: { id: string; type: string; title: string; position: { x: number; y: number }; width: number; height: number; file: string }[];
    connections: { id: string; fromNodeId: string; toNodeId: string }[];
};

function Media({ data }: { data: ShotData }) {
    if (data.kind === "image") return <img src={data.file} alt="" draggable={false} className="h-full w-full object-cover" />;
    if (data.kind === "video") return <video src={data.file} muted loop playsInline preload="metadata" className="h-full w-full object-cover" />;
    return (
        <div className="flex h-full w-full items-center justify-center gap-2 text-xs opacity-70">
            <span className="text-lg">🎵</span>
            <audio src={data.file} controls className="nodrag w-full max-w-[220px]" />
        </div>
    );
}

function ShotCard({ data, selected }: NodeProps<ShotNode>) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const isAudio = data.kind === "audio";

    return (
        <div
            className="overflow-hidden rounded-xl border shadow-sm"
            style={{
                width: data.width,
                background: theme.node.panel,
                borderColor: selected ? theme.canvas.selectionStroke : theme.node.stroke,
                boxShadow: selected ? `0 0 0 3px ${theme.canvas.selectionFill}` : undefined,
            }}
        >
            <Handle type="target" position={FlowPosition.Left} className="!size-2.5 !border-2" style={{ background: theme.node.label, borderColor: theme.node.panel }} />
            <div style={{ height: data.height, background: theme.node.fill }}>
                <Media data={data} />
            </div>
            <div className="flex items-center gap-1.5 px-2 py-1.5">
                <span className="min-w-0 flex-1 truncate text-xs" style={{ color: theme.node.text }}>{data.title}</span>
            </div>
            <Handle type="source" position={FlowPosition.Right} className="!size-2.5 !border-2" style={{ background: theme.node.label, borderColor: theme.node.panel }} />
            {isAudio ? null : null}
        </div>
    );
}

function toFlow(project: PilotProject): { nodes: ShotNode[]; edges: Edge[] } {
    const nodes: ShotNode[] = project.nodes.map((node) => ({
        id: node.id,
        type: "shot",
        position: node.position,
        data: {
            title: node.title,
            kind: node.type === "video" ? "video" : node.type === "audio" ? "audio" : "image",
            file: node.file,
            width: node.width,
            height: node.height,
        },
    }));
    const edges: Edge[] = project.connections.map((connection) => ({
        id: connection.id,
        source: connection.fromNodeId,
        target: connection.toNodeId,
    }));
    return { nodes, edges };
}

function FlowCanvas({ project }: { project: PilotProject }) {
    const initial = useMemo(() => toFlow(project), [project]);
    const [nodes, , onNodesChange] = useNodesState<ShotNode>(initial.nodes);
    const [edges, setEdges] = useState<Edge[]>(initial.edges);
    const nodeTypes = useMemo(() => ({ shot: ShotCard }), []);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    const onConnect = useCallback((params: { source: string | null; target: string | null; sourceHandle?: string | null; targetHandle?: string | null }) => {
        if (!params.source || !params.target) return;
        setEdges((previous) => [...previous, { id: `e-${params.source}-${params.target}-${previous.length}`, source: params.source!, target: params.target! }]);
    }, []);

    return (
        <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            selectionOnDrag
            panOnDrag={[1, 2]}
            multiSelectionKeyCode="Shift"
            deleteKeyCode={["Backspace", "Delete"]}
            minZoom={0.1}
            maxZoom={2.5}
            style={{ background: theme.canvas.background }}
        >
            <Background variant={BackgroundVariant.Lines} gap={24} size={1} color={theme.canvas.line} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeStrokeWidth={2} />
        </ReactFlow>
    );
}

export default function CanvasFlowPilotPage() {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [project, setProject] = useState<PilotProject | null>(null);
    const [error, setError] = useState("");

    useEffect(() => {
        fetch("/pilot-data/project.json")
            .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
            .then(setProject)
            .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "加载失败"));
    }, []);

    return (
        <ReactFlowProvider>
            <div className="flex h-[calc(100vh-64px)] flex-col">
                <div
                    className="flex shrink-0 flex-wrap items-center gap-3 border-b px-4 py-2 text-xs"
                    style={{ borderColor: theme.node.stroke, background: theme.node.fill, color: theme.node.label }}
                >
                    <span className="font-medium" style={{ color: theme.node.text }}>React Flow 试点 · 真实项目</span>
                    <span>{project ? `${project.title} · ${project.nodes.length} 节点 / ${project.connections.length} 连线` : error || "加载中…"}</span>
                    <span className="opacity-70">滚轮缩放 · 拖空白框选 · 中键/右键平移 · Shift 加选</span>
                </div>
                <div className="min-h-0 flex-1">
                    {project ? <FlowCanvas project={project} /> : (
                        <div className="grid h-full place-items-center text-sm" style={{ color: theme.node.label }}>{error || "加载中…"}</div>
                    )}
                </div>
            </div>
        </ReactFlowProvider>
    );
}
