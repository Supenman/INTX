import { useState, useEffect, useRef, useCallback } from 'react';
import { NODE_TYPE_REGISTRY } from '../domain/nodeTypes';
import { getAvailableModels } from '../utils/modelUtils';
import { ASPECT_RATIOS, RESOLUTIONS } from '../utils/dimensions';
import { useActiveNode } from '../ActiveNodeContext';
import CanvasDropdown from './primitives/CanvasDropdown';

const triggerBtnBase = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  padding: '2px 4px',
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: 4,
  fontSize: 9,
  color: 'var(--text-tertiary)',
  cursor: 'pointer',
  transition: 'all 0.15s ease',
  fontWeight: 500,
  whiteSpace: 'nowrap',
};

function NodeDrawer({ node, apiProviders, onSubmit, onNodeTypeChange }) {
  const [prompt, setPrompt] = useState(node?.data?.prompt || '');
  const [duration, setDuration] = useState(node?.data?.duration || '5');
  const [fps, setFps] = useState(node?.data?.fps || '30');
  const [aspectRatio, setAspectRatio] = useState(node?.data?.aspectRatio || '16:9');
  const [resolution, setResolution] = useState(node?.data?.resolution || '1K');
  const [model, setModel] = useState(node?.data?.model || '');
  const [showConnectedDataMenu, setShowConnectedDataMenu] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [drawerDir, setDrawerDir] = useState('bottom');
  const drawerRef = useRef(null);

  const config = NODE_TYPE_REGISTRY[node.type] || NODE_TYPE_REGISTRY.image;
  const { handleOpenApiSettings, handleUpdateNodeData } = useActiveNode() || {};
  const connectedSourceNodes = node.connectedSourceNodes || [];
  const validSourceNodes = connectedSourceNodes.filter(sourceNode =>
    (sourceNode.data.result?.content || sourceNode.data.prompt || sourceNode.data?.images?.length > 0)
  );
  const hasConnectedData = validSourceNodes.length > 0;

  const [atReferenceState, setAtReferenceState] = useState({
    active: false,
    filter: '',
    position: null,
    startIndex: -1,
  });

  useEffect(() => {
    setPrompt(node?.data?.prompt || '');
    setDuration(node?.data?.duration || '5');
    setFps(node?.data?.fps || '30');
    setAspectRatio(node?.data?.aspectRatio || '16:9');
    setResolution(node?.data?.resolution || '1K');
    const availableModels = getAvailableModels(node?.type, apiProviders);
    setModel(node?.data?.model || availableModels?.[0] || '');
  }, [node?.id, node?.data?.prompt, node?.data?.duration, node?.data?.fps, node?.data?.aspectRatio, node?.data?.resolution, node?.data?.model, node?.type, apiProviders]);

  useEffect(() => {
    if (drawerRef.current) {
      const rect = drawerRef.current.getBoundingClientRect();
      if (rect.bottom > window.innerHeight - 16) {
        setDrawerDir('top');
      } else {
        setDrawerDir('bottom');
      }
    }
  }, [prompt, aspectRatio, model, resolution, duration, fps]);

  // Autosave prompt to node data with debounce
  useEffect(() => {
    if (!node?.id) return;
    const timer = setTimeout(() => {
      if (handleUpdateNodeData && prompt !== node?.data?.prompt) {
        handleUpdateNodeData(node.id, { prompt });
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [prompt, node?.id, node?.data?.prompt, handleUpdateNodeData]);

  const resolveReferences = (text, sourceNodes) => {
    return text.replace(/@\[([^\]]+)\]\(ref:([^)]+)\)/g, (match, title, refId) => {
      const sourceNode = sourceNodes.find(n => n.id === refId);
      if (sourceNode) {
        return sourceNode.data.result?.content || sourceNode.data.prompt || match;
      }
      return match;
    });
  };

  const handleSubmit = useCallback(() => {
    setIsSubmitting(true);
    const resolvedPrompt = resolveReferences(prompt, validSourceNodes);
    const submitData = {
      prompt: resolvedPrompt,
      aspectRatio,
      resolution,
      model,
      nodeType: node.type,
      ...(node.type === 'video' ? { duration, fps } : {}),
    };
    onSubmit(node.id, submitData);
    setTimeout(() => setIsSubmitting(false), 500);
  }, [prompt, aspectRatio, resolution, model, node, onSubmit, duration, fps, validSourceNodes]);

  const handleTypeChange = (newType) => {
    onNodeTypeChange && onNodeTypeChange(newType);
  };

  const handleAspectRatioChange = (newRatio) => {
    setAspectRatio(newRatio);
    const submitData = {
      prompt,
      aspectRatio: newRatio,
      resolution,
      model,
      ...(node.type === 'video' ? { duration, fps } : {}),
    };
    onSubmit(node.id, submitData);
  };

  const availableModels = getAvailableModels(node.type, apiProviders);

  const getCursorPosition = (textarea) => {
    const rect = textarea.getBoundingClientRect();
    const text = textarea.value.substring(0, textarea.selectionStart);
    const measure = document.createElement('span');
    measure.style.cssText = `font-size: 11px; font-family: inherit; letter-spacing: normal; white-space: pre-wrap; position: fixed; visibility: hidden; max-width: ${rect.width}px;`;
    measure.textContent = text;
    document.body.appendChild(measure);
    const pos = measure.getBoundingClientRect();
    document.body.removeChild(measure);
    return {
      x: Math.min(pos.left - rect.left, rect.width - 200),
      y: pos.bottom - rect.top + 2,
    };
  };

  const handlePromptChange = (e) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;

    setPrompt(value);

    if (!hasConnectedData) {
      setAtReferenceState({ active: false, filter: '', position: null, startIndex: -1 });
      return;
    }

    const textBeforeCursor = value.substring(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf('@');

    if (atIndex !== -1) {
      const afterAt = textBeforeCursor.substring(atIndex + 1);
      const isWordChar = (ch) => /[\w一-鿿]/.test(ch);
      // Only trigger if @ is at word boundary (preceded by space or start) and only word chars after
      const charBeforeAt = atIndex > 0 ? value[atIndex - 1] : ' ';
      if ((charBeforeAt === ' ' || charBeforeAt === '\n' || atIndex === 0) && afterAt.length >= 0 && !afterAt.includes(' ')) {
        setAtReferenceState({
          active: true,
          filter: afterAt,
          position: getCursorPosition(e.target),
          startIndex: atIndex,
        });
        return;
      }
    }

    setAtReferenceState({ active: false, filter: '', position: null, startIndex: -1 });
  };

  const insertReference = (sourceNode) => {
    const before = prompt.substring(0, atReferenceState.startIndex);
    const after = prompt.substring(atReferenceState.startIndex + atReferenceState.filter.length + 1);
    const referenceTag = `@[${sourceNode.data.title || 'Untitled'}](ref:${sourceNode.id})`;
    setPrompt(before + referenceTag + after);
    setAtReferenceState({ active: false, filter: '', position: null, startIndex: -1 });
  };

  const filteredAtNodes = atReferenceState.active
    ? validSourceNodes.filter(n =>
        (n.data.title || '').toLowerCase().includes(atReferenceState.filter.toLowerCase())
      )
    : [];

  // Split prompt for chip rendering
  const promptParts = prompt ? prompt.split(/(@\[[^\]]*\]\(ref:[^)]*\))/) : [];
  const promptHasRefs = promptParts.length > 1;

  return (
    <div
      ref={drawerRef}
      style={{
        position: 'absolute',
        left: 0,
        [drawerDir === 'bottom' ? 'top' : 'bottom']: 'calc(100% + 8px)',
        width: '100%',
        minWidth: 280,
        zIndex: 1000,
        animation: 'slideUp 0.2s var(--ease-out)',
        transformOrigin: drawerDir === 'bottom' ? 'top center' : 'bottom center',
      }}
    >
      <div
        className="node-drawer-panel"
        style={{
          background: 'var(--drawer-bg)',
          border: '1px solid var(--drawer-border)',
          borderRadius: 10,
          padding: '6px 8px',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
          backdropFilter: 'blur(20px)',
        }}
      >
        {hasConnectedData && (
          <div style={{ position: 'relative', marginBottom: 6 }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowConnectedDataMenu(!showConnectedDataMenu);
              }}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 6,
                padding: '5px 8px',
                background: 'transparent',
                border: '1px solid transparent',
                borderRadius: 5,
                fontSize: 10,
                color: 'var(--text-tertiary)',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                fontWeight: 500,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                <span>连接数据 ({validSourceNodes.length})</span>
              </div>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7, transform: showConnectedDataMenu ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>
            {showConnectedDataMenu && (
              <div style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                right: 0,
                marginBottom: 6,
                background: 'var(--drawer-bg)',
                border: '1px solid var(--drawer-border)',
                borderRadius: 8,
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.14)',
                maxHeight: 180,
                overflowY: 'auto',
                zIndex: 10001,
                animation: 'fadeIn 0.12s var(--ease-out)',
              }}>
                {validSourceNodes.map((sourceNode) => {
                  const sourceContent = sourceNode.data.result?.content || sourceNode.data.prompt;
                  const sourceImages = sourceNode.data?.images || [];
                  return (
                    <div
                      key={sourceNode.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (sourceContent) {
                          setPrompt(sourceContent);
                          setShowConnectedDataMenu(false);
                        }
                      }}
                      style={{
                        padding: '8px 10px',
                        fontSize: 10,
                        color: 'var(--drawer-text)',
                        background: 'transparent',
                        cursor: sourceContent ? 'pointer' : 'default',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 3,
                        transition: 'all 0.1s ease',
                        borderBottom: '1px solid var(--drawer-border)',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = sourceContent ? 'var(--accent-soft)' : 'transparent'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, opacity: 0.8, flexWrap: 'wrap' }}>
                        {(NODE_TYPE_REGISTRY[sourceNode.type] || NODE_TYPE_REGISTRY.image).smallIcon}
                        <span style={{ fontWeight: 600, fontSize: 9 }}>
                          {sourceNode.data.title || (NODE_TYPE_REGISTRY[sourceNode.type] || NODE_TYPE_REGISTRY.image).title}
                        </span>
                        {sourceNode.data.result && (
                          <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 3, background: 'var(--accent-soft)', color: 'var(--accent-strong)' }}>done</span>
                        )}
                      </div>
                      {sourceImages.length > 0 && (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                          {sourceImages.map((img, i) => (
                            img.type === 'video' ? (
                              <div key={i} style={{
                                width: 36, height: 36, borderRadius: 4, overflow: 'hidden',
                                background: 'var(--accent-soft)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 8, color: 'var(--accent-strong)',
                              }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                              </div>
                            ) : (
                              <div key={i} style={{ width: 36, height: 36, borderRadius: 4, overflow: 'hidden', background: 'var(--panel-bg)' }}>
                                <img src={img.url} alt={img.name || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                  onError={(e) => { e.target.style.display = 'none'; }} />
                              </div>
                            )
                          ))}
                        </div>
                      )}
                      {sourceContent && (
                        <div style={{ fontSize: 9, opacity: 0.6, lineHeight: 1.4, maxHeight: 48, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                          {sourceContent}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div style={{ position: 'relative' }}>
          <textarea
            value={prompt}
            onChange={handlePromptChange}
            placeholder={node.type === 'text' ? '输入文本内容...' : '描述你想生成的内容...'}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && atReferenceState.active) {
                setAtReferenceState({ active: false, filter: '', position: null, startIndex: -1 });
                return;
              }
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); handleSubmit(); }
            }}
            style={{
              width: '100%',
              minHeight: 38,
              maxHeight: 90,
              background: 'transparent',
              border: 'none',
              borderRadius: 0,
              padding: '6px 6px 4px',
              fontSize: 11,
              color: promptHasRefs ? 'transparent' : 'var(--drawer-text)',
              caretColor: 'var(--drawer-text)',
              resize: 'none',
              outline: 'none',
              lineHeight: 1.5,
              marginBottom: 0,
              fontFamily: 'inherit',
              position: 'relative',
              zIndex: 2,
            }}
          />

          {/* Mirror div for chip rendering */}
          {promptHasRefs && (
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              padding: '6px 6px 4px',
              fontSize: 11,
              lineHeight: 1.5,
              color: 'var(--drawer-text)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              pointerEvents: 'none',
              fontFamily: 'inherit',
              zIndex: 1,
            }}>
              {promptParts.map((segment, i) => {
                if (segment.startsWith('@[') && segment.includes('](ref:')) {
                  const title = segment.match(/@\[([^\]]*)\]/)?.[1] || '';
                  return (
                    <span key={i} style={{
                      background: 'rgba(var(--accent-rgb), 0.15)',
                      color: 'var(--accent-strong)',
                      borderRadius: 4,
                      padding: '1px 5px',
                      fontSize: 10,
                      fontWeight: 600,
                    }}>
                      @{title}
                    </span>
                  );
                }
                return <span key={i}>{segment}</span>;
              })}
            </div>
          )}

          {/* @-reference typeahead dropdown */}
          {atReferenceState.active && (
            <div style={{
              position: 'absolute',
              left: Math.max(0, Math.min(atReferenceState.position?.x || 0, 200)),
              top: (atReferenceState.position?.y || 30) + 4,
              minWidth: 200,
              maxWidth: 260,
              maxHeight: 150,
              overflowY: 'auto',
              background: 'var(--panel-bg-strong)',
              backdropFilter: 'var(--panel-blur)',
              border: '1px solid var(--sidebar-border)',
              borderRadius: 10,
              boxShadow: 'var(--panel-shadow)',
              zIndex: 10002,
              padding: 4,
              animation: 'fadeIn 0.1s var(--ease-out)',
            }}>
              {filteredAtNodes.length === 0 ? (
                <div style={{
                  padding: '8px 10px',
                  fontSize: 10,
                  color: 'var(--text-tertiary)',
                  textAlign: 'center',
                }}>
                  {validSourceNodes.length === 0 ? '无可用连接数据' : '没有匹配的连接数据'}
                </div>
              ) : (
                filteredAtNodes.map((sourceNode) => {
                  const sourceMeta = NODE_TYPE_REGISTRY[sourceNode.type] || NODE_TYPE_REGISTRY.image;
                  return (
                    <div
                      key={sourceNode.id}
                      onClick={() => insertReference(sourceNode)}
                      style={{
                        padding: '6px 8px',
                        fontSize: 10,
                        cursor: 'pointer',
                        borderRadius: 6,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        color: 'var(--sidebar-text)',
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--sidebar-item-bg-hover)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      <span style={{ color: sourceMeta.accentVar, flexShrink: 0 }}>
                        {sourceMeta.smallIcon}
                      </span>
                      <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {sourceNode.data.title || sourceMeta.title}
                      </span>
                      <span style={{ marginLeft: 'auto', fontSize: 8, color: 'var(--text-tertiary)', flexShrink: 0 }}>
                        {sourceNode.data.result ? 'Done' : 'Prompt'}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {node.type === 'video' && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 4, borderTop: '1px solid var(--drawer-border)', paddingTop: 5, marginTop: 2 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 9, color: 'var(--drawer-text-secondary)', marginBottom: 3, fontWeight: 500 }}>时长 (s)</div>
              <input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} min="1" max="60"
                style={{ width: '100%', background: 'transparent', border: '1px solid var(--drawer-border)', borderRadius: 5, padding: '4px 7px', fontSize: 11, color: 'var(--drawer-text)', outline: 'none' }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 9, color: 'var(--drawer-text-secondary)', marginBottom: 3, fontWeight: 500 }}>帧率 (fps)</div>
              <input type="number" value={fps} onChange={(e) => setFps(e.target.value)} min="15" max="60"
                style={{ width: '100%', background: 'transparent', border: '1px solid var(--drawer-border)', borderRadius: 5, padding: '4px 7px', fontSize: 11, color: 'var(--drawer-text)', outline: 'none' }}
              />
            </div>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 2, borderTop: '1px solid var(--drawer-border)', paddingTop: 4, marginTop: 2, flexWrap: 'nowrap' }}>
          <CanvasDropdown
            value={node.type}
            onChange={handleTypeChange}
            options={[
              { value: 'image', label: '图片', icon: NODE_TYPE_REGISTRY.image.smallIcon },
              { value: 'text', label: '文字', icon: NODE_TYPE_REGISTRY.text.smallIcon },
              { value: 'video', label: '视频', icon: NODE_TYPE_REGISTRY.video.smallIcon },
            ]}
            trigger={<>{config.smallIcon}{config.title}</>}
            buttonStyle={triggerBtnBase}
            position="top"
          />

          {availableModels.length > 0 ? (
            <CanvasDropdown
              value={model}
              onChange={(m) => setModel(m)}
              options={availableModels.map((m) => ({ value: m, label: m }))}
              trigger={<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 38 }}>{model || '模型'}</span>}
              buttonStyle={{ ...triggerBtnBase, maxWidth: 58, minWidth: 0 }}
              position="top"
              placeholder="模型"
            />
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleOpenApiSettings && handleOpenApiSettings();
              }}
              style={{ ...triggerBtnBase, maxWidth: 58, minWidth: 0, gap: 3, color: 'var(--accent)' }}
              title="配置 API 平台"
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              <span style={{ fontSize: 8 }}>API</span>
            </button>
          )}

          {node.type !== 'text' && (
            <>
              <CanvasDropdown
                value={aspectRatio}
                onChange={handleAspectRatioChange}
                options={ASPECT_RATIOS.map((r) => ({ value: r.label, label: r.label }))}
                trigger={<span style={{ maxWidth: 24, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{aspectRatio}</span>}
                buttonStyle={{ ...triggerBtnBase, fontSize: 8 }}
                position="top"
              />

              <CanvasDropdown
                value={resolution}
                onChange={(r) => setResolution(r)}
                options={RESOLUTIONS.map((r) => ({ value: r.label, label: r.label }))}
                trigger={<span style={{ maxWidth: 18, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{resolution}</span>}
                buttonStyle={{ ...triggerBtnBase, fontSize: 8 }}
                position="top"
              />
            </>
          )}

          <div style={{ flex: 1 }} />

          <button
            onClick={(e) => { e.stopPropagation(); handleSubmit(); }}
            disabled={isSubmitting}
            className="drawer-run-btn"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 28, height: 28,
              background: 'transparent',
              border: 'none', borderRadius: 6,
              color: 'var(--text-tertiary)',
              cursor: isSubmitting ? 'wait' : 'pointer',
              transition: 'all 0.15s ease',
              opacity: isSubmitting ? 0.4 : 1,
              flexShrink: 0,
            }}
            onMouseEnter={(e) => { if (!isSubmitting) { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.background = 'var(--accent-soft)'; } }}
            onMouseLeave={(e) => { if (!isSubmitting) { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.background = 'transparent'; } }}
          >
            {isSubmitting ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 0.8s linear infinite' }}>
                <line x1="12" y1="2" x2="12" y2="6" />
                <line x1="12" y1="18" x2="12" y2="22" />
                <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
                <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
                <line x1="2" y1="12" x2="6" y2="12" />
                <line x1="18" y1="12" x2="22" y2="12" />
                <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
                <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default NodeDrawer;
