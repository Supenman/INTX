import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  ReactFlow,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  Controls,
  MiniMap,
  MarkerType,
  SelectionMode,
  ReactFlowProvider,
  useStoreApi,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import ImageNode from './components/ImageNode';
import TextNode from './components/TextNode';
import VideoNode from './components/VideoNode';
import SourceTextNode from './components/SourceTextNode';
import SourceImageNode from './components/SourceImageNode';
import SourceVideoNode from './components/SourceVideoNode';
import SourceAudioNode from './components/SourceAudioNode';
import SourceMarkdownNode from './components/SourceMarkdownNode';
import GridBackground from './components/GridBackground';
import Sidebar from './components/Sidebar';
import NodeTypeMenu from './components/NodeTypeMenu';
import NodeContextMenu from './components/NodeContextMenu';
import OutputHistoryPanel from './components/OutputHistoryPanel';
import SettingsPanel from './components/SettingsPanel';
import AlignmentGuides from './components/AlignmentGuides';
import { ConnectionContext } from './ConnectionContext';
import { ThemeProvider, useTheme } from './ThemeContext';
import { loadCanvasState, saveCanvasState, clearCanvasState, createDebouncedSave } from './utils/canvasStorage';
import { listProjects, createProject, loadProject, saveProject, deleteProject as deleteProjectFromStorage, renameProject as renameProjectInStorage, setCurrentProjectId as setCurrentProjectStorage, getCurrentProjectId, migrateFromOldStorage } from './utils/projectStorage';
import ProjectSelector from './components/ProjectSelector';
import { NODE_TYPE_REGISTRY } from './domain/nodeTypes';
import { ActiveNodeContext } from './ActiveNodeContext';
import { createTask, getTaskStatus } from './services/apiClient';
import { findProviderForModel } from './utils/modelUtils';
import { getNodeSize } from './utils/nodeSize';
import { computeAlignmentSnap } from './utils/alignmentSnap';
import { compressImage } from './utils/compressImage';

const initialNodes = [];
const initialEdges = [];

function getInitialState() {
  try {
    const saved = loadCanvasState();
    if (saved && Array.isArray(saved.nodes) && saved.nodes.length > 0) {
      // Migrate old media type nodes to source-image
      const migratedNodes = saved.nodes.map(n =>
        n.type === 'media' ? { ...n, type: 'source-image' } : n
      );
      return {
        nodes: migratedNodes,
        edges: saved.edges || [],
        counter: saved.nodeIdCounter || 1,
      };
    }
  } catch (e) {
    /* fall through */
  }
  return { nodes: initialNodes, edges: initialEdges, counter: 1 };
}

function getEdgeColor(sourceType, isDark) {
  switch (sourceType) {
    case 'image': return isDark ? 'rgba(94, 234, 212, 0.70)' : 'rgba(15, 159, 143, 0.70)';
    case 'text': return isDark ? 'rgba(247, 215, 116, 0.70)' : 'rgba(167, 101, 0, 0.70)';
    case 'video': return isDark ? 'rgba(192, 132, 252, 0.70)' : 'rgba(124, 58, 237, 0.70)';
    case 'source-text':
    case 'source-markdown': return isDark ? 'rgba(251, 191, 36, 0.70)' : 'rgba(217, 119, 6, 0.70)';
    case 'source-audio': return isDark ? 'rgba(244, 114, 182, 0.70)' : 'rgba(219, 39, 119, 0.70)';
    default: return isDark ? 'rgba(94, 234, 212, 0.70)' : 'rgba(15, 159, 143, 0.70)';
  }
}

function AppContent() {
  const reactFlowWrapper = useRef(null);
  const mediaFileInputRef = useRef(null);
  const pendingMediaNodeIdRef = useRef(null);
  const initialState = useMemo(() => getInitialState(), []);
  const snapThreshold = 12;
  const [guideLines, setGuideLines] = useState([]);
  const [selectedNodeCount, setSelectedNodeCount] = useState(0);
  const draggingNodeRef = useRef(null);
  const [nodes, setNodes] = useState(initialState.nodes);
  const [edges, setEdges] = useState(initialState.edges);
  const [reactFlowInstance, setReactFlowInstance] = useState(null);
  const storeApi = useStoreApi();

  const onEdgesChange = useCallback((changes) => {
    setEdges((eds) => applyEdgeChanges(changes, eds));
  }, []);

  const onNodesChange = useCallback((changes) => {
    // Intercept drag position changes to apply alignment snap
    // before positions reach React Flow's store. Single-node drags snap
    // the node directly; multi-node drags snap the selection bounding box
    // and apply the same delta to all dragged nodes.
    setNodes((nds) => {
      const dragPosChanges = changes.filter(
        (c) => c.type === 'position' && c.dragging && c.position !== undefined
      );

      if (dragPosChanges.length === 0) {
        setGuideLines([]);
        return applyNodeChanges(changes, nds);
      }

      // --- Single-node drag: direct snap ---
      if (dragPosChanges.length === 1) {
        const dc = dragPosChanges[0];
        if (!dc.position) {
          return applyNodeChanges(changes, nds);
        }
        const dragNode = nds.find((n) => n.id === dc.id);
        if (!dragNode) {
          return applyNodeChanges(changes, nds);
        }

        const otherNodes = nds
          .filter((n) => n.id !== dc.id)
          .map((n) => ({
            id: n.id,
            position: { x: n.position.x, y: n.position.y },
            width: n.measured?.width ?? n.width ?? 200,
            height: n.measured?.height ?? n.height ?? 200,
          }));

        const result = computeAlignmentSnap(
          {
            id: dc.id,
            position: { x: dc.position.x, y: dc.position.y },
            width: dragNode.measured?.width ?? dragNode.width ?? 200,
            height: dragNode.measured?.height ?? dragNode.height ?? 200,
          },
          otherNodes,
          snapThreshold
        );

        setGuideLines(result.guides);

        if (result.snappedPosition) {
          return applyNodeChanges(
            changes.map((c) =>
              c === dc ? { ...c, position: result.snappedPosition } : c
            ),
            nds
          );
        }

        return applyNodeChanges(changes, nds);
      }

      // --- Multi-node drag: snap the selection bounding box ---
      const draggedIds = new Set(dragPosChanges.map((c) => c.id));

      // Compute bounding box from all dragged nodes' current positions
      let boxMinX = Infinity;
      let boxMinY = Infinity;
      let boxMaxX = -Infinity;
      let boxMaxY = -Infinity;

      for (const dc of dragPosChanges) {
        if (!dc.position) continue;
        const n = nds.find((nd) => nd.id === dc.id);
        if (!n) continue;
        const w = n.measured?.width ?? n.width ?? 200;
        const h = n.measured?.height ?? n.height ?? 200;
        boxMinX = Math.min(boxMinX, dc.position.x);
        boxMinY = Math.min(boxMinY, dc.position.y);
        boxMaxX = Math.max(boxMaxX, dc.position.x + w);
        boxMaxY = Math.max(boxMaxY, dc.position.y + h);
      }

      if (!Number.isFinite(boxMinX)) {
        return applyNodeChanges(changes, nds);
      }

      const otherNodes = nds
        .filter((n) => !draggedIds.has(n.id))
        .map((n) => ({
          id: n.id,
          position: { x: n.position.x, y: n.position.y },
          width: n.measured?.width ?? n.width ?? 200,
          height: n.measured?.height ?? n.height ?? 200,
        }));

      const result = computeAlignmentSnap(
        {
          id: '__selection__',
          position: { x: boxMinX, y: boxMinY },
          width: boxMaxX - boxMinX,
          height: boxMaxY - boxMinY,
        },
        otherNodes,
        snapThreshold
      );

      setGuideLines(result.guides);

      if (result.snappedPosition) {
        const deltaX = result.snappedPosition.x - boxMinX;
        const deltaY = result.snappedPosition.y - boxMinY;

        if (deltaX !== 0 || deltaY !== 0) {
          return applyNodeChanges(
            changes.map((c) => {
              if (c.type === 'position' && c.position) {
                return {
                  ...c,
                  position: {
                    x: c.position.x + deltaX,
                    y: c.position.y + deltaY,
                  },
                };
              }
              return c;
            }),
            nds
          );
        }
      }

      return applyNodeChanges(changes, nds);
    });
    setEdges((eds) => applyEdgeChanges(changes, eds));
  }, [snapThreshold]);
  const { isDark, toggleTheme } = useTheme();
  const [activeNodeId, setActiveNodeId] = useState(null);
  const [nodeIdCounter, setNodeIdCounter] = useState(initialState.counter);
  const [currentProjectId, setCurrentProjectId] = useState(null);
  const [projectSelectorOpen, setProjectSelectorOpen] = useState(false);
  const [projectsVersion, setProjectsVersion] = useState(0);
  const debouncedSave = useRef(createDebouncedSave(400)).current;
  const [menuState, setMenuState] = useState({
    visible: false,
    position: { x: 0, y: 0 },
    source: null,
  });
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [apiProviders, setApiProviders] = useState([]);
  const [nodeStates, setNodeStates] = useState({});
  const clipboardRef = useRef(null);
  const connectionSourceRef = useRef(null);
  const pendingConnectionDropRef = useRef(false);
  const [nodeContextMenu, setNodeContextMenu] = useState({
    visible: false,
    position: { x: 0, y: 0 },
    nodeId: null,
  });
  const [showMinimap, setShowMinimap] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [outputHistory, setOutputHistory] = useState([]);

  const reactFlowInstanceRef = useRef(null);

  const handleHistoryEntryClick = useCallback((nodeId) => {
    if (reactFlowInstance) {
      const node = nodes.find(n => n.id === nodeId);
      if (node) {
        reactFlowInstance.setCenter(node.position.x + 100, node.position.y + 100, { zoom: 1, duration: 300 });
      }
    }
  }, [nodes, reactFlowInstance]);

  const handleApiUpdate = useCallback((providers) => {
    setApiProviders(providers);
  }, []);

  const handleOpenSettings = useCallback(() => {
    setIsSettingsOpen(true);
  }, []);

  const handleCloseSettings = useCallback(() => {
    setIsSettingsOpen(false);
  }, []);

  /* Stable refs so customNodeTypes useMemo can have empty deps */
  const latestNodes = useRef(nodes);
  latestNodes.current = nodes;
  const latestEdges = useRef(edges);
  latestEdges.current = edges;

  /* Refs for keyboard handler (avoids adding fast-changing state to deps) */
  const keyboardDataRef = useRef({ nodeIdCounter, currentProjectId, nodeStates });
  keyboardDataRef.current = { nodeIdCounter, currentProjectId, nodeStates };

  /* Undo / Redo */
  const prevNodesRef = useRef(nodes);
  const prevEdgesRef = useRef(edges);
  const isFirstRender = useRef(true);
  const skipUndoRef = useRef(false);
  const undoPastRef = useRef([]);
  const undoFutureRef = useRef([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (skipUndoRef.current) {
      skipUndoRef.current = false;
      return;
    }
    if (draggingNodeRef.current) return;
    undoPastRef.current.push({
      nodes: structuredClone(prevNodesRef.current),
      edges: structuredClone(prevEdgesRef.current),
    });
    if (undoPastRef.current.length > 50) undoPastRef.current.shift();
    undoFutureRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, [nodes, edges]);

  /* Update previous-state ref after every render */
  useEffect(() => {
    prevNodesRef.current = nodes;
    prevEdgesRef.current = edges;
  });

  const handleUndo = useCallback(() => {
    const prev = undoPastRef.current.pop();
    if (!prev) return;
    undoFutureRef.current.push({
      nodes: structuredClone(nodes),
      edges: structuredClone(edges),
    });
    skipUndoRef.current = true;
    setNodes(prev.nodes);
    setEdges(prev.edges);
    setCanUndo(undoPastRef.current.length > 0);
    setCanRedo(true);
  }, [nodes, edges, setNodes, setEdges]);

  const handleRedo = useCallback(() => {
    const next = undoFutureRef.current.pop();
    if (!next) return;
    undoPastRef.current.push({
      nodes: structuredClone(nodes),
      edges: structuredClone(edges),
    });
    skipUndoRef.current = true;
    setNodes(next.nodes);
    setEdges(next.edges);
    setCanUndo(true);
    setCanRedo(undoFutureRef.current.length > 0);
  }, [nodes, edges, setNodes, setEdges]);
  const handleDeleteNode = useCallback(() => {
    if (!activeNodeId) return;
    setEdges(eds => eds.filter(e => e.source !== activeNodeId && e.target !== activeNodeId));
    setNodes(nds => nds.filter(n => n.id !== activeNodeId));
    setActiveNodeId(null);
  }, [activeNodeId, setNodes, setEdges]);

  /* Keyboard shortcuts: Ctrl+Z / Ctrl+Y / Ctrl+S / F / M / Delete */
  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        handleRedo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const d = keyboardDataRef.current;
        if (d.currentProjectId) {
          saveProject(d.currentProjectId, {
            nodes: latestNodes.current,
            edges: latestEdges.current,
            nodeIdCounter: d.nodeIdCounter,
            nodeStates: d.nodeStates,
          });
        }
      }
      if (!(e.ctrlKey || e.metaKey) && (e.key === 'Delete' || e.key === 'Backspace')) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        handleDeleteNode();
      }
      if (!(e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        reactFlowInstanceRef.current?.fitView({ padding: 0.2 });
      }
      if (!(e.ctrlKey || e.metaKey) && e.key === 'm') {
        e.preventDefault();
        setShowMinimap(v => !v);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo, handleDeleteNode, setShowMinimap]);

  /* Canvas paste: create source nodes from clipboard content */
  useEffect(() => {
    const handler = (e) => {
      const target = e.target;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.contentEditable === 'true') return;
      if (clipboardRef.current) return;

      e.preventDefault();
      e.stopPropagation();

      const dt = e.clipboardData;
      if (!dt) return;

      const vp = reactFlowInstance?.getViewport();
      const baseX = vp ? (window.innerWidth / 2 - vp.x) / vp.zoom : 300;
      const baseY = vp ? (window.innerHeight / 2 - vp.y) / vp.zoom : 200;

      const offsets = [
        { x: 0, y: 0 },
        { x: 40, y: 40 },
        { x: 80, y: 80 },
        { x: -40, y: 40 },
        { x: -80, y: 80 },
      ];

      let pastedCount = 0;

      /* Helper: create a media node (image/video/audio) */
      const pasteMediaNode = (nodeType, mw, mh, contentUrl, resultType, fileName, offsetIdx) => {
        let w = 220, h = 220;
        if (mw && mh) {
          const MAX_DIM = 500;
          const ratio = mw / mh;
          if (mw > MAX_DIM || mh > MAX_DIM) {
            if (mw > mh) { w = MAX_DIM; h = Math.round(w / ratio); }
            else { h = MAX_DIM; w = Math.round(h * ratio); }
          } else {
            w = mw; h = mh;
          }
        }
        const off = offsets[offsetIdx] || { x: 0, y: 0 };
        const pid = String(nodeIdCounter);
        const newNode = {
          id: pid,
          type: nodeType,
          width: w,
          height: h,
          position: { x: baseX + off.x, y: baseY + off.y },
          data: {
            title: fileName || '粘贴',
            prompt: '',
            images: contentUrl ? [{ url: contentUrl, name: fileName || '粘贴', type: resultType || 'image' }] : [],
            result: { type: resultType || 'image', url: contentUrl || '' },
          },
        };
        if (mw && mh) newNode.data.mediaAspectRatio = w / h;
        setNodes(ns => [...ns, newNode]);
        setNodeIdCounter(c => c + 1);
        pastedCount++;
      };

      /* ── Handle file from clipboard ── */
      const file = dt.files?.[0];
      if (file) {
        if (file.size > 50 * 1024 * 1024) return;

        const fileType = file.type.toLowerCase();
        const fileName = file.name.toLowerCase();
        let nodeType;
        if (fileType.startsWith('video/') || /\.(mp4|webm|mov|m4v|avi|mkv)$/i.test(fileName)) {
          nodeType = 'source-video';
        } else if (fileType.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(fileName)) {
          nodeType = 'source-audio';
        } else if (fileName.endsWith('.md')) {
          nodeType = 'source-markdown';
        } else if (fileType.startsWith('text/') || /\.(txt|json|csv|srt|vtt)$/i.test(fileName)) {
          nodeType = 'source-text';
        } else {
          nodeType = 'source-image';
        }

        if (nodeType === 'source-video') {
          const reader = new FileReader();
          reader.onload = (ev) => {
            const content = ev.target?.result;
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.onloadedmetadata = () => pasteMediaNode('source-video', video.videoWidth, video.videoHeight, content, 'video', file.name, 0);
            video.onerror = () => pasteMediaNode('source-video', null, null, content, 'video', file.name, 0);
            video.src = content;
          };
          reader.readAsDataURL(file);
        } else if (nodeType === 'source-audio') {
          const reader = new FileReader();
          reader.onload = (ev) => pasteMediaNode('source-audio', null, null, ev.target?.result, 'audio', file.name, 0);
          reader.readAsDataURL(file);
        } else if (nodeType === 'source-text' || nodeType === 'source-markdown') {
          const reader = new FileReader();
          reader.onload = (ev) => {
            const content = ev.target?.result;
            const pid = String(nodeIdCounter);
            const newNode = {
              id: pid,
              type: nodeType,
              width: 373,
              height: 210,
              position: { x: baseX, y: baseY },
              data: {
                title: file.name,
                prompt: '',
                images: [],
                result: { type: 'text', content },
              },
            };
            setNodes(ns => [...ns, newNode]);
            setNodeIdCounter(c => c + 1);
          };
          reader.readAsText(file);
        } else {
          compressImage(file).then(({ dataUrl, width, height }) => {
            pasteMediaNode('source-image', width, height, dataUrl, 'image', file.name, 0);
          }).catch(() => pasteMediaNode('source-image', null, null, null, 'image', file.name, 0));
        }
        return;
      }

      /* ── Handle plain text paste (no files) ── */
      if (pastedCount === 0 && dt.types?.includes('text/plain')) {
        const text = dt.getData('text/plain');
        if (text?.trim()) {
          const pid = String(nodeIdCounter);
          const newNode = {
            id: pid,
            type: 'source-text',
            width: 373,
            height: 210,
            position: { x: baseX, y: baseY },
            data: {
              title: '粘贴文本',
              prompt: '',
              images: [],
              result: { type: 'text', content: text },
            },
          };
          setNodes(ns => [...ns, newNode]);
          setNodeIdCounter(c => c + 1);
        }
      }
    };
    window.addEventListener('paste', handler, true);
    return () => window.removeEventListener('paste', handler, true);
  }, [reactFlowInstance, nodeIdCounter, setNodes, setNodeIdCounter]);

  useEffect(() => {
    const loadApiProviders = async () => {
      try {
        const res = await fetch('/api/providers');
        const data = await res.json();
        setApiProviders(data.providers);
      } catch (err) {
        console.error('Failed to load API providers:', err);
      }
    };
    loadApiProviders();
  }, []);

  useEffect(() => {
    setEdges((eds) =>
      eds.map((edge) => {
        const sourceType = edge.data?.sourceType || 'image';
        const edgeColor = getEdgeColor(sourceType, isDark);
        return {
          ...edge,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: edgeColor,
            width: 10,
            height: 10,
          },
          style: {
            stroke: edgeColor,
            strokeWidth: 1.5,
          },
        };
      })
    );
  }, [isDark, setEdges]);

  /* Auto-save canvas state to current project on changes */
  useEffect(() => {
    if (nodes.length === 0) return;
    if (!currentProjectId) return;
    saveProject(currentProjectId, { nodes, edges, nodeIdCounter, nodeStates });
  }, [nodes, edges, nodeIdCounter, nodeStates, currentProjectId]);

  /* On mount: migrate old storage, load last-used project */
  useEffect(() => {
    migrateFromOldStorage();
    const projects = listProjects();
    if (projects.length === 0) {
      setProjectSelectorOpen(true);
      return;
    }
    const lastId = getCurrentProjectId();
    const target = lastId && projects.find((p) => p.id === lastId) ? lastId : projects[0].id;
    const data = loadProject(target);
    if (data) {
      setCurrentProjectId(data.id);
      setCurrentProjectStorage(data.id);
      if (data.nodes.length > 0) {
        setNodes(data.nodes);
        setEdges(data.edges || []);
        setNodeIdCounter(data.nodeIdCounter || 1);
        setNodeStates(data.nodeStates || {});
      }
    } else {
      setProjectSelectorOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOpenProjectSelector = useCallback(() => {
    setProjectSelectorOpen(true);
  }, []);

  const handleCreateProject = useCallback((name) => {
    /* save current project first */
    if (currentProjectId) {
      saveProject(currentProjectId, { nodes, edges, nodeIdCounter, nodeStates });
    }
    const id = createProject(name);
    setCurrentProjectId(id);
    setCurrentProjectStorage(id);
    setNodes([]);
    setEdges([]);
    setNodeIdCounter(1);
    setNodeStates({});
    undoPastRef.current = [];
    undoFutureRef.current = [];
    setCanUndo(false);
    setCanRedo(false);
    setProjectsVersion((v) => v + 1);
  }, [currentProjectId, nodes, edges, nodeIdCounter, nodeStates, setNodes, setEdges]);

  const handleSwitchProject = useCallback((id) => {
    /* save current first */
    if (currentProjectId) {
      saveProject(currentProjectId, { nodes, edges, nodeIdCounter, nodeStates });
    }
    const data = loadProject(id);
    if (data) {
      setCurrentProjectId(data.id);
      setCurrentProjectStorage(data.id);
      setNodes(data.nodes || []);
      setEdges(data.edges || []);
      setNodeIdCounter(data.nodeIdCounter || 1);
      setNodeStates(data.nodeStates || {});
      undoPastRef.current = [];
      undoFutureRef.current = [];
      setCanUndo(false);
      setCanRedo(false);
      setProjectSelectorOpen(false);
    }
  }, [currentProjectId, nodes, edges, nodeIdCounter, nodeStates, setNodes, setEdges]);

  const handleDeleteProject = useCallback((id) => {
    deleteProjectFromStorage(id);
    const projects = listProjects();
    if (projects.length === 0) {
      setCurrentProjectId(null);
      setCurrentProjectStorage(null);
      setNodes([]);
      setEdges([]);
      setNodeIdCounter(1);
      setNodeStates({});
      undoPastRef.current = [];
      undoFutureRef.current = [];
      setCanUndo(false);
      setCanRedo(false);
    } else if (id === currentProjectId) {
      /* switched deleted was current — switch to first available */
      handleSwitchProject(projects[0].id);
    }
    setProjectsVersion((v) => v + 1);
  }, [currentProjectId, handleSwitchProject, setNodes, setEdges]);

  const handleRenameProject = useCallback((id, name) => {
    renameProjectInStorage(id, name);
    setProjectsVersion((v) => v + 1);
  }, []);

  const addNode = useCallback((type, position = null) => {
    const id = String(nodeIdCounter);
    const nodePosition = position && reactFlowInstance
      ? reactFlowInstance.screenToFlowPosition(position)
      : { x: 200 + Math.random() * 200, y: 100 + Math.random() * 200 };

    const title = type === 'image' ? '图片' : type === 'text' ? '文字' : type === 'video' ? '视频'
      : type === 'source-text' ? '文本素材' : type === 'source-image' ? '图像素材'
      : type === 'source-video' ? '视频素材' : type === 'source-audio' ? '音频素材'
      : type === 'source-markdown' ? 'Markdown 素材' : '节点';
    const aspectRatio = '16:9';
    const { width, height } = getNodeSize(aspectRatio, type, {});

    const newNode = {
      id, type, position: nodePosition,
      width, height,
      data: {
        title,
        prompt: '',
        images: [],
        ...(type.startsWith('source-') ? {} : { aspectRatio, resolution: '1K', model: '' }),
        ...(type === 'video' ? { duration: '5', fps: '30' } : {}),
      },
    };
    setNodes(nodes => [...nodes, newNode]);
    setNodeIdCounter(c => c + 1);
    return id;
  }, [nodeIdCounter, setNodes, reactFlowInstance]);

  const handleNodeTypeChange = useCallback((nodeId, newType) => {
    setNodes(nodes => nodes.map(node => {
      if (node.id === nodeId) {
        const aspectRatio = node.data?.aspectRatio || '16:9';
        const { width, height } = getNodeSize(aspectRatio, newType);
        return {
          ...node,
          type: newType,
          width,
          height,
          data: {
            ...node.data,
            title: newType === 'image' ? '图片' : newType === 'text' ? '文字' : '视频',
            ...(newType === 'video' ? { duration: node.data.duration || '5', fps: node.data.fps || '30' } : {}),
          },
        };
      }
      return node;
    }));
  }, [setNodes]);

  const handleCloseMenu = useCallback(() => {
    setMenuState({ visible: false, position: { x: 0, y: 0 }, source: null });
    connectionSourceRef.current = null;
    pendingConnectionDropRef.current = false;
    setIsConnecting(false);
  }, []);

  const handlePaneContextMenu = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuState({
      visible: true,
      position: { x: e.clientX, y: e.clientY },
      source: 'contextmenu',
    });
  }, []);

  const handleNodeContextMenu = useCallback((e, nodeId) => {
    e.preventDefault();
    e.stopPropagation();
    // Close pane menu if open
    setMenuState({ visible: false, position: { x: 0, y: 0 }, source: null });
    setNodeContextMenu({
      visible: true,
      position: { x: e.clientX, y: e.clientY },
      nodeId,
    });
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setNodeContextMenu({ visible: false, position: { x: 0, y: 0 }, nodeId: null });
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleFileDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();

    const files = e.dataTransfer?.files;
    if (!files?.length) {
      // Check for output history entry drag
      try {
        const textData = e.dataTransfer?.getData('text/plain');
        if (textData) {
          const entry = JSON.parse(textData);
          if (entry._source === 'output-history') {
            const position = reactFlowInstance
              ? reactFlowInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY })
              : { x: 200 + Math.random() * 200, y: 100 + Math.random() * 200 };

            const { width, height } = getNodeSize(entry.aspectRatio || '16:9', entry.nodeType, {});
            const newId = String(nodeIdCounter);

            const newNode = {
              id: newId,
              type: entry.nodeType,
              position,
              width,
              height,
              data: {
                title: entry.title || '历史输出',
                prompt: entry.prompt || '',
                model: entry.model || '',
                aspectRatio: entry.aspectRatio || '16:9',
                resolution: entry.resolution || '1K',
                images: entry.result?.url
                  ? [{ url: entry.result.url, name: entry.title || entry.nodeType, type: entry.result.type || 'image' }]
                  : [],
                result: entry.result,
                ...(entry.nodeType === 'video' ? { duration: entry.duration || '5', fps: entry.fps || '30' } : {}),
              },
            };

            setNodes(nodes => [...nodes, newNode]);
            setNodeIdCounter(c => c + 1);
            return;
          }
        }
      } catch {
        // Not a valid history entry — ignore
      }
      return;
    }

    const file = files[0];
    if (file.size > 50 * 1024 * 1024) return;

    const position = reactFlowInstance
      ? reactFlowInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY })
      : null;
    const dropId = String(nodeIdCounter);

    const fileType = file.type.toLowerCase();
    const fileName = file.name.toLowerCase();
    let nodeType;
    if (fileType.startsWith('video/') || /\.(mp4|webm|mov|m4v|avi|mkv)$/i.test(fileName)) {
      nodeType = 'source-video';
    } else if (fileType.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(fileName)) {
      nodeType = 'source-audio';
    } else if (fileName.endsWith('.md')) {
      nodeType = 'source-markdown';
    } else if (fileType.startsWith('text/') || /\.(txt|json|csv|srt|vtt)$/i.test(fileName)) {
      nodeType = 'source-text';
    } else {
      nodeType = 'source-image';
    }

    const createMediaNode = (mw, mh, contentUrl, resultType) => {
      let w = 220, h = 220;
      if (mw && mh) {
        const MAX_DIM = 500;
        const ratio = mw / mh;
        if (mw > MAX_DIM || mh > MAX_DIM) {
          if (mw > mh) { w = MAX_DIM; h = Math.round(w / ratio); }
          else { h = MAX_DIM; w = Math.round(h * ratio); }
        } else {
          w = mw; h = mh;
        }
      }
      const newNode = {
        id: dropId,
        type: nodeType,
        width: w,
        height: h,
        position: position || { x: 200 + Math.random() * 200, y: 100 + Math.random() * 200 },
        data: {
          title: file.name,
          prompt: '',
          images: contentUrl ? [{ url: contentUrl, name: file.name, type: resultType || 'image' }] : [],
          result: { type: resultType || 'image', url: contentUrl || '' },
        },
      };
      if (mw && mh) newNode.data.mediaAspectRatio = w / h;
      setNodes(nodes => [...nodes, newNode]);
    };

    if (nodeType === 'source-video') {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const content = ev.target?.result;
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.onloadedmetadata = () => createMediaNode(video.videoWidth, video.videoHeight, content, 'video');
        video.onerror = () => createMediaNode(null, null, content, 'video');
        video.src = content;
      };
      reader.readAsDataURL(file);
    } else if (nodeType === 'source-audio') {
      const reader = new FileReader();
      reader.onload = (ev) => {
        createMediaNode(null, null, ev.target?.result, 'audio');
      };
      reader.readAsDataURL(file);
    } else if (nodeType === 'source-text' || nodeType === 'source-markdown') {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const content = ev.target?.result;
        const newNode = {
          id: dropId,
          type: nodeType,
          width: 373,
          height: 210,
          position: position || { x: 200 + Math.random() * 200, y: 100 + Math.random() * 200 },
          data: {
            title: file.name,
            prompt: '',
            images: [],
            result: { type: 'text', content: content },
          },
        };
        setNodes(nodes => [...nodes, newNode]);
      };
      reader.readAsText(file);
    } else {
      // source-image: compress and create
      compressImage(file).then(({ dataUrl, width, height }) => {
        createMediaNode(width, height, dataUrl, 'image');
      }).catch(() => createMediaNode(null, null, null, 'image'));
    }

    setNodeIdCounter(c => c + 1);
  }, [reactFlowInstance, nodeIdCounter, setNodes, setNodeIdCounter]);

  const handleMenuSelect = useCallback((type, position) => {
    const connectFrom = menuState.source === 'connect' ? connectionSourceRef.current : null;
    const nodeId = addNode(type, position);

    if (connectFrom && nodeId) {
      const sourceNode = nodes.find(n => n.id === connectFrom.nodeId);
      const sourceType = sourceNode?.type || 'image';
      const edgeColor = getEdgeColor(sourceType, isDark);
      setEdges(eds => addEdge({
        source: connectFrom.nodeId,
        sourceHandle: connectFrom.handleId || null,
        target: nodeId,
        targetHandle: 'target',
        data: { sourceType },
        markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor, width: 10, height: 10 },
        style: { stroke: edgeColor, strokeWidth: 1.5 },
      }, eds));
      connectionSourceRef.current = null;
    }
    setIsConnecting(false);
  }, [addNode, nodes, setEdges, isDark, menuState.source]);

  const handleAddFromEmpty = useCallback((type) => {
    addNode(type);
  }, [addNode]);

  const handleNodeClick = useCallback((event, nodeId) => {
    event.stopPropagation();
    const node = nodes.find(n => n.id === nodeId);
    if (node?.type?.startsWith('source-')) {
      if (node.data?.result) return;
      if (node.type === 'source-text' || node.type === 'source-markdown') {
        return; // handled by double-click in BaseNode
      }
      // Set accept filter based on source node type
      const acceptMap = {
        'source-image': 'image/*',
        'source-video': 'video/*',
        'source-audio': 'audio/*',
      };
      mediaFileInputRef.current.accept = acceptMap[node.type] || '*/*';
      pendingMediaNodeIdRef.current = nodeId;
      mediaFileInputRef.current?.click();
      return;
    }
    setActiveNodeId(activeNodeId === nodeId ? null : nodeId);
  }, [activeNodeId, nodes]);

  const handleCloseDrawer = useCallback(() => {
    setActiveNodeId(null);
  }, []);

  const handleMediaFileChange = useCallback((e) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    const nodeId = pendingMediaNodeIdRef.current;
    if (!nodeId) return;

    const isVideo = file.type.startsWith('video/');
    const isAudio = file.type.startsWith('audio/');

    const updateNode = (mw, mh, contentUrl, resultType) => {
      let w = 220, h = 220, ar = null;
      if (mw && mh) {
        const MAX_DIM = 500;
        const ratio = mw / mh;
        if (mw > MAX_DIM || mh > MAX_DIM) {
          if (mw > mh) { w = MAX_DIM; h = Math.round(w / ratio); }
          else { h = MAX_DIM; w = Math.round(h * ratio); }
        } else {
          w = mw; h = mh;
        }
        ar = w / h;
      }
      const resType = resultType || (isVideo ? 'video' : isAudio ? 'audio' : 'image');
      setNodes(nds => nds.map(n =>
        n.id === nodeId
          ? {
              ...n, width: w, height: h,
              data: {
                ...n.data, mediaAspectRatio: ar, title: file.name, prompt: '',
                mediaWidth: mw, mediaHeight: mh,
                images: [{ url: contentUrl || '', name: file.name, type: resType }],
                result: { type: resType, url: contentUrl || '' },
              },
            }
          : n
      ));
      pendingMediaNodeIdRef.current = null;
    };

    if (isVideo) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const content = ev.target?.result;
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.onloadedmetadata = () => updateNode(video.videoWidth, video.videoHeight, content, 'video');
        video.onerror = () => updateNode(null, null, content, 'video');
        video.src = content;
      };
      reader.readAsDataURL(file);
    } else if (isAudio) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        updateNode(null, null, ev.target?.result, 'audio');
      };
      reader.readAsDataURL(file);
    } else {
      compressImage(file).then(({ dataUrl, width, height }) => {
        updateNode(width, height, dataUrl, 'image');
      }).catch(() => updateNode(null, null, null, 'image'));
    }

    e.target.value = '';
  }, [setNodes]);

  const handleSubmit = useCallback(async (nodeId, data) => {
    setNodes(nodes =>
      nodes.map(node => {
        if (node.id === nodeId) {
          const newData = typeof data === 'object' ? data : { prompt: data };
          // Recalculate dimensions if aspectRatio or type might have changed
          const nextType = newData.nodeType || node.type;
          const nextAspectRatio = newData.aspectRatio || node.data?.aspectRatio || '16:9';
          const { width, height } = getNodeSize(nextAspectRatio, nextType);
          return { ...node, type: nextType, width, height, data: { ...node.data, ...newData } };
        }
        return node;
      })
    );

    const prompt = data?.prompt || '';
    const nodeType = data?.nodeType || 'text';
    const model = data?.model || '';
    const aspectRatio = data?.aspectRatio || null;
    const resolution = data?.resolution || null;
    const duration = data?.duration || null;
    const fps = data?.fps || null;

    if (!prompt.trim()) {
      setNodeStates(prev => ({
        ...prev,
        [nodeId]: { processing: false, progress: 0, error: '请输入内容！' }
      }));
      setTimeout(() => {
        setNodeStates(prev => ({
          ...prev,
          [nodeId]: { processing: false, progress: 0, error: null }
        }));
      }, 3000);
      return;
    }

    // Map model to provider_id for the backend
    const providerId = findProviderForModel(model, nodeType, apiProviders);

    setNodeStates(prev => ({
      ...prev,
      [nodeId]: { processing: true, progress: 0, error: null }
    }));

    // Fake progress animation while polling
    let fakeProgress = 0;
    const fakeInterval = setInterval(() => {
      fakeProgress += Math.random() * 8 + 2;
      if (fakeProgress >= 90) fakeProgress = 90;
      setNodeStates(prev => {
        const current = prev[nodeId];
        if (!current?.processing) return prev;
        return { ...prev, [nodeId]: { ...current, progress: fakeProgress } };
      });
    }, 300);

    try {
      // Collect reference images/videos from upstream connected nodes
      const upstreamEdges = latestEdges.current.filter(e => e.target === nodeId);
      const refImages = [];
      const refVideos = [];
      upstreamEdges.forEach(e => {
        const sourceNode = latestNodes.current.find(n => n.id === e.source);
        if (!sourceNode?.data?.images) return;
        sourceNode.data.images.forEach(img => {
          if (img.type === 'video') refVideos.push(img);
          else refImages.push(img);
        });
      });

      const { task_id } = await createTask({
        type: nodeType,
        prompt,
        model,
        provider_id: providerId,
        aspect_ratio: aspectRatio,
        resolution,
        duration,
        fps,
        images: refImages.length > 0 ? refImages : undefined,
        videos: refVideos.length > 0 ? refVideos : undefined,
      });

      const pollInterval = setInterval(async () => {
        try {
          const task = await getTaskStatus(task_id);

          if (task.status === 'succeeded') {
            clearInterval(pollInterval);
            clearInterval(fakeInterval);
            setNodeStates(prev => ({
              ...prev,
              [nodeId]: { processing: false, progress: 100, error: null }
            }));
            // Add to output history
            const node = latestNodes.current.find(n => n.id === nodeId);
            setOutputHistory(prev => {
              const entry = {
                id: `${nodeId}-${Date.now()}`,
                nodeId,
                nodeType: node?.type || 'image',
                title: node?.data?.title || '',
                prompt: data?.prompt || '',
                model: data?.model || '',
                aspectRatio: data?.aspectRatio || null,
                resolution: data?.resolution || null,
                duration: data?.duration || null,
                fps: data?.fps || null,
                result: task.result,
                timestamp: new Date(),
              };
              const next = [...prev, entry];
              return next.length > 100 ? next.slice(-100) : next;
            });
            if (task.result) {
              setNodes(nodes =>
                nodes.map(node => {
                  if (node.id === nodeId) {
                    const resultType = task.result?.type || '';
                    const newImage = (resultType === 'image' || resultType === 'video')
                      ? { url: task.result.url || '', name: data?.title || '生成结果', type: resultType }
                      : null;
                    return {
                      ...node,
                      data: {
                        ...node.data,
                        result: task.result,
                        images: newImage
                          ? [newImage]
                          : (node.data.images || []),
                      },
                    };
                  }
                  return node;
                })
              );
            }
            setTimeout(() => {
              setNodeStates(prev => ({
                ...prev,
                [nodeId]: { processing: false, progress: 0, error: null }
              }));
            }, 1000);
          } else if (task.status === 'failed') {
            clearInterval(pollInterval);
            clearInterval(fakeInterval);
            setNodeStates(prev => ({
              ...prev,
              [nodeId]: { processing: false, progress: 0, error: task.error || '生成失败' }
            }));
            setTimeout(() => {
              setNodeStates(prev => ({
                ...prev,
                [nodeId]: { processing: false, progress: 0, error: null }
              }));
            }, 5000);
          }
        } catch (pollErr) {
          console.error('轮询失败:', pollErr);
        }
      }, 2000);

    } catch (error) {
      clearInterval(fakeInterval);
      console.error('创建任务失败:', error);
      setNodeStates(prev => ({
        ...prev,
        [nodeId]: { processing: false, progress: 0, error: error.message || '创建任务失败，请检查API配置' }
      }));
      setTimeout(() => {
        setNodeStates(prev => ({
          ...prev,
          [nodeId]: { processing: false, progress: 0, error: null }
        }));
      }, 5000);
    }
  }, [setNodes, setNodeStates, apiProviders, latestEdges, latestNodes]);

  const handleContextMenuAction = useCallback((action, nodeId) => {
    switch (action) {
      case 'run': {
        const node = nodes.find(n => n.id === nodeId);
        if (node && node.data.prompt) {
          handleSubmit(nodeId, node.data);
        }
        break;
      }
      case 'duplicate': {
        const sourceNode = nodes.find(n => n.id === nodeId);
        if (!sourceNode) break;
        const newId = String(nodeIdCounter);
        const clone = {
          ...structuredClone(sourceNode),
          id: newId,
          position: { x: sourceNode.position.x + 50, y: sourceNode.position.y + 50 },
          selected: false,
        };
        setNodes(nds => [...nds, clone]);
        setNodeIdCounter(c => c + 1);
        break;
      }
      case 'toggle-disable': {
        setNodes(nds => nds.map(n =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, disabled: !n.data.disabled } }
            : n
        ));
        break;
      }
      case 'delete': {
        setEdges(eds => eds.filter(e => e.source !== nodeId && e.target !== nodeId));
        setNodes(nds => nds.filter(n => n.id !== nodeId));
        if (activeNodeId === nodeId) setActiveNodeId(null);
        break;
      }
      case 'rename': {
        const node = nodes.find(n => n.id === nodeId);
        const currentTitle = node?.data?.title || '';
        const newTitle = window.prompt('请输入新标题：', currentTitle);
        if (newTitle !== null && newTitle !== currentTitle) {
          handleRenameNode(nodeId, newTitle);
        }
        break;
      }
      case 'copy': {
        const node = nodes.find(n => n.id === nodeId);
        if (node) {
          clipboardRef.current = structuredClone(node);
        }
        break;
      }
      case 'paste': {
        if (!clipboardRef.current) break;
        const newId = String(nodeIdCounter);
        const pasteNode = {
          ...structuredClone(clipboardRef.current),
          id: newId,
          position: { x: clipboardRef.current.position.x + 80, y: clipboardRef.current.position.y + 80 },
          selected: false,
        };
        setNodes(nds => [...nds, pasteNode]);
        setNodeIdCounter(c => c + 1);
        break;
      }
    }
  }, [nodes, activeNodeId, handleSubmit, nodeIdCounter, setNodes, setEdges]);

  const onConnectStart = useCallback((event, params) => {
    setIsConnecting(true);
    if (params) {
      connectionSourceRef.current = {
        nodeId: params.nodeId,
        handleId: params.handleId ?? null,
        handleType: params.handleType ?? null,
      };
    }
  }, []);

  const onConnectEnd = useCallback((event, connectionState) => {
    setIsConnecting(false);
    if (connectionState && !connectionState.toHandle) {
      setMenuState({
        visible: true,
        position: { x: event.clientX, y: event.clientY },
        source: 'connect',
      });
    }
  }, []);

  // Native mouseup handler: shows NodeTypeMenu when a connection is dropped on empty canvas.
  // Note: we do NOT clear connectionSourceRef here — handleMenuSelect needs it
  // when the user picks a node type. It's cleared by handleCloseMenu or handleMenuSelect.
  useEffect(() => {
    const onMouseUp = (e) => {
      const ref = connectionSourceRef.current;
      if (ref) {
        if (!document
          .elementsFromPoint(e.clientX, e.clientY)
          .some(el => el.classList?.contains?.('react-flow__handle'))) {
          pendingConnectionDropRef.current = true;
          setMenuState({
            visible: true,
            position: { x: e.clientX, y: e.clientY },
            source: 'connect',
          });
        }
      }
    };
    document.addEventListener('mouseup', onMouseUp);
    return () => document.removeEventListener('mouseup', onMouseUp);
  }, []);

  // Native mousedown handler: detects handle clicks at the native level.
  // This is the PRIMARY mechanism for capturing connection start — it works
  // independently of React Flow's onConnectStart callback.
  useEffect(() => {
    const onMouseDown = (e) => {
      const handle = e.target.closest('.react-flow__handle');
      if (handle && e.button === 0) {
        const nodeId = handle.getAttribute('data-nodeid');
        const rawHandleId = handle.getAttribute('data-handleid');
        if (nodeId) {
          connectionSourceRef.current = {
            nodeId,
            handleId: rawHandleId === 'null' ? null : rawHandleId,
            handleType: handle.classList.contains('target') ? 'target' : 'source',
          };
        }
      }
    };
    document.addEventListener('mousedown', onMouseDown, true);
    return () => document.removeEventListener('mousedown', onMouseDown, true);
  }, []);

  const handleDeleteEdge = useCallback(
    (edgeId) => {
      setEdges((eds) => eds.filter((e) => e.id !== edgeId));
    },
    [setEdges]
  );

  const onConnect = useCallback(
    (params) => {
      let sourceType = 'image';
      setNodes((nds) => {
        const sourceNode = nds.find((n) => n.id === params.source);
        if (sourceNode) {
          sourceType = sourceNode.type || 'image';
          // Copy text content from text and source-text/source-markdown nodes
          const sourceContent = (sourceNode.type === 'text' || sourceNode.type === 'source-text' || sourceNode.type === 'source-markdown')
            ? sourceNode.data.result?.content
            : null;
          if (sourceContent) {
            return nds.map((node) => {
              if (node.id === params.target) {
                if (!node.data.prompt) {
                  return { ...node, data: { ...node.data, prompt: sourceContent } };
                }
              }
              return node;
            });
          }
        }
        return nds;
      });

      const edgeColor = getEdgeColor(sourceType, isDark);
      const newEdge = {
        ...params,
        data: { sourceType },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: edgeColor,
          width: 10,
          height: 10,
        },
        style: {
          stroke: edgeColor,
          strokeWidth: 1.5,
        },
      };

      setEdges((eds) => addEdge(newEdge, eds));
      setIsConnecting(false);
    },
    [setEdges, setNodes, isDark]
  );

  const onEdgeClick = useCallback(
    (event, edge) => {
      event.stopPropagation();
      handleDeleteEdge(edge.id);
    },
    [handleDeleteEdge]
  );

  const handleUpdateResult = useCallback((nodeId, content) => {
    setNodes(nds => nds.map(n => {
      if (n.id === nodeId) {
        return { ...n, data: { ...n.data, result: { ...n.data.result, content } } };
      }
      return n;
    }));
  }, [setNodes]);

  const handleRenameNode = useCallback((nodeId, newTitle) => {
    setNodes(nds => nds.map(n => {
      if (n.id === nodeId) {
        return { ...n, data: { ...n.data, title: newTitle } };
      }
      return n;
    }));
  }, [setNodes]);

  const handleUpdateNodeData = useCallback((nodeId, dataPatch) => {
    setNodes(nds => nds.map(n => {
      if (n.id === nodeId) {
        return { ...n, data: { ...n.data, ...dataPatch } };
      }
      return n;
    }));
  }, [setNodes]);

  const handleResizeNode = useCallback((nodeId, width, height) => {
    setNodes(nds => nds.map(n => {
      if (n.id === nodeId) {
        return { ...n, width, height };
      }
      return n;
    }));
  }, [setNodes]);

  // --- Alignment snap drag handlers ---
  const handleNodeDragStart = useCallback((event, node) => {
    draggingNodeRef.current = {
      id: node.id,
      width: node.measured?.width ?? node.width ?? 200,
      height: node.measured?.height ?? node.height ?? 200,
    };
  }, []);

  const handleNodeDrag = useCallback((_event, _node) => {
    // Snap and guide lines are handled in onNodesChange to avoid
    // update conflicts between instance.setNodes() and controlled prop sync.
  }, []);

  const handleNodeDragStop = useCallback((event, node) => {
    // Final snap correction: apply snapped position one last time.
    // React Flow emits a trailing dragging=false position change after
    // drag stop which bypasses our onNodesChange snap (which only fires
    // when dragging=true). We correct it here via React state to keep
    // the store in sync and avoid the instance.setNodes() race condition.
    // Handles both single-node and multi-node (bounding box) drags.
    if (node) {
      setNodes((nds) => {
        const allSelected = nds.filter(
          (n) => n.selected || n.id === node.id
        );
        const isMultiDrag = allSelected.length > 1;

        if (!isMultiDrag) {
          // --- Single-node final snap ---
          const draggedNode = nds.find((n) => n.id === node.id);
          if (!draggedNode) return nds;

          const otherNodes = nds
            .filter((n) => n.id !== node.id)
            .map((n) => ({
              id: n.id,
              position: { x: n.position.x, y: n.position.y },
              width: n.measured?.width ?? n.width ?? 200,
              height: n.measured?.height ?? n.height ?? 200,
            }));

          const result = computeAlignmentSnap(
            {
              id: node.id,
              position: {
                x: draggedNode.position.x,
                y: draggedNode.position.y,
              },
              width: draggedNode.measured?.width ?? draggedNode.width ?? 200,
              height: draggedNode.measured?.height ?? draggedNode.height ?? 200,
            },
            otherNodes,
            snapThreshold
          );

          if (result.snappedPosition) {
            return nds.map((n) =>
              n.id === node.id
                ? { ...n, position: result.snappedPosition }
                : n
            );
          }
          return nds;
        }

        // --- Multi-node final snap: bounding box delta ---
        const draggedIds = new Set(allSelected.map((n) => n.id));
        let boxMinX = Infinity,
          boxMinY = Infinity;
        let boxMaxX = -Infinity,
          boxMaxY = -Infinity;

        for (const n of allSelected) {
          const w = n.measured?.width ?? n.width ?? 200;
          const h = n.measured?.height ?? n.height ?? 200;
          boxMinX = Math.min(boxMinX, n.position.x);
          boxMinY = Math.min(boxMinY, n.position.y);
          boxMaxX = Math.max(boxMaxX, n.position.x + w);
          boxMaxY = Math.max(boxMaxY, n.position.y + h);
        }

        if (!Number.isFinite(boxMinX)) return nds;

        const otherNodes = nds
          .filter((n) => !draggedIds.has(n.id))
          .map((n) => ({
            id: n.id,
            position: { x: n.position.x, y: n.position.y },
            width: n.measured?.width ?? n.width ?? 200,
            height: n.measured?.height ?? n.height ?? 200,
          }));

        const result = computeAlignmentSnap(
          {
            id: '__selection__',
            position: { x: boxMinX, y: boxMinY },
            width: boxMaxX - boxMinX,
            height: boxMaxY - boxMinY,
          },
          otherNodes,
          snapThreshold
        );

        if (result.snappedPosition) {
          const deltaX = result.snappedPosition.x - boxMinX;
          const deltaY = result.snappedPosition.y - boxMinY;
          if (deltaX !== 0 || deltaY !== 0) {
            return nds.map((n) =>
              draggedIds.has(n.id)
                ? {
                    ...n,
                    position: {
                      x: n.position.x + deltaX,
                      y: n.position.y + deltaY,
                    },
                  }
                : n
            );
          }
        }
        return nds;
      });
    }
    setGuideLines([]);
    draggingNodeRef.current = null;
  }, [snapThreshold, setNodes]);

  const onSelectionChange = useCallback(({ nodes }) => {
    setSelectedNodeCount(nodes.length);
  }, []);


  const customNodeTypes = useMemo(() => ({
    image: (props) => <ImageNode {...props} />,
    text: (props) => <TextNode {...props} />,
    video: (props) => <VideoNode {...props} />,
    'source-text': (props) => <SourceTextNode {...props} />,
    'source-image': (props) => <SourceImageNode {...props} />,
    'source-video': (props) => <SourceVideoNode {...props} />,
    'source-audio': (props) => <SourceAudioNode {...props} />,
    'source-markdown': (props) => <SourceMarkdownNode {...props} />,
  }), []);

  const contextValue = useMemo(() => ({ isConnecting }), [isConnecting]);
  const projectList = useMemo(() => listProjects(), [projectsVersion]);

  const emptyStateBtnStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 9,
    padding: '10px 18px',
    borderRadius: 12,
    border: '1px solid var(--panel-border)',
    background: 'var(--btn-secondary-bg)',
    color: 'var(--text-primary)',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.15s var(--ease-out)',
  };

  return (
    <ConnectionContext.Provider value={contextValue}>
      <ActiveNodeContext.Provider value={{ activeNodeId, handleNodeClick, handleSubmit, handleNodeTypeChange, handleUpdateResult, handleRenameNode, handleUpdateNodeData, handleResizeNode, handleOpenSettings, handleNodeContextMenu, apiProviders, nodeStates, nodes: latestNodes.current, edges: latestEdges.current }}>
      <div ref={reactFlowWrapper} style={{ width: '100%', height: '100%' }}
            onDragOver={handleDragOver}
            onDrop={handleFileDrop}>
        <Sidebar
          toggleTheme={toggleTheme}
          currentTheme={isDark ? 'dark' : 'light'}
          onOpenProjectSelector={handleOpenProjectSelector}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onOpenSettings={handleOpenSettings}
          showMinimap={showMinimap}
          onToggleMinimap={() => setShowMinimap(v => !v)}
          historyOpen={historyOpen}
          onToggleHistory={() => setHistoryOpen(v => !v)}
          historyEntryCount={outputHistory.length}
        />
        <div className={selectedNodeCount <= 1 ? 'hide-single-selection-rect' : ''} style={{ width: '100%', height: '100%' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          onInit={(instance) => { setReactFlowInstance(instance); reactFlowInstanceRef.current = instance; }}
          onEdgeClick={onEdgeClick}
          nodeTypes={customNodeTypes}
          fitView
          minZoom={0.15}
          maxZoom={2.5}
          onNodeDragStart={handleNodeDragStart}
          onNodeDrag={handleNodeDrag}
          onNodeDragStop={handleNodeDragStop}
          connectionLineStyle={{
            stroke: 'var(--accent)',
            strokeWidth: 1.5,
            strokeDasharray: '4 4',
          }}
          panOnDrag={[1]}
          panOnScroll
          panOnScrollMode="vertical"
          zoomOnScroll
          zoomOnPinch
          selectionOnDrag
          selectionMode={SelectionMode.Partial}
          onSelectionChange={onSelectionChange}
          zoomOnDoubleClick={false}
          onPaneClick={(e) => {
            if (pendingConnectionDropRef.current) {
              pendingConnectionDropRef.current = false;
              return;
            }
            handleCloseDrawer();
            if (menuState.visible) {
              handleCloseMenu();
            }
            if (nodeContextMenu.visible) {
              handleCloseContextMenu();
            }
            // In selectionOnDrag mode, React Flow disables its internal onClick
            // handler. The NodesSelection rect (pointer-events: all) can also
            // intercept clicks. We must explicitly deselect here.
            storeApi.getState().resetSelectedElements();
            storeApi.setState({ nodesSelectionActive: false });
          }}
          onPaneContextMenu={handlePaneContextMenu}
        >
          <GridBackground />
          {showMinimap && (
            <MiniMap
              nodeStrokeColor={(node) => {
                const meta = NODE_TYPE_REGISTRY[node.type];
                return meta?.accentVar || 'var(--node-border-hover)';
              }}
              nodeColor={(node) => {
                const meta = NODE_TYPE_REGISTRY[node.type];
                return meta?.accentVar || 'var(--node-bg)';
              }}
              nodeBorderRadius={6}
              pannable={false}
              zoomable={false}
              style={{
                width: 200,
                height: 140,
                background: 'var(--panel-bg)',
                borderRadius: 12,
                boxShadow: 'var(--panel-shadow)',
                backdropFilter: 'var(--panel-blur)',
                bottom: 52,
                left: 48,
                border: '1px solid var(--panel-border)',
              }}
            />
          )}
          <Controls position="bottom-right" showInteractive={false} style={{ bottom: 48, right: 8 }} />
          <AlignmentGuides guides={guideLines} />
        </ReactFlow>
        </div>
        {nodes.length === 0 && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 50, pointerEvents: 'none', animation: 'fadeIn 0.4s var(--ease-out)',
          }}>
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24,
              maxWidth: 380, textAlign: 'center', pointerEvents: 'auto',
            }}>
              <div style={{
                background: 'var(--accent-soft)',
                border: '1px solid var(--panel-border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--accent)',
              }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7" />
                  <line x1="12" y1="12" x2="12" y2="12.01" />
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                  开始创作
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, fontWeight: 500 }}>
                  选择一个节点类型，开始构建你的 AI 视觉工作流
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                <button onClick={() => handleAddFromEmpty('image')}
                  style={emptyStateBtnStyle}>
                  <span style={{ color: 'var(--signal-image)' }}>{NODE_TYPE_REGISTRY.image.smallIcon}</span>
                  图片节点
                </button>

                <button onClick={() => handleAddFromEmpty('video')}
                  style={emptyStateBtnStyle}>
                  <span style={{ color: 'var(--signal-video)' }}>{NODE_TYPE_REGISTRY.video.smallIcon}</span>
                  视频节点
                </button>
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 500 }}>
                点击 Sidebar "+" 按钮或右键画布也可创建节点              </div>
            </div>
          </div>
        )}
        {menuState.visible && (
          <NodeTypeMenu
            position={menuState.position}
            onSelect={handleMenuSelect}
            onClose={handleCloseMenu}
            triggerButtonRef={null}
          />
        )}
        {nodeContextMenu.visible && (
          <NodeContextMenu
            position={nodeContextMenu.position}
            nodeId={nodeContextMenu.nodeId}
            isDisabled={nodes.find(n => n.id === nodeContextMenu.nodeId)?.data?.disabled || false}
            isProcessing={nodeStates[nodeContextMenu.nodeId]?.processing || false}
            hasClipboard={clipboardRef.current !== null}
            onSelect={handleContextMenuAction}
            onClose={handleCloseContextMenu}
          />
        )}
        {isSettingsOpen && (
          <SettingsPanel onClose={handleCloseSettings} onApiUpdate={handleApiUpdate} />
        )}
        <ProjectSelector
          open={projectSelectorOpen}
          projects={projectList}
          currentProjectId={currentProjectId}
          onClose={() => setProjectSelectorOpen(false)}
          onSwitch={handleSwitchProject}
          onCreate={handleCreateProject}
          onDelete={handleDeleteProject}
          onRename={handleRenameProject}
        />
        <input ref={mediaFileInputRef} type="file" accept="image/*,video/*,audio/*" onChange={handleMediaFileChange} style={{ display: 'none' }} />
        <OutputHistoryPanel
          entries={outputHistory}
          isOpen={historyOpen}
          onToggle={() => setHistoryOpen(v => !v)}
          onEntryClick={handleHistoryEntryClick}
        />
    </div>
    </ActiveNodeContext.Provider>
    </ConnectionContext.Provider>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ReactFlowProvider>
        <AppContent />
      </ReactFlowProvider>
    </ThemeProvider>
  );
}
