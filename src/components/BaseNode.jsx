import { useState, useRef, useContext, useEffect, useCallback } from 'react';
import { Handle, Position, useHandleConnections } from '@xyflow/react';
import { ConnectionContext } from '../ConnectionContext';
import { useActiveNode } from '../ActiveNodeContext';
import { useTheme } from '../ThemeContext';
import { getNodeSize } from '../utils/nodeSize';
import NodeDrawer from './NodeDrawer';
import ResizeHandle from './ResizeHandle';
import { ASPECT_RATIOS } from '../utils/dimensions';

import { NODE_TYPE_REGISTRY } from '../domain/nodeTypes';

const NODE_CONFIGS = {
  image: {
    icon: (
      <svg width="56" height="56" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 48L18 32L28 40L42 18L56 48H8Z" />
        <circle cx="48" cy="16" r="8" />
      </svg>
    ),
    placeholder: '描述你想生成的画面...',
    emptyHint: '添加画面提示词',
    drawerTitle: '图片节点',
  },
  text: {
    icon: (
      <svg width="56" height="56" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 12H44V18H34V52H30V18H20V12Z" />
      </svg>
    ),
    placeholder: '输入文本内容...',
    emptyHint: '写下文字或脚本',
    drawerTitle: '文字节点',
  },
  video: {
    icon: (
      <svg width="56" height="56" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="8" y="12" width="48" height="40" rx="6" />
        <polygon points="24 24 40 32 24 40 24 24" />
      </svg>
    ),
    placeholder: '描述视频内容...',
    emptyHint: '规划一段镜头运动',
    drawerTitle: '视频节点',
  },
  'source-text': {
    icon: (
      <svg width="56" height="56" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 8H50V16H38V52H26V16H14V8Z" />
      </svg>
    ),
    emptyHint: '双击输入文本',
    drawerTitle: '文本素材',
  },
  'source-image': {
    icon: (
      <svg width="56" height="56" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="10" y="12" width="44" height="40" rx="4" />
        <circle cx="26" cy="24" r="4" />
        <polyline points="54 38 40 26 12 52" />
      </svg>
    ),
    emptyHint: '上传图片文件',
    drawerTitle: '图像素材',
  },
  'source-video': {
    icon: (
      <svg width="56" height="56" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="8" y="16" width="48" height="32" rx="4" />
        <polygon points="26 24 42 32 26 40 26 24" />
      </svg>
    ),
    emptyHint: '上传视频文件',
    drawerTitle: '视频素材',
  },
  'source-audio': {
    icon: (
      <svg width="56" height="56" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 46V14l32-4v28" />
        <circle cx="16" cy="46" r="6" />
        <circle cx="48" cy="42" r="6" />
      </svg>
    ),
    emptyHint: '上传音频文件',
    drawerTitle: '音频素材',
  },
  'source-markdown': {
    icon: (
      <svg width="56" height="56" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="8" y="8" width="48" height="48" rx="4" />
        <line x1="24" y1="28" x2="20" y2="28" />
        <line x1="44" y1="28" x2="40" y2="28" />
        <line x1="32" y1="20" x2="32" y2="36" />
        <line x1="24" y1="36" x2="40" y2="36" />
      </svg>
    ),
    emptyHint: '双击输入 Markdown',
    drawerTitle: 'Markdown 素材',
  },
};

function StyledHandle({ type, position, id, nodeId, isNodeHovered, isNodeActive, accent }) {
  const connections = useHandleConnections({ type, id, nodeId });
  const [isHovered, setIsHovered] = useState(false);
  const { isConnecting } = useContext(ConnectionContext);

  const connectionCount = connections.length;
  const hasConnection = connectionCount > 0;
  const shouldShowHandle = isNodeHovered || isNodeActive || hasConnection || isConnecting || isHovered;
  const { isDark: isDarkTheme } = useTheme();

  const accentRgb = 'var(--text-primary-rgb)';
  const labelEyebrow = accent?.labelEyebrow || 'DATA';
  const hoverLabel = type === 'source' ? `${labelEyebrow} data` : 'Connect input';
  const isSource = type === 'source';
  const handleOffset = 16; // distance from node edge to visual center (outside)
  const circleSize = 28;
  const hitAreaSize = 36;

  const bgColor = isHovered
    ? `rgba(${accentRgb}, 1)`
    : hasConnection
      ? `rgba(${accentRgb}, 0.85)`
      : isDarkTheme ? 'rgba(255, 255, 255, 0.14)' : 'rgba(13, 20, 38, 0.08)';
  const textColor = isHovered ? 'var(--text-primary)' : `rgba(${accentRgb}, 1)`;
  const borderColor = isHovered || hasConnection ? `rgba(${accentRgb}, 0.6)` : 'var(--node-border)';
  const shadow = isHovered
    ? `0 0 12px rgba(${accentRgb}, 0.4)`
    : hasConnection
      ? `0 0 6px rgba(${accentRgb}, 0.25)`
      : 'none';
  const displayText = connectionCount > 2 ? '2+' : connectionCount;

  const handleMouseEnter = (e) => {
    e.stopPropagation();
    setIsHovered(true);
  };

  const handleMouseLeave = (e) => {
    e.stopPropagation();
    setIsHovered(false);
  };

  const isLeftRight = position === Position.Left || position === Position.Right;

  // Position helpers — visual and hit area both centered at handleOffset from node edge
  const getCirclePos = () => {
    const off = handleOffset + circleSize / 2;
    switch (position) {
      case Position.Left: return { left: -off, top: '50%' };
      case Position.Right: return { right: -off, top: '50%' };
      case Position.Top: return { top: -off, left: '50%' };
      case Position.Bottom: return { bottom: -off, left: '50%' };
    }
  };

  const getHandlePos = () => {
    const off = handleOffset + hitAreaSize / 2;
    switch (position) {
      case Position.Left: return { left: -off, top: '50%' };
      case Position.Right: return { right: -off, top: '50%' };
      case Position.Top: return { top: -off, left: '50%' };
      case Position.Bottom: return { bottom: -off, left: '50%' };
    }
  };

  const visualTransform = isLeftRight
    ? `translateY(-50%) ${isHovered ? 'scale(1.22)' : 'scale(1)'}`
    : `translateX(-50%) ${isHovered ? 'scale(1.22)' : 'scale(1)'}`;

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1000, opacity: shouldShowHandle ? 1 : 0, visibility: shouldShowHandle ? 'visible' : 'hidden', transition: shouldShowHandle ? 'opacity 0.2s var(--ease-out)' : 'opacity 0.3s var(--ease-out) 0.1s' }}>
      {/* Visual handle circle — at original position (-16 from node edge) */}
      <div style={{
        position: 'absolute',
        ...getCirclePos(),
        transform: visualTransform,
        width: circleSize,
        height: circleSize,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: bgColor,
        border: `2px solid ${borderColor}`,
        color: textColor,
        boxShadow: shadow,
        transition: 'all 0.2s var(--ease-out)',
        pointerEvents: 'none',
        userSelect: 'none',
        zIndex: 5,
      }}>
        {!hasConnection ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: 'none' }}>
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        ) : (
          <span style={{ fontSize: 13, fontWeight: 800, lineHeight: 1, pointerEvents: 'none', color: textColor }}>{displayText}</span>
        )}
      </div>

      {/* Hover label — placed inside node edge to avoid blocking view */}
      {isHovered && (
        <div style={{
          position: 'absolute',
          ...(isSource ? { right: '4px' } : { left: '4px' }),
          top: '50%',
          transform: 'translateY(-50%)',
          padding: '3px 8px',
          borderRadius: 6,
          background: 'var(--panel-bg-strong)',
          border: '1px solid var(--panel-border)',
          fontSize: 9,
          fontWeight: 600,
          color: `rgba(${accentRgb}, 1)`,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          zIndex: 1001,
          userSelect: 'none',
        }}>
          {hoverLabel}
        </div>
      )}

      {/* Actual React Flow Handle — positioned at same center as the visual circle */}
      <Handle
        type={type}
        position={position}
        id={id}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={{
          ...getHandlePos(),
          transform: isLeftRight ? 'translateY(-50%)' : 'translateX(-50%)',
          width: hitAreaSize,
          height: hitAreaSize,
          background: 'transparent',
          border: 'none',
          borderRadius: '50%',
          zIndex: 10,
          pointerEvents: 'auto',
        }}
      />
    </div>
  );
}

function BaseNode({ id, type, data, selected }) {
  const { activeNodeId, handleNodeClick, handleSubmit, handleNodeTypeChange, handleUpdateResult, handleUpdateNodeData, handleRenameNode, handleNodeContextMenu, handleResizeNode, apiProviders, nodeStates, nodes, edges } = useActiveNode();
  const isActive = activeNodeId === id;
  const nodeState = nodeStates[id];
  const [isHovered, setIsHovered] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingText, setEditingText] = useState('');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editingTitle, setEditingTitle] = useState('');
  const [isEntering, setIsEntering] = useState(true);
  const nodeRef = useRef(null);
  const cardRef = useRef(null);

  useEffect(() => {
    const el = cardRef.current;
    if (!el || !isEditing) return;
    const handler = (e) => e.stopPropagation();
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [isEditing]);
  const textFileInputRef = useRef(null);

  const isTextSource = type === 'source-text' || type === 'source-markdown';

  const handleTextFileChange = useCallback((e) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result;
      if (content) {
        handleUpdateNodeData(id, {
          title: file.name,
          result: { type: 'text', content },
        });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [id, handleUpdateNodeData]);

  useEffect(() => {
    const t = setTimeout(() => setIsEntering(false), 500);
    return () => clearTimeout(t);
  }, []);

  const registry = NODE_TYPE_REGISTRY[type] || NODE_TYPE_REGISTRY.image;
  const config = { ...NODE_CONFIGS[type], ...registry };
  const accent = registry;
  const isSourceType = type.startsWith('source-');
  const defaultSize = getNodeSize(data.aspectRatio || '16:9', type);
  const nodeInStore = nodes.find(n => n.id === id);
  const width = nodeInStore?.width ?? defaultSize.width;
  const height = nodeInStore?.height ?? defaultSize.height;
  const arEntry = ASPECT_RATIOS.find(r => r.label === (data.aspectRatio || '16:9'));
  const aspectRatio = isSourceType && data.mediaAspectRatio
    ? data.mediaAspectRatio
    : (arEntry ? arEntry.ratio : 16 / 9);
  const { isDark: isDarkTheme } = useTheme();

  const connectedSourceNodes = edges
    .filter((e) => e.target === id)
    .map((e) => nodes.find((n) => n.id === e.source))
    .filter(Boolean);

  const hasConnectedData = connectedSourceNodes.some((n) => n.data.prompt || n.data.result || n.data?.images?.length > 0);
  const isProcessing = nodeState?.processing || false;
  const progress = nodeState?.progress || 0;
  const error = nodeState?.error || null;
  const hasResult = Boolean(data.result);
  const hasPrompt = Boolean(data.prompt);
  const isLit = selected || isActive || isHovered;
  const isDisabled = Boolean(data.disabled);

  const cardBorder = error
    ? '1px solid var(--text-primary)'
    : isDisabled
      ? '1px solid rgba(255, 255, 255, 0.06)'
      : isProcessing
        ? `1px solid rgba(${accentRgb}, 0.35)`
        : isLit
          ? '1px solid var(--node-border-hover)'
          : '1px solid var(--node-border)';

  const cardShadow = error
    ? '0 0 0 1px rgba(var(--text-primary-rgb), 0.18), 0 8px 24px rgba(0, 0, 0, 0.08)'
    : isProcessing
      ? `0 0 0 1px rgba(var(--text-primary-rgb), 0.08), 0 4px 18px rgba(0, 0, 0, 0.14)`
      : isLit
        ? '0 4px 18px rgba(0, 0, 0, 0.18)'
        : '0 2px 12px rgba(0, 0, 0, 0.08)';

  return (
    <div ref={nodeRef} style={{ position: 'relative', width: 'fit-content', height: 'fit-content', opacity: isDisabled ? 0.5 : 1, transition: 'opacity 0.25s var(--ease-out)' }}
      onContextMenu={(e) => {
        if (handleNodeContextMenu) {
          handleNodeContextMenu(e, id);
        }
      }}>
      <div
        ref={cardRef}
        className={`node-card node-type-${type}${selected ? ' selected' : ''}`}
        onClick={(e) => {
          if (!isDisabled) handleNodeClick(e, id);
        }}
        onDoubleClick={(e) => {
          if ((type === 'text' || isTextSource) && !isProcessing) {
            e.stopPropagation();
            setEditingText(data.result?.content || '');
            setIsEditing(true);
          }
        }}
        style={{
          position: 'relative',
          width,
          height,
          background: 'var(--node-bg)',
          border: cardBorder,
          borderStyle: accent?.borderStyle || 'solid',
          borderRadius: 16,
          animation: isEntering ? 'nodeEnter 0.35s var(--ease-out)' : 'none',
          transition: 'border-color 0.22s var(--ease-out), box-shadow 0.22s var(--ease-out)',
          cursor: isDisabled ? 'default' : 'pointer',
          overflow: 'hidden',
          boxShadow: cardShadow,
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {isProcessing && (
          <>
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: `${Math.max(2, progress)}%`,
              height: 3,
              background: `linear-gradient(90deg, rgba(var(--text-primary-rgb), 0.5), rgba(var(--text-primary-rgb), 1))`,
              borderRadius: '16px 0 0 0',
              transition: 'width 0.4s var(--ease-out)',
              zIndex: 10,
            }}>
              <div style={{
                position: 'absolute',
                right: -3,
                top: -2,
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: `rgba(var(--text-primary-rgb), 1)`,
                boxShadow: `0 0 8px rgba(var(--text-primary-rgb), 0.8)`,
              }} />
            </div>

            <div style={{
              position: 'absolute',
              top: 10,
              right: 14,
              fontSize: 20,
              fontWeight: 700,
              color: `rgba(var(--text-primary-rgb), 0.45)`,
              letterSpacing: '-0.06em',
              zIndex: 10,
            }}>
              {Math.round(progress)}%
            </div>
          </>
        )}

        {error && !isProcessing && (
          <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: '10px 12px',
            background: 'var(--text-primary)',
            color: 'var(--text-primary)',
            fontSize: 11,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            zIndex: 10,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {error}
            </span>
          </div>
        )}

        {(hasConnectedData || isDisabled) && (
          <div style={{ position: 'absolute', top: 8, right: 10, zIndex: 6, display: 'flex', gap: 4 }}>
            {hasConnectedData && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                background: 'var(--white-10)',
                padding: '4px 7px',
                borderRadius: 999,
                border: '1px solid var(--white-20)',
                color: 'var(--text-primary)',
              }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span style={{ fontSize: 8, fontWeight: 600, letterSpacing: '0.04em' }}>LINK</span>
              </div>
            )}
            {isDisabled && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                background: 'rgba(255, 255, 255, 0.06)',
                padding: '4px 7px',
                borderRadius: 999,
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: 'var(--text-tertiary)',
              }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <span style={{ fontSize: 8, fontWeight: 600, letterSpacing: '0.04em' }}>OFF</span>
              </div>
            )}
          </div>
        )}

        {hasResult && !isProcessing && !error && (
          <div style={{
            position: 'absolute',
            top: 8,
            right: 12,
            zIndex: 11,
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 6px var(--black-50)',
          }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        )}

        {isTextSource && !data.result && !isProcessing && (
          <>
            <input ref={textFileInputRef} type="file" accept=".txt,.md,text/*" onChange={handleTextFileChange} style={{ display: 'none' }} />
            <button
              onClick={(e) => {
                e.stopPropagation();
                textFileInputRef.current?.click();
              }}
              title="上传文件"
              onMouseEnter={(e) => {
                e.currentTarget.style.background = `rgba(var(--text-primary-rgb), 0.15)`;
                e.currentTarget.style.opacity = '1';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                e.currentTarget.style.opacity = '0.7';
              }}
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
                zIndex: 12,
                width: 24,
                height: 24,
                borderRadius: 6,
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(255,255,255,0.04)',
                color: `rgba(var(--text-primary-rgb), 0.75)`,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: 0.7,
                transition: 'all 0.18s var(--ease-out)',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </button>
          </>
        )}

        {!isProcessing && (
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: error ? 38 : 0, display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'center', zIndex: isSourceType ? 0 : 5 }}>
            {data.result ? (
              data.result.type === 'image' ? (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: isSourceType ? 0 : 12, overflow: 'hidden', background: 'repeating-conic-gradient(rgba(255,255,255,0.03) 0% 25%, transparent 0% 50%) 0px 0px / 16px 16px', transition: 'transform 0.3s var(--ease-out)', transform: isHovered ? 'scale(1.01)' : 'scale(1)' }}>
                  <img
                    src={data.result.url}
                    alt={data.title || 'media'}
                    loading="lazy"
                    onError={(e) => { e.target.style.opacity = '0.3'; }}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: isSourceType ? 'cover' : 'contain',
                      transition: 'opacity 0.3s var(--ease-out)',
                    }}
                  />
                </div>
              ) : data.result.type === 'video' ? (
                <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: isSourceType ? 0 : 12, overflow: 'hidden', background: 'rgba(0,0,0,0.18)' }}>
                  <video
                    src={data.result.url}
                    controls={!isSourceType}
                    autoPlay={isSourceType}
                    loop={isSourceType}
                    muted={isSourceType}
                    playsInline
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: isSourceType ? 'cover' : 'contain'
                    }}
                  />
                  {!isSourceType && (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', opacity: isHovered ? 1 : 0.6, transition: 'opacity 0.3s var(--ease-out)' }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="white"><polygon points="8,5 19,12 8,19" /></svg>
                      </div>
                    </div>
                  )}
                </div>
              ) : data.result.type === 'audio' ? (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: 'rgba(0,0,0,0.18)', padding: '0 16px' }}>
                  <audio
                    src={data.result.url}
                    controls
                    autoPlay={isSourceType}
                    loop={isSourceType}
                    playsInline
                    style={{ width: '100%', maxHeight: 36, opacity: 0.85 }}
                  />
                </div>
              ) : (type === 'text' || isTextSource) ? (
                isEditing ? (
                  <textarea
                    className="nodrag"
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    onWheel={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      setIsEditing(false);
                      if (data.result) {
                        handleUpdateResult(id, e.target.value);
                      } else if (e.target.value.trim()) {
                        handleUpdateNodeData(id, {
                          result: { type: 'text', content: e.target.value },
                        });
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setIsEditing(false);
                    }}
                    style={{
                      fontSize: 12,
                      color: 'var(--node-text)',
                      backgroundColor: 'rgba(255,255,255,0.04)',
                      border: '1px solid var(--node-border-hover)',
                      borderRadius: 10,
                      outline: 'none',
                      resize: 'none',
                      width: '100%',
                      height: '100%',
                      textAlign: 'left',
                      lineHeight: '1.55',
                      overflow: 'auto',
                      scrollbarWidth: 'none',
                      wordBreak: 'break-word',
                      whiteSpace: 'pre-wrap',
                      fontFamily: 'inherit',
                      padding: 0,
                    }}
                    autoFocus
                  />
                ) : (
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--node-text)',
                      opacity: 0.96,
                      textAlign: 'left',
                      lineHeight: 1.58,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: '-webkit-box',
                      WebkitLineClamp: 9,
                      WebkitBoxOrient: 'vertical',
                      wordBreak: 'break-word',
                      whiteSpace: 'pre-wrap',
                      padding: 0,
                    }}
                  >
                    {data.result.content}
                  </div>
                )
              ) : (
                <div style={{
                  fontSize: 12,
                  color: 'var(--node-text)',
                  opacity: 0.95,
                  textAlign: 'center',
                  lineHeight: 1.5,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: '-webkit-box',
                  WebkitLineClamp: 4,
                  WebkitBoxOrient: 'vertical',
                  wordBreak: 'break-word',
                  whiteSpace: 'pre-wrap',
                  padding: 0,
                }}>
                  {data.result.content}
                </div>
              )
            ) : isTextSource && isEditing ? (
              <textarea
                className="nodrag"
                value={editingText}
                onChange={(e) => setEditingText(e.target.value)}
                onWheel={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  setIsEditing(false);
                  if (e.target.value.trim()) {
                    handleUpdateNodeData(id, {
                      result: { type: 'text', content: e.target.value },
                    });
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setIsEditing(false);
                }}
                style={{
                  fontSize: 12,
                  color: 'var(--node-text)',
                  backgroundColor: 'rgba(255,255,255,0.04)',
                  border: '1px solid var(--node-border-hover)',
                  borderRadius: 10,
                  outline: 'none',
                  resize: 'none',
                  width: '100%',
                  height: '100%',
                  textAlign: 'left',
                  lineHeight: '1.55',
                  overflow: 'auto',
                  scrollbarWidth: 'none',
                  wordBreak: 'break-word',
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'inherit',
                  padding: '8px 10px',
                }}
                autoFocus
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: 'var(--text-tertiary)' }}>
                <div style={{ opacity: 0.55 }}>{config.icon}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center' }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.14em' }}>
                    READY
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--node-text-secondary)' }}>
                    {config.emptyHint}
                  </span>
                  {isTextSource && (
                    <span style={{ fontSize: 9, color: 'var(--text-tertiary)', opacity: 0.6, marginTop: 2 }}>
                      或点击右上角上传文件
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

          <ResizeHandle nodeId={id} type={type} width={width} height={height} aspectRatio={aspectRatio} defaultWidth={defaultSize.width} defaultHeight={defaultSize.height} onResize={handleResizeNode} isVisible={isLit} />
        </div>

      {/* Title capsule — outside the node card */}
      <div style={{
        position: 'absolute',
        top: -24,
        left: 10,
        zIndex: 5,
        maxWidth: width,
      }}>
        {isEditingTitle ? (
          <input
            value={editingTitle}
            onChange={(e) => setEditingTitle(e.target.value)}
            onBlur={() => {
              const trimmed = editingTitle.trim();
              if (trimmed && trimmed !== (data.title || config.title)) {
                handleRenameNode(id, trimmed);
              }
              setIsEditingTitle(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.currentTarget.blur(); }
              if (e.key === 'Escape') { setEditingTitle(data.title || config.title); setIsEditingTitle(false); }
            }}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            style={{
              background: `rgba(var(--text-primary-rgb), 0.08)`,
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 999,
              outline: 'none',
              padding: '2px 10px',
              fontSize: 11,
              fontWeight: 500,
              color: `rgba(var(--text-primary-rgb), 0.9)`,
              minWidth: 30,
              maxWidth: width - 20,
              fontFamily: 'inherit',
              backdropFilter: 'blur(6px)',
            }}
          />
        ) : (
          <span
            onClick={(e) => {
              e.stopPropagation();
              setEditingTitle(data.title || config.title);
              setIsEditingTitle(true);
            }}
            style={{
              display: 'inline-block',
              padding: '2px 10px',
              borderRadius: 999,
              background: `rgba(var(--text-primary-rgb), 0.08)`,
              border: '1px solid rgba(255,255,255,0.06)',
              fontSize: 11,
              fontWeight: 500,
              color: `rgba(var(--text-primary-rgb), 0.85)`,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              cursor: 'text',
              maxWidth: width - 20,
              transition: 'background 0.2s, border-color 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = `rgba(var(--text-primary-rgb), 0.12)`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = `rgba(var(--text-primary-rgb), 0.08)`;
            }}
          >
            {data.title || config.title}
          </span>
        )}
      </div>

      {!isSourceType && <StyledHandle type="target" position={Position.Left} id="target" nodeId={id} isNodeHovered={isHovered} isNodeActive={isActive} accent={accent} />}
      <StyledHandle type="source" position={Position.Right} id="source" nodeId={id} isNodeHovered={isHovered} isNodeActive={isActive} accent={accent} />

      {isActive && (
        <NodeDrawer
          node={{ id, type, data, connectedSourceNodes }}
          apiProviders={apiProviders}
          onClose={() => {}}
          onSubmit={handleSubmit}
          onNodeTypeChange={(newType) => handleNodeTypeChange(id, newType)}
        />
      )}
    </div>
  );
}

export default BaseNode;
