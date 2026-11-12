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
import { normalizeProviders, persistProviders, useProviderStore } from '@/app/stores/providerStore';
import { useToolbarPrefs } from '@/app/toolPrefs';
import { hydrateAssetsFromProject } from '@/app/useCases/assetLibrary';
import { useRunGeneration } from '@/app/useCases/useRunGeneration';
import { CANCEL_MESSAGE, upstreamTextFor, type RunGenerationOptions } from '@/app/useCases/runGeneration';
import { usePersistence } from '@/app/useCases/usePersistence';
import { adapterFor } from '@/infra/provider';
import { resolveRuntime } from '@/infra/runtime';
import { exportProject, importProject, pickFile } from '@/app/useCases/projectPackage';
import { placeAssetAt } from '@/ui/common/placeOnCanvas';
import { AlertBanner } from '@/ui/common/Feedback';
import { SettingsPanel } from '@/ui/settings/SettingsPanel';
import { AuditPanel } from '@/ui/audit/AuditPanel';
import { LegacyImportDialog } from '@/ui/common/LegacyImportDialog';
import { CanvasNode, type CanvasNodeData } from './CanvasNode';
import { CanvasSidebar } from './CanvasSidebar';
import { CanvasToolbar } from './CanvasToolbar';
import { AddMenu, CanvasStarter, ModeSwitch, SelectionToolbar, type ToolDispatch } from './CanvasTools';
import { NodeContextMenu } from './NodeContextMenu';
import { ShortcutsPanel } from './ShortcutsPanel';
import { storyboardRunConfirm } from './storyboardConfirm';
import { useBatchRename } from './useBatchRename';
import { useCanvasShortcuts } from './useCanvasShortcuts';
import { useChainSelection } from './useChainSelection';

const nodeTypes: NodeTypes = { canvasNode: CanvasNode };

interface MenuState {
  x: number;
  y: number;
  /** 点击处在 flow 坐标系里的位置，新节点落在这里 */
  fx: number;
  fy: number;
  /** 节点右键时命中的节点 id；空白处为 null（渲染添加菜单）。 */
  nodeId: string | null;
  /** 右键瞬间生效的选区（setState 是异步的，菜单分流不能等下一帧）。 */
  selection: string[];
}

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}

function CanvasInner() {
  const { screenToFlowPosition, fitView, zoomTo } = useReactFlow();

  const [connError, setConnError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [legacyOpen, setLegacyOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

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

  // 选区必须跟着图走：节点被删 / 清空 / 撤销后，残留 id 会让框选把
  // 「已不存在的节点」也算进多选（右键菜单数量、批量动作都会错）。
  useEffect(() => {
    setSelectedIds((prev) => {
      const next = prev.filter((id) => nodesMap[id]);
      return next.length === prev.length ? prev : next;
    });
    setSelectedEdgeIds((prev) => {
      const next = prev.filter((id) => edgesMap[id]);
      return next.length === prev.length ? prev : next;
    });
  }, [nodesMap, edgesMap]);

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
    (nodeId: string, options?: RunGenerationOptions) => {
      // 分镜「拆分」前的知情确认：已有产物再花钱、行数≠格数会循环/丢弃。
      // 这是所有生成入口的唯一漏斗（拆分按钮/悬浮栏/右键都走这里）。
      const node = useGraphStore.getState().nodes[nodeId];
      if (node?.defKind === 'storyboard') {
        const confirmText = storyboardRunConfirm({
          derivedCount: node.derivedAssetIds?.length ?? 0,
          grid: String(node.params.grid ?? '2x2'),
          script: upstreamTextFor(nodeId),
          resume: options?.resume === true,
          cellIndex: options?.cellIndex,
        });
        if (confirmText && !window.confirm(confirmText)) return;
      }
      void stableGenerate.current(nodeId, options).then((r) => {
        // 取消是用户主动动作，不该弹一条红色错误
        if (!r.ok && r.message && r.message !== CANCEL_MESSAGE) showError(r.message);
        // 成功且带消息（如缩格截断提示）：短暂确认，不占错误条
        if (r.ok && r.message) flash(r.message);
      });
    },
    [showError, flash],
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

  /** Ctrl/Cmd+Z / D / C / V / 1 / 2 / 3，? 快捷键面板，Escape 关菜单。输入框里放行原生。 */
  useCanvasShortcuts({
    selectedIds,
    onEscape: () => setMenu(null),
    onToggleShortcuts: () => setShortcutsOpen((v) => !v),
    onDuplicate: duplicateSelection,
    onCopy: copySelection,
    onPaste: pasteClipboard,
    zoomTo,
    fitView,
  });

  // 启动时把厂商配置与资产索引装起来
  useEffect(() => {
    void (async () => {
      const runtime = await resolveRuntime();
      useProviderStore.getState().setRuntime(runtime.providers, adapterFor);
      useProviderStore.getState().setConfigs(normalizeProviders(await runtime.providers.load()));
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
        nodeId: null,
        selection: [],
      });
    },
    [screenToFlowPosition],
  );

  const openNodeMenu = useCallback(
    (clientX: number, clientY: number, nodeId: string, selection: string[]) => {
      setMenu({
        x: Math.max(8, Math.min(clientX, window.innerWidth - 250)),
        y: Math.max(8, Math.min(clientY, window.innerHeight - 360)),
        fx: 0,
        fy: 0,
        nodeId,
        selection,
      });
    },
    [],
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

  /** 节点右键菜单的上下文：用右键瞬间的选区快照，单/多选由 selectedCount 分流。 */
  const contextMenuCtx: ToolContext = useMemo(() => {
    const hit = menu?.nodeId ? nodesMap[menu.nodeId] : null;
    const def = hit ? getNodeDefinition(hit.defKind) : null;
    return {
      ...toolCtx,
      selectedCount: menu?.selection.length ?? toolCtx.selectedCount,
      contextNodeId: menu?.nodeId ?? null,
      node: hit && def
        ? { kind: hit.defKind, category: def.category, hasAsset: Boolean(hit.assetId), busy: false }
        : null,
    };
  }, [toolCtx, menu, nodesMap]);

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
      <CanvasSidebar
        onSpawn={(kind) => spawnNode(kind)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenAudit={() => setAuditOpen(true)}
        onOpenLegacy={() => setLegacyOpen(true)}
        onExport={() => void exportProject()}
        onImport={() => void importProject(pickFile, showError)}
        onClear={() => onAction('clear')}
      />

      <div className="canvas-wrap">
        <CanvasToolbar
          tools={mainToolButtons}
          onAction={onAction}
          providerCount={providerCount}
          nodeCount={nodeCount}
          edgeCount={Object.keys(edgesMap).length}
          assetCount={assetCount}
          demoMode={demoMode}
          persistence={persistence}
          toast={toast}
        />

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
            // 右键未选中的节点：先选中它再开菜单；已在多选里则保留多选。
            // 菜单的单/多选分流必须用「此刻生效的选区」，不能等 setState 后的下一帧。
            const effective = selectedIds.includes(node.id) ? selectedIds : [node.id];
            if (!selectedIds.includes(node.id)) setSelectedIds([node.id]);
            openNodeMenu(e.clientX, e.clientY, node.id, effective);
          }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('application/x-intx-asset') || e.dataTransfer.types.includes('application/x-intx-node')) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
            }
          }}
          onDrop={(e) => {
            const assetId = e.dataTransfer.getData('application/x-intx-asset');
            const nodeKind = e.dataTransfer.getData('application/x-intx-node');
            if (!assetId && !nodeKind) return;
            e.preventDefault();
            const at = screenToFlowPosition({ x: e.clientX, y: e.clientY });
            if (assetId) {
              const entry = useAssetStore.getState().assets[assetId];
              if (entry) placeAssetAt(entry, at);
            } else if (nodeKind) {
              spawnNode(nodeKind, at);
            }
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

        {menu && menu.nodeId === null && (
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

        {menu && menu.nodeId !== null && (
          <NodeContextMenu
            x={menu.x}
            y={menu.y}
            ctx={contextMenuCtx}
            onAction={onAction}
            onClose={() => setMenu(null)}
          />
        )}

        <AlertBanner message={connError} onClose={() => setConnError(null)} />

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

        {shortcutsOpen && <ShortcutsPanel onClose={() => setShortcutsOpen(false)} />}
      </div>
    </div>
  );
}
