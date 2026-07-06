import { useState, useRef, useContext, useEffect } from 'react';
import { Handle, Position, useHandleConnections } from '@xyflow/react';
import { ConnectionContext } from '../ConnectionContext';
import { useActiveNode } from '../ActiveNodeContext';
import { useTheme } from '../ThemeContext';
import { getNodeSize } from '../utils/nodeSize';
import NodeDrawer from './NodeDrawer';

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
};

function StyledHandle({ type, position, id, nodeId, isNodeHovered, isNodeActive, accent }) {
  const connections = useHandleConnections({ type, id, nodeId });
  const [isHovered, setIsHovered] = useState(false);
  const { isConnecting } = useContext(ConnectionContext);

  const connectionCount = connections.length;
  const hasConnection = connectionCount > 0;
  const shouldShowHandle = isNodeHovered || isNodeActive || hasConnection || isConnecting || isHovered;
  const { isDark: isDarkTheme } = useTheme();

  const bgColor = isHovered
    ? 'var(--text-primary)'
    : hasConnection
      ? 'var(--node-btn-bg)'
      : isDarkTheme ? 'rgba(255, 255, 255, 0.14)' : 'rgba(13, 20, 38, 0.08)';
  const textColor = isHovered ? 'var(--bg-primary)' : 'var(--node-text)';
  const borderColor = isHovered || hasConnection ? 'var(--node-border-hover)' : 'var(--node-border)';
  const shadow = isHovered
    ? '0 2px 8px rgba(0, 0, 0, 0.16)'
    : hasConnection
      ? '0 1px 4px rgba(0, 0, 0, 0.08)'
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

  return (
    <div style={{ position: 'absolute', ...(position === Position.Left ? { left: -16, top: '50%' } : position === Position.Right ? { right: -16, top: '50%' } : position === Position.Top ? { top: -16, left: '50%' } : { bottom: -16, left: '50%' }), transform: position === Position.Right ? 'translate(50%, -50%)' : position === Position.Bottom ? 'translate(-50%, 50%)' : 'translate(-50%, -50%)', zIndex: 1000, width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: shouldShowHandle ? 1 : 0, visibility: shouldShowHandle ? 'visible' : 'hidden', transition: shouldShowHandle ? 'opacity 0.2s var(--ease-out)' : 'opacity 0.3s var(--ease-out) 0.1s', pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: `translate(-50%, -50%) ${isHovered ? 'scale(1.22)' : 'scale(1)'}`, width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: bgColor, border: `2px solid ${borderColor}`, color: textColor, transition: 'all 0.2s var(--ease-out)', pointerEvents: 'none', boxShadow: shadow, userSelect: 'none', zIndex: 5 }}>
        {!hasConnection ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: 'none' }}>
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        ) : (
          <span style={{ fontSize: 13, fontWeight: 800, lineHeight: 1, pointerEvents: 'none' }}>{displayText}</span>
        )}
      </div>

      <Handle type={type} position={position} id={id} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} style={{ width: 44, height: 44, background: 'transparent', border: 'none', borderRadius: '50%', zIndex: 10 }} />
    </div>
  );
}

function BaseNode({ id, type, data, selected }) {
  const { activeNodeId, handleNodeClick, handleSubmit, handleNodeTypeChange, handleUpdateResult, handleRenameNode, apiProviders, nodeStates, nodes, edges } = useActiveNode();
  const isActive = activeNodeId === id;
  const nodeState = nodeStates[id];
  const [isHovered, setIsHovered] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingText, setEditingText] = useState('');
  const [isEntering, setIsEntering] = useState(true);
  const nodeRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => setIsEntering(false), 500);
    return () => clearTimeout(t);
  }, []);

  const registry = NODE_TYPE_REGISTRY[type] || NODE_TYPE_REGISTRY.image;
  const config = { ...NODE_CONFIGS[type], ...registry };
  const accent = registry;
  const { width, height } = getNodeSize(data.aspectRatio || '16:9', type);
  const { isDark: isDarkTheme } = useTheme();

  const connectedSourceNodes = edges
    .filter((e) => e.target === id)
    .map((e) => nodes.find((n) => n.id === e.source))
    .filter(Boolean);

  const hasConnectedData = connectedSourceNodes.some((n) => n.data.prompt || n.data.result);
  const isProcessing = nodeState?.processing || false;
  const progress = nodeState?.progress || 0;
  const error = nodeState?.error || null;
  const hasResult = Boolean(data.result);
  const hasPrompt = Boolean(data.prompt);
  const isLit = selected || isActive || isHovered;

  const cardBorder = error
    ? '1px solid rgba(var(--signal-error-rgb), 0.55)'
    : isLit
      ? '1px solid var(--node-border-hover)'
      : '1px solid var(--node-border)';

  const cardShadow = error
    ? '0 0 0 1px rgba(var(--signal-error-rgb), 0.18), 0 8px 24px rgba(var(--signal-error-rgb), 0.08)'
    : isLit
      ? '0 4px 18px rgba(0, 0, 0, 0.18)'
      : '0 2px 12px rgba(0, 0, 0, 0.08)';

  return (
    <div ref={nodeRef} style={{ position: 'relative', width: 'fit-content', height: 'fit-content' }}>
      <div
        className="node-card"
        onClick={(e) => handleNodeClick(e, id)}
        style={{
          position: 'relative',
          width,
          height,
          background: 'var(--node-bg)',
          border: cardBorder,
          borderRadius: 16,
          animation: isEntering ? 'nodeEnter 0.35s var(--ease-out)' : 'none',
          transition: 'border-color 0.22s var(--ease-out), box-shadow 0.22s var(--ease-out)',
          cursor: 'pointer',
          overflow: 'hidden',
          boxShadow: cardShadow,
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {isProcessing && (
          <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: `${Math.max(6, progress)}%`,
            background: `linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.14))`,
            transition: 'height 0.6s var(--ease-out)',
            overflow: 'hidden',
            zIndex: 1
          }}>
            <div style={{
              position: 'absolute',
              inset: 0,
              background: `radial-gradient(ellipse at 50% 0%, rgba(255, 255, 255, 0.18), transparent 62%)`,
              animation: 'breathe 2s ease-in-out infinite'
            }} />
          </div>
        )}

        {isProcessing && (
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            zIndex: 10
          }}>
            <div style={{
              fontSize: 26,
              fontWeight: 700,
              color: 'var(--node-text)',
              letterSpacing: '-0.08em',
              textShadow: isDarkTheme ? '0 8px 24px rgba(0,0,0,0.55)' : '0 6px 18px rgba(13,20,38,0.24)',
              animation: 'pulse 1.5s ease-in-out infinite'
            }}>
              {Math.round(progress)}%
            </div>
            <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.18em', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Rendering
            </div>
          </div>
        )}

        {error && !isProcessing && (
          <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: '10px 12px',
            background: 'rgba(var(--signal-error-rgb), 0.94)',
            color: '#ffffff',
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

        <div style={{ position: 'absolute', top: 12, left: 14, right: 12, display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between', zIndex: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ display: 'inline-flex', width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 8, color: 'var(--text-secondary)', background: 'var(--node-icon-secondary)' }}>
              {config.smallIcon}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--node-text)', letterSpacing: 0.1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {data.title || config.title}
              </div>
              <div style={{ fontSize: 8, fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.12em' }}>
                {accent.labelEyebrow}
              </div>
            </div>
          </div>

          {hasConnectedData && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: 'rgba(var(--signal-live-rgb), 0.12)',
              padding: '4px 7px',
              borderRadius: 999,
              border: '1px solid rgba(var(--signal-live-rgb), 0.24)',
              color: 'var(--signal-live)',
              flexShrink: 0,
            }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span style={{ fontSize: 8, fontWeight: 600, letterSpacing: '0.04em' }}>
                LINK
              </span>
            </div>
          )}
        </div>

        {!isProcessing && (
          <div style={{ position: 'absolute', top: type === 'media' ? 0 : 48, left: type === 'media' ? 0 : 18, right: type === 'media' ? 0 : 18, bottom: error ? 38 : (type === 'media' ? 0 : 16), display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'center', zIndex: type === 'media' ? 0 : 5 }}>
            {data.result ? (
              data.result.type === 'image' ? (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: type === 'media' ? 0 : 12, overflow: 'hidden', background: 'rgba(0,0,0,0.18)' }}>
                  <img
                    src={data.result.url}
                    alt={data.title || 'media'}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: type === 'media' ? 'cover' : 'contain'
                    }}
                  />
                </div>
              ) : data.result.type === 'video' ? (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: type === 'media' ? 0 : 12, overflow: 'hidden', background: 'rgba(0,0,0,0.18)' }}>
                  <video
                    src={data.result.url}
                    controls={type !== 'media'}
                    autoPlay={type === 'media'}
                    loop={type === 'media'}
                    muted={type === 'media'}
                    playsInline
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: type === 'media' ? 'cover' : 'contain'
                    }}
                  />
                </div>
              ) : type === 'text' ? (
                isEditing ? (
                  <textarea
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    onBlur={(e) => {
                      setIsEditing(false);
                      handleUpdateResult(id, e.target.value);
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
                      wordBreak: 'break-word',
                      whiteSpace: 'pre-wrap',
                      fontFamily: 'inherit',
                      padding: 10,
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
                      cursor: 'text',
                      userSelect: 'text',
                      padding: 10,
                      borderRadius: 12,
                      background: 'var(--node-surface)',
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingText(data.result.content);
                      setIsEditing(true);
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
                  padding: 12,
                  borderRadius: 12,
                  background: 'var(--node-surface)',
                }}>
                  {data.result.content}
                </div>
              )
            ) : data.prompt ? (
              <div style={{
                fontSize: type === 'text' ? 12 : 11,
                color: 'var(--node-text)',
                opacity: 0.74,
                textAlign: type === 'text' ? 'left' : 'center',
                lineHeight: type === 'text' ? 1.55 : 1.45,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: '-webkit-box',
                WebkitLineClamp: type === 'text' ? 8 : 4,
                WebkitBoxOrient: 'vertical',
                wordBreak: 'break-word',
                whiteSpace: 'pre-wrap',
                padding: 12,
                borderRadius: 12,
                background: 'var(--node-surface)',
                border: '1px solid var(--node-border)',
              }}>
                {data.prompt}
              </div>
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
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {type !== 'media' && <StyledHandle type="target" position={Position.Left} id="target" nodeId={id} isNodeHovered={isHovered} isNodeActive={isActive} accent={accent} />}
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
