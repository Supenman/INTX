import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  ReactFlow,
  useNodesState,
  useEdgesState,
  addEdge,
  Controls,
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
      eds.map((edge) => ({
        ...edge,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isDark ? 'rgba(255, 255, 255, 0.35)' : 'rgba(0, 0, 0, 0.25)',
          width: 10,
          height: 10,
        },
        style: {
          stroke: isDark ? 'rgba(255, 255, 255, 0.18)' : 'rgba(0, 0, 0, 0.12)',
          strokeWidth: 1.5,
        },
      }))
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
  }, [nodeIdCounter, setNodes, reactFlowInstance]);

  const handleNodeTypeChange = useCallback((nodeId, newType) => {
    setNodes(nodes => nodes.map(node => {
      if (node.id === nodeId) {
        return {
          ...node,
          type: newType,
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
    const position = reactFlowInstance
      ? reactFlowInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY })
      : null;
    const isVideo = file.type.startsWith('video/');

    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result;
      const id = String(nodeIdCounter);

      const addNode = (mw, mh) => {
        const newNode = {
          id,
          type: 'media',
          position: position || { x: 200 + Math.random() * 200, y: 100 + Math.random() * 200 },
          data: {
            title: file.name,
            prompt: '',
            mediaWidth: mw,
            mediaHeight: mh,
            result: {
              type: isVideo ? 'video' : 'image',
              url: content,
            },
          },
        };
        setNodes(nodes => [...nodes, newNode]);
        setNodeIdCounter(c => c + 1);
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
  }, [reactFlowInstance, nodeIdCounter, setNodes, setNodeIdCounter]);

  const handleMenuSelect = useCallback((type, position) => {
    addNode(type, position);
  }, [addNode]);

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
          return { ...node, data: { ...node.data, ...newData } };
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
  }, [setNodes, setNodeStates, apiProviders]);

  const onConnectStart = useCallback(() => {
    setIsConnecting(true);
  }, []);

  const onConnectEnd = useCallback(() => {
    setIsConnecting(false);
  }, []);

  const handleDeleteEdge = useCallback(
    (edgeId) => {
      setEdges((eds) => eds.filter((e) => e.id !== edgeId));
    },
    [setEdges]
  );

  const onConnect = useCallback(
    (params) => {
      const newEdge = {
        ...params,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isDark ? 'rgba(255, 255, 255, 0.35)' : 'rgba(0, 0, 0, 0.25)',
          width: 10,
          height: 10,
        },
        style: {
          stroke: isDark ? 'rgba(255, 255, 255, 0.18)' : 'rgba(0, 0, 0, 0.12)',
          strokeWidth: 1.5,
        },
      };

      setNodes((nds) => {
        const sourceNode = nds.find((n) => n.id === params.source);
        if (sourceNode) {
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
      <ActiveNodeContext.Provider value={{ activeNodeId, handleNodeClick, handleSubmit, handleNodeTypeChange, handleUpdateResult, handleRenameNode, handleUpdateNodeData, handleOpenApiSettings, apiProviders, nodeStates, nodes: latestNodes.current, edges: latestEdges.current }}>
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
          connectionLineStyle={{
            stroke: 'var(--accent)',
            strokeWidth: 1.5,
            strokeDasharray: '4 4',
          }}
          panOnScroll={false}
          zoomOnScroll={false}
          zoomOnPinch
          onPaneClick={() => {
            handleCloseDrawer();
            if (menuState.visible) {
              handleCloseMenu();
            }
          }}
          onPaneContextMenu={handlePaneContextMenu}
        >
          <GridBackground />
          <Controls position="bottom-right" showInteractive={false} />
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
        {isApiSettingsOpen && (
          <ApiSettings onClose={handleCloseApiSettings} onUpdate={handleApiUpdate} />
        )}
        <input ref={mediaFileInputRef} type="file" accept="image/*,video/*" onChange={handleMediaFileChange} style={{ display: 'none' }} />
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
