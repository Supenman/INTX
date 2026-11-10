import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { getNodeDefinition, listByCategory, validateConnection, type PortSpec, type PortType } from '@/domain';
import { addNode, connectNodes, moveNode, resetGraph, useGraphStore } from '@/app/stores/graphStore';
import { CanvasNode, type CanvasNodeData } from './CanvasNode';
import { useSimulatedGeneration } from '@/app/useCases/simulateGeneration';
import { usePersistence } from '@/app/useCases/usePersistence';

const nodeTypes: NodeTypes = { canvasNode: CanvasNode };

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}

function CanvasInner() {
  const { screenToFlowPosition } = useReactFlow();

  const [connError, setConnError] = useState<string | null>(null);
  const [rfNodes, setRfNodes, onNodesChangeInternal] = useNodesState<Node>([]);

  /**
   * 连线校验的提示时机。
   *
   * React Flow 在「拖拽中」和「空闲预检」两种场景都会调用 isValidConnection，
   * 只有前者该弹提示；空闲时弹会变成噪音。
   */
  const draggingRef = useRef(false);
  const pendingIssueRef = useRef<string | null>(null);
  const errTimerRef = useRef<number | undefined>(undefined);

  const nodesMap = useGraphStore((s) => s.nodes);
  const edgesMap = useGraphStore((s) => s.edges);

  const persistence = usePersistence();
  const generate = useSimulatedGeneration();
  const onGenerate = useCallback(
    (nodeId: string) => {
      void generate(nodeId);
    },
    [generate],
  );

  /**
   * 节点数组只在「图结构」变化时重建。
   *
   * 踩坑记录：如果每次渲染都 map 出新的 node 对象，
   * React Flow 会认为节点被整体替换，内部测量结果与连线状态被反复重置，
   * 表现就是节点停在 visibility:hidden、端口点不动、拖拽不出连接线。
   * 用 structuralKey 把重建锁定在真正的结构变化上。
   */
  const structuralKey = useMemo(
    () =>
      Object.keys(nodesMap)
        .map((id) => {
          const n = nodesMap[id]!;
          return `${id}:${n.defKind}:${n.size.width}x${n.size.height}`;
        })
        .join('|'),
    [nodesMap],
  );

  const rfNodesView: Node[] = useMemo(
    () =>
      Object.values(nodesMap).map((n) => ({
        id: n.id,
        type: 'canvasNode',
        position: n.position,
        data: { node: n, onGenerate } satisfies CanvasNodeData,
        initialWidth: n.size.width,
        initialHeight: n.size.height,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [structuralKey, onGenerate],
  );

  // 结构变化时同步到画布（保留已有节点实例，避免测量重置）
  useEffect(() => {
    setRfNodes((prev) => {
      const prevById = new Map(prev.map((p) => [p.id, p]));
      return rfNodesView.map((n) => prevById.get(n.id) ?? n);
    });
  }, [rfNodesView, setRfNodes]);

  /**
   * 画布 → store。
   *
   * useNodesState 返回的 updater 内部已经调用 applyNodeChanges，
   * 不要再自己套一层（会让 dimensions 变更被处理两遍）。
   * 位置变化单向回写 store，供保存与持久化使用。
   */
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChangeInternal(changes);
      for (const c of changes) {
        if (c.type === 'position' && c.position) {
          moveNode(c.id, c.position);
        }
      }
    },
    [onNodesChangeInternal],
  );

  /**
   * 连线前的同步校验 —— 新架构的核心差异。
   *
   * 旧代码要等到「生成阶段」才发现参数不对；这里在松手之前就判断：
   * 端口类型是否匹配、单路端口是否已被占用、是否自连。
   */
  const isValidConnection = useCallback(
    (c: Connection | { source: string | null; target: string | null; sourceHandle?: string | null; targetHandle?: string | null }) => {
      if (!c.source || !c.target || !c.sourceHandle || !c.targetHandle) return false;

      const { nodes, edges } = useGraphStore.getState();
      const sourceDef = getNodeDefinition(nodes[c.source]?.defKind ?? '');
      const targetDef = getNodeDefinition(nodes[c.target]?.defKind ?? '');
      if (!sourceDef || !targetDef) return false;

      const sourcePort: PortSpec | undefined = sourceDef.outputPorts.find((p) => p.id === c.sourceHandle);
      const targetPort: PortSpec | undefined = targetDef.inputPorts.find((p) => p.id === c.targetHandle);
      if (!sourcePort || !targetPort) return false;

      const sourceType: PortType = sourcePort.accepts.find((t) => t !== 'any') ?? 'any';

      // 排除与本次尝试完全相同的既有连线，避免把「重复连一次」误判为容量超限
      const existing = Object.values(edges)
        .filter(
          (e) =>
            !(
              e.source === c.source &&
              e.sourcePort === c.sourceHandle &&
              e.target === c.target &&
              e.targetPort === c.targetHandle
            ),
        )
        .map((e) => ({
          sourceNodeId: e.source,
          sourcePortId: e.sourcePort,
          targetNodeId: e.target,
          targetPortId: e.targetPort,
        }));

      const issues = validateConnection({
        intent: {
          sourceNodeId: c.source,
          sourcePortId: c.sourceHandle,
          targetNodeId: c.target,
          targetPortId: c.targetHandle,
        },
        sourcePort,
        targetPort,
        sourceType,
        existingEdges: existing,
      });

      if (issues.length > 0) {
        // 拖拽中只记录原因，等松手再展示——避免高频 setState 打断拖拽
        if (draggingRef.current) {
          pendingIssueRef.current = issues.map((i) => i.message).join('；');
        }
        return false;
      }
      return true;
    },
    [],
  );

  const showError = useCallback((message: string) => {
    setConnError(message);
    window.clearTimeout(errTimerRef.current);
    errTimerRef.current = window.setTimeout(() => setConnError(null), 3800);
  }, []);

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || !c.sourceHandle || !c.targetHandle) return;
      const result = connectNodes({
        sourceNodeId: c.source,
        sourcePortId: c.sourceHandle,
        targetNodeId: c.target,
        targetPortId: c.targetHandle,
      });
      if (!result.ok) {
        showError(result.issues?.map((i) => i.message).join('；') ?? '连线被拒绝');
      }
    },
    [showError],
  );

  const spawnNode = useCallback(
    (defKind: string) => {
      const center = screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
      addNode({ defKind, position: { x: center.x - 160, y: center.y - 140 } });
    },
    [screenToFlowPosition],
  );

  const edges: Edge[] = useMemo(
    () =>
      Object.values(edgesMap).map((e) => ({
        id: e.id,
        source: e.source,
        sourceHandle: e.sourcePort,
        target: e.target,
        targetHandle: e.targetPort,
      })),
    [edgesMap],
  );

  const nodeCount = Object.keys(nodesMap).length;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">INTX</div>

        <h3>素材</h3>
        <div className="node-picker">
          {listByCategory('source').map((d) => (
            <button key={d.kind} onClick={() => spawnNode(d.kind)}>
              {d.title}
            </button>
          ))}
        </div>

        <h3>生成</h3>
        <div className="node-picker">
          {listByCategory('generate').map((d) => (
            <button key={d.kind} onClick={() => spawnNode(d.kind)}>
              {d.title}
            </button>
          ))}
        </div>

        <h3>工具</h3>
        <div className="node-picker">
          {listByCategory('utility').map((d) => (
            <button key={d.kind} onClick={() => spawnNode(d.kind)}>
              {d.title}
            </button>
          ))}
          <button onClick={resetGraph} style={{ color: 'var(--danger)', marginTop: 8 }}>
            清空画布
          </button>
        </div>
      </aside>

      <div className="canvas-wrap">
        <div className="toolbar">
          <span className="chip">
            节点 <b>{nodeCount}</b>
          </span>
          <span className="chip">
            连线 <b>{Object.keys(edgesMap).length}</b>
          </span>
          <span className="chip accent">端口校验已启用</span>
          <span className="chip" title={persistence.error ?? undefined}>
            {persistence.status === 'saved' && '已保存'}
            {persistence.status === 'saving' && '保存中…'}
            {persistence.status === 'loading' && '载入中…'}
            {persistence.status === 'idle' && '就绪'}
            {persistence.status === 'error' && (
              <span style={{ color: 'var(--danger)' }}>保存失败</span>
            )}
          </span>
        </div>

        <ReactFlow
          nodes={rfNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          onConnectStart={() => {
            draggingRef.current = true;
          }}
          onConnectEnd={() => {
            draggingRef.current = false;
            if (pendingIssueRef.current) {
              showError(pendingIssueRef.current);
              pendingIssueRef.current = null;
            }
          }}
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          proOptions={{ hideAttribution: true }}
          minZoom={0.2}
          maxZoom={2}
          deleteKeyCode={null}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#262624" />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable nodeColor="#3d3d3a" maskColor="rgba(10,10,9,0.8)" />
        </ReactFlow>

        {nodeCount === 0 && (
          <div className="empty-hint">
            <strong>从左栏添加节点开始</strong>
            <span>试试把一个「文字输入」的出口连到「生成」的提示词入口</span>
            <span>再把一个「素材」的出口连到「参考素材」——只能接图或视频</span>
          </div>
        )}

        {connError && (
          <div className="conn-error" role="alert">
            <span>连线被拒绝：{connError}</span>
            <button onClick={() => setConnError(null)} aria-label="关闭">
              ×
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
