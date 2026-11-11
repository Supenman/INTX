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
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import {
  describePortIssues,
  effectiveExistingEdges,
  getNodeDefinition,
  listByCategory,
  resolveCanvasEmptyState,
  resolveToolbarTools,
  validateConnection,
  type AlignMode,
  type DistributeAxis,
  type PortSpec,
  type PortType,
  type ToolContext,
  type ToolMode,
} from '@/domain';
import {
  addNode,
  alignSelected,
  autoArrange,
  connectNodes,
  distributeSelected,
  duplicateNodes,
  moveNode,
  pasteNodes,
  removeEdge,
  removeNodes,
  resetGraph,
  useGraphStore,
  type ClipboardSnapshot,
} from '@/app/stores/graphStore';
import { useAssetStore } from '@/app/stores/assetStore';
import { redo, undo, useHistoryStore } from '@/app/stores/historyStore';
import { persistProviders, useProviderStore } from '@/app/stores/providerStore';
import { useToolbarPrefs } from '@/app/toolPrefs';
import { hydrateAssetsFromProject } from '@/app/useCases/assetLibrary';
import { useRunGeneration } from '@/app/useCases/useRunGeneration';
import { CANCEL_MESSAGE } from '@/app/useCases/runGeneration';
import { usePersistence } from '@/app/useCases/usePersistence';
import { adapterFor } from '@/infra/provider';
import { resolveRuntime } from '@/infra/runtime';
import { exportProject, importProject, pickFile } from '@/app/useCases/projectPackage';
import { AssetLibrary } from '@/ui/library/AssetLibrary';
import { SettingsPanel } from '@/ui/settings/SettingsPanel';
import { AuditPanel } from '@/ui/audit/AuditPanel';
import { LegacyImportDialog } from '@/ui/common/LegacyImportDialog';
import { CanvasNode, type CanvasNodeData } from './CanvasNode';
import { AddMenu, CanvasStarter, ModeSwitch, SelectionToolbar, type ToolDispatch } from './CanvasTools';
import { useBatchRename } from './useBatchRename';
import { useChainSelection } from './useChainSelection';

const nodeTypes: NodeTypes = { canvasNode: CanvasNode };

interface MenuState {
  x: number;
  y: number;
  /** 点击处在 flow 坐标系里的位置，新节点落在这里 */
  fx: number;
  fy: number;
}

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
  const [legacyOpen, setLegacyOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);

  // 画布基本功的状态：工具模式、选区、右键菜单、内部剪贴板
  const [toolMode, setToolMode] = useState<ToolMode>('select');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const clipboardRef = useRef<ClipboardSnapshot | null>(null);
  const [clipboardCount, setClipboardCount] = useState(0);

  // 工具栏偏好必须在挂载后读：注册表由 main.tsx 同步安装，
  // 模块顶层执行时它还是空的，那时算不出有意义的默认顺序。
  const prefs = useToolbarPrefs((s) => s.prefs);
  const hydratePrefs = useToolbarPrefs((s) => s.hydrate);
  const setToolHidden = useToolbarPrefs((s) => s.setHidden);
  useEffect(() => hydratePrefs(), [hydratePrefs]);

  /**
   * 连线校验的提示时机。
   *
   * React Flow 在「拖拽中」和「空闲预检」两种场景都会调用 isValidConnection，
   * 只有前者该弹提示；空闲时弹会变成噪音。
   */
  const draggingRef = useRef(false);
  const pendingIssueRef = useRef<string | null>(null);
  const errTimerRef = useRef<number | undefined>(undefined);
  const toastTimerRef = useRef<number | undefined>(undefined);

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

  const flash = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2400);
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

  // ── 画布动作 ──────────────────────────────────────────────

  const duplicateSelection = useCallback(() => {
    if (selectedIds.length === 0) return;
    const created = duplicateNodes(selectedIds);
    setSelectedIds(created);
    flash(`已复制 ${created.length} 个节点`);
  }, [selectedIds, flash]);

  const copySelection = useCallback(() => {
    if (selectedIds.length === 0) return;
    const { nodes, edges } = useGraphStore.getState();
    const picked = selectedIds.map((id) => nodes[id]).filter((n): n is NonNullable<typeof n> => Boolean(n));
    if (picked.length === 0) return;
    const ids = new Set(picked.map((n) => n.id));
    clipboardRef.current = {
      nodes: picked.map((n) => JSON.parse(JSON.stringify(n)) as typeof n),
      edges: Object.values(edges)
        .filter((e) => ids.has(e.source) && ids.has(e.target))
        .map((e) => ({ ...e })),
    };
    setClipboardCount(picked.length);
    flash(`已复制 ${picked.length} 个节点到剪贴板`);
  }, [selectedIds, flash]);

  const pasteClipboard = useCallback(() => {
    const clip = clipboardRef.current;
    if (!clip || clip.nodes.length === 0) return;
    const created = pasteNodes(clip);
    setSelectedIds(created);
    flash(`已粘贴 ${created.length} 个节点`);
  }, [flash]);

  const deleteSelection = useCallback(() => {
    if (selectedIds.length === 0 && selectedEdgeIds.length === 0) return;
    if (selectedIds.length > 0) removeNodes(selectedIds);
    for (const id of selectedEdgeIds) removeEdge(id);
    setSelectedIds([]);
    setSelectedEdgeIds([]);
  }, [selectedIds, selectedEdgeIds]);

  /** 批量改名。状态和浮层都在 hook 里，Canvas 只留一个入口和一个挂载点。 */
  const batchRename = useBatchRename(selectedIds, flash);

  /** 按从左到右的顺序，把相邻节点用它们第一个可用端口连起来。 */
  const chainSelection = useChainSelection(selectedIds, flash);

  const arrange = useCallback(
    (scopeOnly: boolean) => {
      autoArrange(scopeOnly && selectedIds.length >= 2 ? selectedIds : undefined);
      flash(scopeOnly ? '已整理选区' : '已自动整理画布');
    },
    [selectedIds, flash],
  );

  /** Ctrl/Cmd+Z / D / C / V，Escape 关菜单。输入框里放行原生撤销。 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenu(null);
        return;
      }
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
      } else if (key === 'd') {
        e.preventDefault();
        duplicateSelection();
      } else if (key === 'c') {
        e.preventDefault();
        copySelection();
      } else if (key === 'v') {
        e.preventDefault();
        pasteClipboard();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [duplicateSelection, copySelection, pasteClipboard]);

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
   */
  const nodeCache = useRef(new Map<string, Node>());
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const rfNodes = useMemo(() => {
    const cache = nodeCache.current;
    const alive = new Set<string>();
    const list: Node[] = [];

    for (const n of Object.values(nodesMap)) {
      alive.add(n.id);
      const data = { node: n, onGenerate, onCancel } satisfies CanvasNodeData;
      const isSelected = selectedSet.has(n.id);
      const prev = cache.get(n.id);
      if (
        prev &&
        prev.data.node === n &&
        prev.data.onGenerate === onGenerate &&
        prev.data.onCancel === onCancel &&
        prev.selected === isSelected
      ) {
        list.push(prev);
        continue;
      }
      const next: Node = {
        id: n.id,
        type: 'canvasNode',
        position: n.position,
        data,
        selected: isSelected,
        initialWidth: n.size.width,
        initialHeight: n.size.height,
      };
      cache.set(n.id, next);
      list.push(next);
    }
    for (const id of cache.keys()) if (!alive.has(id)) cache.delete(id);
    return list;
  }, [nodesMap, onGenerate, onCancel, selectedSet]);

  /**
   * 画布 → store。受控模式下选中态必须由我们写回 nodes，
   * 所以 select / remove 两类变更都要处理，只处理 position 会让节点永远选不中。
   */
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const removed: string[] = [];
    let selectionChanged = false;
    for (const c of changes) {
      if (c.type === 'position' && c.position) moveNode(c.id, c.position);
      else if (c.type === 'remove') removed.push(c.id);
      else if (c.type === 'select') selectionChanged = true;
    }
    if (selectionChanged) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const c of changes) {
          if (c.type !== 'select') continue;
          if (c.selected) next.add(c.id);
          else next.delete(c.id);
        }
        return [...next];
      });
    }
    if (removed.length > 0) {
      removeNodes(removed);
      setSelectedIds((prev) => prev.filter((id) => !removed.includes(id)));
    }
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const removed: string[] = [];
    let selectionChanged = false;
    for (const c of changes) {
      if (c.type === 'remove') removed.push(c.id);
      else if (c.type === 'select') selectionChanged = true;
    }
    if (selectionChanged) {
      setSelectedEdgeIds((prev) => {
        const next = new Set(prev);
        for (const c of changes) {
          if (c.type !== 'select') continue;
          if (c.selected) next.add(c.id);
          else next.delete(c.id);
        }
        return [...next];
      });
    }
    for (const id of removed) removeEdge(id);
    if (removed.length > 0) {
      setSelectedEdgeIds((prev) => prev.filter((id) => !removed.includes(id)));
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

      const intent = {
        sourceNodeId: c.source,
        sourcePortId: c.sourceHandle,
        targetNodeId: c.target,
        targetPortId: c.targetHandle,
      };
      const issues = validateConnection({
        intent,
        sourcePort,
        targetPort,
        sourceType,
        // 与 graphStore.connectNodes 用同一个函数：单路输入口上的旧边
        // 会被换源替换，不能在这里把用户拖过来的线挡掉。
        existingEdges: effectiveExistingEdges(existing, intent, targetPort),
      });

      if (issues.length > 0) {
        if (draggingRef.current) {
          pendingIssueRef.current = describePortIssues(issues);
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
      setConnError(describePortIssues(result.issues ?? []) || '连线被拒绝');
    }
  }, []);

  /**
   * 新节点从「当前视口左上角」开始排，不居中原点。
   * 从右键菜单 / 起始框添加时，改成落在点击处。
   */
  const spawnNode = useCallback(
    (defKind: string, at?: { x: number; y: number }) => {
      const origin = at ?? screenToFlowPosition({ x: 300, y: 110 });
      addNode({ defKind, position: origin });
    },
    [screenToFlowPosition],
  );

  const openAddMenu = useCallback(
    (clientX: number, clientY: number) => {
      const flow = screenToFlowPosition({ x: clientX, y: clientY });
      setMenu({
        x: Math.max(8, Math.min(clientX, window.innerWidth - 250)),
        y: Math.max(8, Math.min(clientY, window.innerHeight - 360)),
        fx: flow.x,
        fy: flow.y,
      });
    },
    [screenToFlowPosition],
  );

  const selectedEdgeSet = useMemo(() => new Set(selectedEdgeIds), [selectedEdgeIds]);
  const edges: Edge[] = useMemo(
    () =>
      Object.values(edgesMap).map((e) => ({
        id: e.id,
        source: e.source,
        sourceHandle: e.sourcePort,
        target: e.target,
        targetHandle: e.targetPort,
        selected: selectedEdgeSet.has(e.id),
      })),
    [edgesMap, selectedEdgeSet],
  );

  const nodeCount = Object.keys(nodesMap).length;
  const demoMode = useProviderStore((s) => s.configs.length === 0 || s.configs.every((c) => c.adapter === 'mock'));

  /** 一次解析的上下文。所有字段都来自 store 快照，解析函数因此是纯的。 */
  const toolCtx: ToolContext = useMemo(
    () => ({
      toolMode,
      selectedCount: selectedIds.length,
      nodeCount,
      clipboardCount,
      canUndo: undoDepth > 0,
      canRedo: redoDepth > 0,
      demoMode,
      node: null,
    }),
    [toolMode, selectedIds.length, nodeCount, clipboardCount, undoDepth, redoDepth, demoMode],
  );

  const mainToolButtons = useMemo(
    () =>
      resolveToolbarTools('main', toolCtx, prefs?.main ?? null)
        // 抓手 / 区域选择是同一个 switch，由 ModeSwitch 单独渲染。
        .filter((tool) => tool.id !== 'tool-canvas-mode')
        .map((tool) => ({ tool, disabled: Boolean(tool.disabled?.(toolCtx)) })),
    [toolCtx, prefs],
  );

  /** 注册表只产出 action 字符串，真正做什么集中在这里，不在组件里各写一份。 */
  const onAction: ToolDispatch = useCallback(
    (action, payload) => {
      switch (action) {
        case 'set-tool-mode':
          if (payload?.mode === 'hand' || payload?.mode === 'select') setToolMode(payload.mode);
          break;
        case 'undo':
          undo();
          break;
        case 'redo':
          redo();
          break;
        case 'arrange':
          arrange(payload?.scope === 'selection');
          break;
        case 'open-settings':
          setSettingsOpen(true);
          break;
        case 'clear':
          resetGraph();
          break;
        case 'align':
          if (payload?.mode) alignSelected(selectedIds, payload.mode as AlignMode);
          break;
        case 'distribute':
          if (payload?.axis) distributeSelected(selectedIds, payload.axis as DistributeAxis);
          break;
        case 'chain':
          chainSelection();
          break;
        case 'rename':
          batchRename.open();
          break;
        case 'duplicate':
          duplicateSelection();
          break;
        case 'delete':
          deleteSelection();
          break;
        case 'add-node':
          if (payload?.kind) spawnNode(payload.kind, menu ? { x: menu.fx, y: menu.fy } : undefined);
          setMenu(null);
          break;
        case 'paste':
          pasteClipboard();
          setMenu(null);
          break;
        default:
          break;
      }
    },
    [
      arrange,
      selectedIds,
      chainSelection,
      batchRename,
      duplicateSelection,
      deleteSelection,
      spawnNode,
      menu,
      pasteClipboard,
    ],
  );

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
          <button onClick={() => setAuditOpen(true)} title="查看生成审计台账：厂商、出处、成本、复现">
            审计台账
          </button>
          <button onClick={() => void exportProject()}>导出 .intx</button>
          <button onClick={() => void importProject(pickFile, showError)}>导入 .intx</button>
          <button onClick={() => setLegacyOpen(true)} title="从旧版 BeastTV / INTX 的 localStorage 或 JSON 文件迁移">
            导入旧版数据
          </button>
          <button onClick={() => onAction('clear')} style={{ color: 'var(--danger)' }} title="可撤销；资产库不受影响">
            清空画布
          </button>
        </div>
      </aside>

      <div className="canvas-wrap">
        <div className="toolbar">
          {mainToolButtons.map(({ tool, disabled }) => (
            <button
              key={tool.id}
              className="chip chip-btn"
              data-tool-id={tool.id}
              onClick={() => onAction(tool.action, tool.payload)}
              disabled={disabled}
              title={
                disabled && (tool.id === 'undo' || tool.id === 'redo')
                  ? `没有可${tool.id === 'undo' ? '撤销' : '重做'}的操作`
                  : tool.hint
              }
            >
              {tool.label}
              {tool.id === 'open-settings' && <b>{providerCount}</b>}
            </button>
          ))}
          <span className="chip">
            节点 <b>{nodeCount}</b>
          </span>
          <span className="chip">
            连线 <b>{Object.keys(edgesMap).length}</b>
          </span>
          <span className="chip">
            资产 <b>{assetCount}</b>
          </span>
          {demoMode && (
            <span className="chip warn" title="当前只配置了本地演示厂商，生成的是占位图，不是真实作品">
              演示模式 · 不出真图
            </span>
          )}
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

        <ModeSwitch ctx={toolCtx} prefs={prefs} onAction={onAction} />

        <SelectionToolbar ctx={toolCtx} prefs={prefs} onAction={onAction} />
        {batchRename.node}

        <ReactFlow
          nodes={rfNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
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
          onPaneClick={() => setMenu(null)}
          onPaneContextMenu={(e) => {
            e.preventDefault();
            openAddMenu(e.clientX, e.clientY);
          }}
          onNodeContextMenu={(e, node) => {
            e.preventDefault();
            if (!selectedIds.includes(node.id)) setSelectedIds([node.id]);
            openAddMenu(e.clientX, e.clientY);
          }}
          selectionOnDrag={toolMode === 'select'}
          panOnDrag={toolMode === 'hand' ? true : [1]}
          panActivationKeyCode="Space"
          selectionKeyCode="Shift"
          deleteKeyCode={['Delete', 'Backspace']}
          zoomOnDoubleClick={false}
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          proOptions={{ hideAttribution: true }}
          minZoom={0.2}
          maxZoom={2}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#262624" />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable nodeColor="#3d3d3a" maskColor="rgba(10,10,9,0.8)" />
        </ReactFlow>

        {nodeCount === 0 && (
          <div className="empty-hint">
            <CanvasStarter
              kind={resolveCanvasEmptyState({ nodeCount, demoMode })}
              onOpen={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openAddMenu(e.clientX, e.clientY);
              }}
            />
          </div>
        )}

        {menu && (
          <AddMenu
            x={menu.x}
            y={menu.y}
            ctx={toolCtx}
            prefs={prefs}
            onAction={onAction}
            onToggleTool={setToolHidden}
            onClose={() => setMenu(null)}
          />
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
              flash('厂商配置已保存');
            }}
          />
        )}

        {auditOpen && (
          <AuditPanel onClose={() => setAuditOpen(false)} onError={showError} onFlash={flash} />
        )}

        {legacyOpen && (
          <LegacyImportDialog
            onClose={() => setLegacyOpen(false)}
            onImported={(msg) => flash(msg)}
          />
        )}
      </div>
    </div>
  );
}
