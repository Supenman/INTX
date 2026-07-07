import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  ReactFlow,
  useNodesState,
  useEdgesState,
  addEdge,
  Controls,
  MiniMap,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import ImageNode from './components/ImageNode';
import TextNode from './components/TextNode';
import VideoNode from './components/VideoNode';
import MediaNode from './components/MediaNode';
import GridBackground from './components/GridBackground';
import Sidebar from './components/Sidebar';
import NodeTypeMenu from './components/NodeTypeMenu';
import NodeContextMenu from './components/NodeContextMenu';
import StatusLog from './components/StatusLog';
import ApiSettings from './components/ApiSettings';
import { ConnectionContext } from './ConnectionContext';
import { ThemeProvider, useTheme } from './ThemeContext';
import { loadCanvasState, saveCanvasState, clearCanvasState, createDebouncedSave } from './utils/canvasStorage';
import { NODE_TYPE_REGISTRY } from './domain/nodeTypes';
import { ActiveNodeContext } from './ActiveNodeContext';
import { createTask, getTaskStatus } from './services/apiClient';
import { findProviderForModel } from './utils/modelUtils';
import { getNodeSize } from './utils/nodeSize';

const initialNodes = [];
const initialEdges = [];

function getInitialState() {
  try {
    const saved = loadCanvasState();
    if (saved && Array.isArray(saved.nodes) && saved.nodes.length > 0) {
      return {
        nodes: saved.nodes,
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
    default: return isDark ? 'rgba(94, 234, 212, 0.70)' : 'rgba(15, 159, 143, 0.70)';
  }
}

function AppContent() {
  const reactFlowWrapper = useRef(null);
  const addButtonRef = useRef(null);
  const mediaFileInputRef = useRef(null);
  const pendingMediaNodeIdRef = useRef(null);
  const initialState = useMemo(() => getInitialState(), []);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialState.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialState.edges);
  const [reactFlowInstance, setReactFlowInstance] = useState(null);
  const { isDark, toggleTheme } = useTheme();
  const [activeNodeId, setActiveNodeId] = useState(null);
  const [nodeIdCounter, setNodeIdCounter] = useState(initialState.counter);
  const debouncedSave = useRef(createDebouncedSave(400)).current;
  const [menuState, setMenuState] = useState({
    visible: false,
    position: { x: 0, y: 0 },
    source: null,
  });
  const [isConnecting, setIsConnecting] = useState(false);
  const [isApiSettingsOpen, setIsApiSettingsOpen] = useState(false);
  const [apiProviders, setApiProviders] = useState([]);
  const [nodeStates, setNodeStates] = useState({});
  const clipboardRef = useRef(null);
  const connectionSourceRef = useRef(null);
  const pendingConnectionDropRef = useRef(false);
  const lastClickRef = useRef({ time: 0, x: 0, y: 0 });
  const [nodeContextMenu, setNodeContextMenu] = useState({
    visible: false,
    position: { x: 0, y: 0 },
    nodeId: null,
  });
  const [showMinimap, setShowMinimap] = useState(false);
  const [statusLogOpen, setStatusLogOpen] = useState(false);
  const [statusLogEntries, setStatusLogEntries] = useState([]);

  const addLogEntry = useCallback((nodeId, status, message) => {
    const node = latestNodes.current.find(n => n.id === nodeId);
    const meta = NODE_TYPE_REGISTRY[node?.type || 'image'];
    const entry = {
      id: `${nodeId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      nodeId,
      nodeTitle: node?.data?.title || meta?.title || '',
      nodeType: node?.type || 'image',
      status,
      message: message || '',
      timestamp: new Date(),
    };
    setStatusLogEntries(prev => {
      const next = [...prev, entry];
      return next.length > 200 ? next.slice(-200) : next;
    });
  }, []);

  const handleLogEntryClick = useCallback((nodeId) => {
    setActiveNodeId(nodeId);
    if (reactFlowInstance) {
      const node = nodes.find(n => n.id === nodeId);
      if (node) {
        reactFlowInstance.setCenter(node.position.x + 100, node.position.y + 100, { zoom: 1, duration: 300 });
      }
    }
  }, [nodes, reactFlowInstance, setActiveNodeId]);

  const handleApiUpdate = useCallback((providers) => {
    setApiProviders(providers);
  }, []);

  const handleOpenApiSettings = useCallback(() => {
    setIsApiSettingsOpen(true);
  }, []);

  const handleCloseApiSettings = useCallback(() => {
    setIsApiSettingsOpen(false);
  }, []);

  /* Stable refs so customNodeTypes useMemo can have empty deps */
  const latestNodes = useRef(nodes);
  latestNodes.current = nodes;
  const latestEdges = useRef(edges);
  latestEdges.current = edges;

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

  /* Keyboard shortcuts: Ctrl+Z / Ctrl+Y */
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
      if (!(e.ctrlKey || e.metaKey) && (e.key === 'Delete' || e.key === 'Backspace')) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        handleDeleteNode();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo, handleDeleteNode]);

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

  /* Auto-save canvas state on changes */
  useEffect(() => {
    if (nodes.length === 0) return;
    debouncedSave({ nodes, edges, nodeIdCounter, nodeStates });
  }, [nodes, edges, nodeIdCounter, nodeStates, debouncedSave]);

  const handleNewCanvas = useCallback(() => {
    clearCanvasState();
    setNodes([]);
    setEdges([]);
    setNodeIdCounter(1);
    setNodeStates({});
    undoPastRef.current = [];
    undoFutureRef.current = [];
    setCanUndo(false);
    setCanRedo(false);
  }, [setNodes, setEdges]);

  const addNode = useCallback((type, position = null) => {
    const id = String(nodeIdCounter);
    let nodePosition = position && reactFlowInstance
      ? reactFlowInstance.screenToFlowPosition(position)
      : { x: 200 + Math.random() * 200, y: 100 + Math.random() * 200 };

    const title = type === 'image' ? '图片' : type === 'text' ? '文字' : type === 'video' ? '视频' : type === 'media' ? '上传文件' : '节点';
    const aspectRatio = '16:9';
    const { width, height } = getNodeSize(aspectRatio, type, {});

    const newNode = {
      id, type, position: nodePosition,
      width, height,
      data: {
        title,
        prompt: '',
        ...(type === 'media' ? {} : { aspectRatio, resolution: '1K', model: '' }),
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
  }, []);

  const handleAddNodeClick = useCallback(() => {
    const rect = addButtonRef.current.getBoundingClientRect();
    setMenuState({
      visible: true,
      position: { x: rect.right + 12, y: rect.top },
      source: 'button',
    });
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
    if (!files?.length) return;

    const file = files[0];
    if (file.size > 50 * 1024 * 1024) return;

    const position = reactFlowInstance
      ? reactFlowInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY })
      : null;
    const isVideo = file.type.startsWith('video/');
    const dropId = String(nodeIdCounter);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result;

      const addNode = (mw, mh) => {
        let w = 220, h = 220;
        if (mw && mh) {
          const ratio = mw / mh;
          const baseSize = 210;
          w = Math.round(baseSize * (ratio >= 1 ? ratio : 1));
          h = Math.round(baseSize * (ratio >= 1 ? 1 : 1 / ratio));
        }
        const newNode = {
          id: dropId,
          type: 'media',
          width: w,
          height: h,
          position: position || { x: 200 + Math.random() * 200, y: 100 + Math.random() * 200 },
          data: {
            title: file.name,
            prompt: '',
            result: {
              type: isVideo ? 'video' : 'image',
              url: content,
            },
          },
        };
        setNodes(nodes => [...nodes, newNode]);
      };

      if (isVideo) {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.onloadedmetadata = () => {
          addNode(video.videoWidth, video.videoHeight);
        };
        video.onerror = () => addNode(null, null);
        video.src = content;
      } else {
        const img = new Image();
        img.onload = () => {
          addNode(img.naturalWidth, img.naturalHeight);
        };
        img.onerror = () => addNode(null, null);
        img.src = content;
      }
    };

    reader.readAsDataURL(file);
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
        data: { sourceType },
        markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor, width: 10, height: 10 },
        style: { stroke: edgeColor, strokeWidth: 1.5 },
      }, eds));
      connectionSourceRef.current = null;
    }
  }, [addNode, nodes, setEdges, isDark, menuState.source]);

  const handleAddFromEmpty = useCallback((type) => {
    addNode(type);
  }, [addNode]);

  const handleNodeClick = useCallback((event, nodeId) => {
    event.stopPropagation();
    const node = nodes.find(n => n.id === nodeId);
    if (node?.type === 'media') {
      if (node.data?.result) return;
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
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result;

      const updateNode = (mw, mh) => {
        setNodes(nds => nds.map(n =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, title: file.name, prompt: '', mediaWidth: mw, mediaHeight: mh, result: { type: isVideo ? 'video' : 'image', url: content } } }
            : n
        ));
        pendingMediaNodeIdRef.current = null;
      };

      if (isVideo) {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.onloadedmetadata = () => {
          updateNode(video.videoWidth, video.videoHeight);
        };
        video.onerror = () => updateNode(null, null);
        video.src = content;
      } else {
        const img = new Image();
        img.onload = () => {
          updateNode(img.naturalWidth, img.naturalHeight);
        };
        img.onerror = () => updateNode(null, null);
        img.src = content;
      }
    };
    reader.readAsDataURL(file);
    // Reset input so same file can be picked again
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

    addLogEntry(nodeId, 'processing', prompt.substring(0, 80));

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
      const { task_id } = await createTask({
        type: nodeType,
        prompt,
        model,
        provider_id: providerId,
        aspect_ratio: aspectRatio,
        resolution,
        duration,
        fps,
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
            addLogEntry(nodeId, 'succeeded', '');
            if (task.result) {
              setNodes(nodes =>
                nodes.map(node => {
                  if (node.id === nodeId) {
                    return { ...node, data: { ...node.data, result: task.result } };
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
            addLogEntry(nodeId, 'failed', task.error || '生成失败');
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
      addLogEntry(nodeId, 'failed', error.message || '创建任务失败');
      setTimeout(() => {
        setNodeStates(prev => ({
          ...prev,
          [nodeId]: { processing: false, progress: 0, error: null }
        }));
      }, 5000);
    }
  }, [setNodes, setNodeStates, apiProviders, addLogEntry]);

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
          const sourceContent = sourceNode.data.result?.content || sourceNode.data.prompt;
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


  const customNodeTypes = useMemo(() => ({
    image: (props) => <ImageNode {...props} />,
    text: (props) => <TextNode {...props} />,
    video: (props) => <VideoNode {...props} />,
    media: (props) => <MediaNode {...props} />,
  }), []);

  const contextValue = useMemo(() => ({ isConnecting }), [isConnecting]);

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
      <ActiveNodeContext.Provider value={{ activeNodeId, handleNodeClick, handleSubmit, handleNodeTypeChange, handleUpdateResult, handleRenameNode, handleUpdateNodeData, handleOpenApiSettings, handleNodeContextMenu, apiProviders, nodeStates, nodes: latestNodes.current, edges: latestEdges.current }}>
      <div ref={reactFlowWrapper} style={{ width: '100%', height: '100%' }}
            onDragOver={handleDragOver}
            onDrop={handleFileDrop}>
        <Sidebar
          onAddNodeClick={handleAddNodeClick}
          addButtonRef={addButtonRef}
          toggleTheme={toggleTheme}
          currentTheme={isDark ? 'dark' : 'light'}
          onNewCanvas={handleNewCanvas}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onOpenApiSettings={handleOpenApiSettings}
          showMinimap={showMinimap}
          onToggleMinimap={() => setShowMinimap(v => !v)}
          statusLogOpen={statusLogOpen}
          onToggleStatusLog={() => setStatusLogOpen(v => !v)}
          statusLogHasEntries={statusLogEntries.length > 0}
        />
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          onInit={setReactFlowInstance}
          onEdgeClick={onEdgeClick}
          nodeTypes={customNodeTypes}
          fitView
          minZoom={0.15}
          maxZoom={2.5}
          connectionLineStyle={{
            stroke: 'var(--accent)',
            strokeWidth: 1.5,
            strokeDasharray: '4 4',
          }}
          panOnScroll={false}
          zoomOnScroll={false}
          zoomOnPinch
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
            // Double-click detection via timing
            const now = Date.now();
            const last = lastClickRef.current;
            if (now - last.time < 350 && Math.abs(e.clientX - last.x) < 20 && Math.abs(e.clientY - last.y) < 20) {
              if (!e.target?.closest?.('.react-flow__node')) {
                setMenuState({
                  visible: true,
                  position: { x: e.clientX, y: e.clientY },
                  source: 'doubleclick',
                });
              }
              lastClickRef.current = { time: 0, x: 0, y: 0 };
            } else {
              lastClickRef.current = { time: now, x: e.clientX, y: e.clientY };
            }
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
        </ReactFlow>
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
            triggerButtonRef={menuState.source === "button" ? addButtonRef : null}
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
        {isApiSettingsOpen && (
          <ApiSettings onClose={handleCloseApiSettings} onUpdate={handleApiUpdate} />
        )}
        <input ref={mediaFileInputRef} type="file" accept="image/*,video/*" onChange={handleMediaFileChange} style={{ display: 'none' }} />
        <StatusLog
          entries={statusLogEntries}
          isOpen={statusLogOpen}
          onToggle={() => setStatusLogOpen(v => !v)}
          onEntryClick={handleLogEntryClick}
        />
    </div>
    </ActiveNodeContext.Provider>
    </ConnectionContext.Provider>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}
