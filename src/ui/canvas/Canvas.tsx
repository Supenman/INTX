import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
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
import { useAssetStore } from '@/app/stores/assetStore';
import { canRedo, canUndo, redo, undo, useHistoryStore } from '@/app/stores/historyStore';
import { persistProviders, useProviderStore } from '@/app/stores/providerStore';
import { hydrateAssetsFromProject } from '@/app/useCases/assetLibrary';
import { useRunGeneration } from '@/app/useCases/useRunGeneration';
import { CANCEL_MESSAGE } from '@/app/useCases/runGeneration';
import { usePersistence } from '@/app/useCases/usePersistence';
import { adapterFor } from '@/infra/provider';
import { resolveRuntime } from '@/infra/runtime';
import { exportProject, importProject, pickFile } from '@/app/useCases/projectPackage';
import { AssetLibrary } from '@/ui/library/AssetLibrary';
import { SettingsPanel } from '@/ui/settings/SettingsPanel';
import { CanvasNode, type CanvasNodeData } from './CanvasNode';

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
  const [toast, setToast] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);


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
  const providerCount = useProviderStore((s) => s.configs.length);
  const assetCount = useAssetStore((s) => Object.keys(s.assets).length);
  const undoDepth = useHistoryStore((s) => s.past.length);
  const redoDepth = useHistoryStore((s) => s.future.length);

  const persistence = usePersistence();
  const generate = useRunGeneration();
  // 传给节点的回调必须是稳定引用：它进了 memo 节点，一变整片重渲染
  const stableGenerate = useRef(generate);
  stableGenerate.current = generate;
  const onCancel = useCallback((nodeId: string) => {
    stableGenerate.current.cancel(nodeId);
  }, []);

  const showError = useCallback((message: string) => {
    setConnError(message);
    window.clearTimeout(errTimerRef.current);
    errTimerRef.current = window.setTimeout(() => setConnError(null), 5200);
  }, []);

  const onGenerate = useCallback(
    (nodeId: string) => {
      void stableGenerate.current(nodeId).then((r) => {
        // 取消是用户主动动作，不该弹一条红色错误
        if (!r.ok && r.message && r.message !== CANCEL_MESSAGE) showError(r.message);
      });
    },
    [showError],
  );

  /**
   * Ctrl/Cmd+Z 撤销、Ctrl/Cmd+Shift+Z 或 Ctrl+Y 重做。
   *
   * 输入框里要放行：用户在一个文本框里打字时按 Ctrl+Z，期望的是浏览器
   * 原生的"撤销这次输入"，不是把整个节点删掉。这个边界不处理会很难受。
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const target = e.target as HTMLElement | null;
      const inField =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable === true;
      if (inField) return;

      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 启动时把厂商配置与资产索引装起来
  useEffect(() => {
    void (async () => {
      const runtime = await resolveRuntime();
      useProviderStore.getState().setRuntime(runtime.providers, adapterFor);
      useProviderStore.getState().setConfigs(await runtime.providers.load());
      await hydrateAssetsFromProject(runtime);
    })();
  }, []);

  /**
   * 节点数组：完全受控。
   *
   * 踩坑记录（两轮）：
   * 1. 早期每次渲染都 map 出新 node 对象 → React Flow 认为节点被整体替换，
   *    测量结果与连线状态反复重置，端口点不动、拖不出连接线。
   * 2. 改用 useNodesState 后，节点只在「结构」变化时重建，
   *    结果节点参数与产物永远不刷新 —— 生成完成了，卡片上还是空的。
   *
   * 正解是两者都要：node 对象按 id 做记忆化（同一节点、同样的数据 → 同一个对象），
   * 图结构变化时增删，数据变化时只换那一个节点的引用。
   * React Flow 拿到的是稳定数组，只有真正变的节点会重渲染。
   */
  const nodeCache = useRef(new Map<string, Node>());
  const rfNodes = useMemo(() => {
    const cache = nodeCache.current;
    const alive = new Set<string>();
    const list: Node[] = [];

    for (const n of Object.values(nodesMap)) {
      alive.add(n.id);
      const data = { node: n, onGenerate, onCancel } satisfies CanvasNodeData;
      const prev = cache.get(n.id);
      if (
        prev &&
        prev.data.node === n &&
        prev.data.onGenerate === onGenerate &&
        prev.data.onCancel === onCancel
      ) {
        list.push(prev);
        continue;
      }
      const next: Node = {
        id: n.id,
        type: 'canvasNode',
        position: n.position,
        data,
        initialWidth: n.size.width,
        initialHeight: n.size.height,
      };
      cache.set(n.id, next);
      list.push(next);
    }
    for (const id of cache.keys()) if (!alive.has(id)) cache.delete(id);
    return list;
  }, [nodesMap, onGenerate, onCancel]);

  /**
   * 画布 → store。只关心位置变化，其余交还给 store 的幂等判断，
   * 避免每次拖拽都写一遍没变的东西。
   */
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    for (const c of changes) {
      if (c.type === 'position' && c.position) moveNode(c.id, c.position);
    }
  }, []);

  /**
   * 连线前的同步校验 —— 新架构的核心差异。
   * 旧代码要等到「生成阶段」才发现参数不对；这里在松手之前就判断。
   */
  const isValidConnection = useCallback(
    (
      c:
        | Connection
        | { source: string | null; target: string | null; sourceHandle?: string | null; targetHandle?: string | null },
    ) => {
      if (!c.source || !c.target || !c.sourceHandle || !c.targetHandle) return false;

      const { nodes, edges } = useGraphStore.getState();
      const sourceDef = getNodeDefinition(nodes[c.source]?.defKind ?? '');
      const targetDef = getNodeDefinition(nodes[c.target]?.defKind ?? '');
      if (!sourceDef || !targetDef) return false;

      const sourcePort: PortSpec | undefined = sourceDef.outputPorts.find((p) => p.id === c.sourceHandle);
      const targetPort: PortSpec | undefined = targetDef.inputPorts.find((p) => p.id === c.targetHandle);
      if (!sourcePort || !targetPort) return false;

      const sourceType: PortType = sourcePort.accepts.find((t) => t !== 'any') ?? 'any';

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
        if (draggingRef.current) {
          pendingIssueRef.current = issues.map((i) => i.message).join('；');
        }
        return false;
      }
      return true;
    },
    [],
  );

  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target || !c.sourceHandle || !c.targetHandle) return;
    const result = connectNodes({
      sourceNodeId: c.source,
      sourcePortId: c.sourceHandle,
      targetNodeId: c.target,
      targetPortId: c.targetHandle,
    });
    if (!result.ok) {
      setConnError(result.issues?.map((i) => i.message).join('；') ?? '连线被拒绝');
    }
  }, []);

  /**
   * 新节点从「当前视口左上角」开始排，不居中原点。
   *
   * 踩坑记录：以前用视口中心当原点，节点按网格往下排，
   * 第 3、4 个就掉到屏幕下面去了——用户以为没加上，其实是看不见。
   * 从左上角排，两列往下长，任何尺寸窗口都能看到前两个。
   */
  const spawnNode = useCallback(
    (defKind: string) => {
      const origin = screenToFlowPosition({ x: 300, y: 110 });
      addNode({ defKind, position: origin });
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
        <div className="brand">
          INTX
          <button className="icon-btn" title="厂商设置" onClick={() => setSettingsOpen(true)}>
            ⚙
          </button>
        </div>

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

        <AssetLibrary />

        <h3>项目</h3>
        <div className="node-picker">
          <button onClick={() => void exportProject()}>导出 .intx</button>
          <button onClick={() => void importProject(pickFile, showError)}>导入 .intx</button>
          <button onClick={resetGraph} style={{ color: 'var(--danger)' }} title="可撤销；资产库不受影响">
            清空画布
          </button>
        </div>
      </aside>

      <div className="canvas-wrap">
        <div className="toolbar">
          <button
            className="chip chip-btn"
            onClick={undo}
            disabled={undoDepth === 0}
            title={canUndo() ? '撤销 (Ctrl+Z)' : '没有可撤销的操作'}
          >
            ↶ 撤销
          </button>
          <button
            className="chip chip-btn"
            onClick={redo}
            disabled={redoDepth === 0}
            title={canRedo() ? '重做 (Ctrl+Shift+Z)' : '没有可重做的操作'}
          >
            ↷ 重做
          </button>
          <span className="chip">
            节点 <b>{nodeCount}</b>
          </span>
          <span className="chip">
            连线 <b>{Object.keys(edgesMap).length}</b>
          </span>
          <span className="chip">
            资产 <b>{assetCount}</b>
          </span>
          <button className="chip chip-btn" onClick={() => setSettingsOpen(true)}>
            厂商 <b>{providerCount}</b>
          </button>
          <span className="chip" title={persistence.error ?? undefined}>
            {persistence.status === 'saved' && '已保存'}
            {persistence.status === 'saving' && '保存中…'}
            {persistence.status === 'loading' && '载入中…'}
            {persistence.status === 'idle' && '就绪'}
            {persistence.status === 'error' && <span style={{ color: 'var(--danger)' }}>保存失败</span>}
          </span>
          {persistence.interruptedTasks > 0 && (
            <span className="chip warn" title="上次退出时未完成的任务已收敛为「已取消」，可点生成重新跑">
              上次有 {persistence.interruptedTasks} 个任务未跑完
            </span>
          )}
          {persistence.integrityIssues.length > 0 && (
            <span className="chip warn" title={persistence.integrityIssues.map((i) => i.message).join('\n')}>
              存档告警 {persistence.integrityIssues.length}
            </span>
          )}
          {toast && <span className="chip accent">{toast}</span>}
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
            <span>「文字输入」的出口 → 「生成」的提示词入口</span>
            <span>再把「素材」连到「参考素材」—— 只能接图或视频</span>
            <span style={{ opacity: 0.7 }}>默认已配好本地演示厂商，点「生成」就能出图</span>
          </div>
        )}

        {connError && (
          <div className="conn-error" role="alert">
            <span>{connError}</span>
            <button onClick={() => setConnError(null)} aria-label="关闭">
              ×
            </button>
          </div>
        )}

        {settingsOpen && (
          <SettingsPanel
            onClose={() => setSettingsOpen(false)}
            onSaved={() => {
              void persistProviders();
              setToast('厂商配置已保存');
              window.setTimeout(() => setToast(null), 2200);
            }}
          />
        )}
      </div>
    </div>
  );
}
