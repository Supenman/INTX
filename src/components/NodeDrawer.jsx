import { useState, useEffect, useRef, useCallback, cloneElement } from 'react';
import { NODE_TYPE_REGISTRY } from '../domain/nodeTypes';
import { getAvailableModels } from '../utils/modelUtils';
import { ASPECT_RATIOS, RESOLUTIONS } from '../utils/dimensions';
import { useActiveNode } from '../ActiveNodeContext';
import CanvasDropdown from './primitives/CanvasDropdown';

const triggerBtnBase = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  padding: '0 10px',
  height: 28,
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: 6,
  fontSize: 11,
  color: 'var(--text-primary)',
  cursor: 'pointer',
  transition: 'all 0.15s ease',
  fontWeight: 500,
  whiteSpace: 'nowrap',
};

// ── ContentEditable @-reference helpers ──────────────────────────────────

const ZWSP = '​';
const REF_SPLIT = /(@\[[^\]]*\]\(ref:[^)]+\))/;

function isChipEl(node) {
  return node?.nodeType === 1 && node.hasAttribute?.('data-ref-id');
}

function getNodeTypeById(nodes, id) {
  const n = nodes.find(n => n.id === id);
  return n ? n.type : 'image';
}

function buildChipEl(nodeId, label, nodeType, options) {
  const chip = document.createElement('span');
  chip.contentEditable = 'false';
  chip.className = 'nd-chip nd-chip-' + (nodeType || 'image');
  chip.setAttribute('data-ref-id', nodeId);
  chip.setAttribute('data-ref-label', label);
  if (options?.thumbUrl) {
    const img = document.createElement('img');
    img.className = 'nd-chip-thumb';
    img.src = options.thumbUrl;
    img.draggable = false;
    img.onerror = (e) => { e.target.style.display = 'none'; };
    chip.appendChild(img);
  } else {
    const icon = document.createElement('span');
    icon.className = 'nd-chip-icon';
    const map = { image: '🖼', text: '📝', video: '🎬', media: '📎', 'source-text': '📄', 'source-image': '🖼', 'source-video': '🎬', 'source-audio': '🎵', 'source-markdown': '📋' };
    icon.textContent = map[nodeType] || '🔗';
    chip.appendChild(icon);
  }
  chip.appendChild(document.createTextNode(label));
  return chip;
}

function serializeDOM(root) {
  const parts = [];
  const walk = (node) => {
    if (node.nodeType === 3) {
      parts.push(node.textContent);
    } else if (node.nodeType === 1) {
      if (node.tagName === 'BR') {
        parts.push('\n');
      } else if (node.hasAttribute('data-ref-id')) {
        const id = node.getAttribute('data-ref-id');
        const label = node.getAttribute('data-ref-label') || 'Untitled';
        parts.push('@[' + label + '](ref:' + id + ')');
      } else {
        node.childNodes.forEach(walk);
      }
    }
  };
  root.childNodes.forEach(walk);
  return parts.join('').split(ZWSP).join('').replace(/\n+$/, '');
}

function ensureCaretSlotBeforeChip(chip) {
  if (!chip.previousSibling || chip.previousSibling.nodeName === 'BR') {
    chip.parentNode.insertBefore(document.createTextNode(ZWSP), chip);
  }
}

function normalizeChipSlots(root) {
  root.querySelectorAll('[data-ref-id]').forEach(chip => {
    const prev = chip.previousSibling;
    if (!prev || prev.nodeName === 'BR') {
      chip.parentNode.insertBefore(document.createTextNode(ZWSP), chip);
    }
  });
}

function insertChipAtEditor(editorEl, nodeId, label, nodeType, thumbUrl) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  let range = sel.getRangeAt(0);
  if (!editorEl.contains(range.commonAncestorContainer)) {
    range = document.createRange();
    range.selectNodeContents(editorEl);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  const chip = buildChipEl(nodeId, label, nodeType, { thumbUrl });
  range.deleteContents();
  range.insertNode(chip);
  ensureCaretSlotBeforeChip(chip);
  range.setStartAfter(chip);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  editorEl.dispatchEvent(new Event('input', { bubbles: true }));
}

function deleteAdjacentChip(root, direction) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return false;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) return false;
  if (direction === 'backspace' && range.startContainer.nodeType === 3 && range.startOffset === 0) {
    const prev = range.startContainer.previousSibling;
    if (isChipEl(prev)) { prev.remove(); return true; }
  }
  if (direction === 'delete' && range.startContainer.nodeType === 3 && range.startOffset === range.startContainer.textContent.length) {
    const next = range.startContainer.nextSibling;
    if (isChipEl(next)) { next.remove(); return true; }
  }
  return false;
}

function isLastCharAt(root) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return false;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) return false;
  if (range.startOffset === 0) return false;
  const node = range.startContainer;
  if (node.nodeType !== 3) return false;
  return node.textContent[range.startOffset - 1] === '@';
}

function getPrevChar(root) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (range.startOffset < 2) return null;
  const node = range.startContainer;
  if (node.nodeType !== 3) return null;
  return node.textContent[range.startOffset - 2] || null;
}

function renderPromptToRoot(text, root, sourceNodes) {
  root.innerHTML = '';
  if (!text) {
    root.innerHTML = '<br>';
    return;
  }
  const segments = text.split(REF_SPLIT);
  for (const seg of segments) {
    if (seg.startsWith('@[') && seg.includes('](ref:')) {
      const m = seg.match(/@\[([^\]]*)\]\(ref:([^)]+)\)/);
      if (m) {
        const nodeType = getNodeTypeById(sourceNodes || [], m[2]);
        const srcNode = sourceNodes?.find(n => n.id === m[2]);
        const thumbUrl = srcNode?.data?.images?.[0]?.url;
        root.appendChild(buildChipEl(m[2], m[1], nodeType, { thumbUrl }));
        continue;
      }
    }
    const lines = seg.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) root.appendChild(document.createElement('br'));
      if (lines[i]) root.appendChild(document.createTextNode(lines[i]));
    }
  }
  normalizeChipSlots(root);
  if (!root.firstChild) root.innerHTML = '<br>';
}

// ── Component ────────────────────────────────────────────────────────────

function NodeDrawer({ node, apiProviders, onSubmit, onNodeTypeChange }) {
  const [prompt, setPrompt] = useState(node?.data?.prompt || '');
  const [duration, setDuration] = useState(node?.data?.duration || '5');
  const [fps, setFps] = useState(node?.data?.fps || '30');
  const [aspectRatio, setAspectRatio] = useState(node?.data?.aspectRatio || '16:9');
  const [resolution, setResolution] = useState(node?.data?.resolution || '1K');
  const [model, setModel] = useState(node?.data?.model || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [drawerDir, setDrawerDir] = useState('bottom');
  const [hoveredDockIdx, setHoveredDockIdx] = useState(null);
  const [chipTooltip, setChipTooltip] = useState(null);
  const [hoveredChipNodeId, setHoveredChipNodeId] = useState(null);
  const [focused, setFocused] = useState(false);
  const drawerRef = useRef(null);
  const editorRef = useRef(null);
  const savedRangeRef = useRef(null);
  const isBuildingRef = useRef(false);
  const atMenuOpenRef = useRef(false);
  const promptRef = useRef(prompt);

  promptRef.current = prompt;

  const config = NODE_TYPE_REGISTRY[node.type] || NODE_TYPE_REGISTRY.image;
  const { handleOpenSettings, handleUpdateNodeData } = useActiveNode() || {};
  const connectedSourceNodes = node.connectedSourceNodes || [];
  const validSourceNodes = connectedSourceNodes.filter(sourceNode => {
    const hasImages = sourceNode.data?.images?.length > 0;
    const hasText = sourceNode.data?.result?.content || sourceNode.data?.prompt;
    return hasImages || hasText;
  });
  const hasConnectedData = validSourceNodes.length > 0;

  const [atReferenceState, setAtReferenceState] = useState({
    active: false,
    filter: '',
    position: null,
    startIndex: -1,
  });

  // Reset form on node change
  useEffect(() => {
    setPrompt(node?.data?.prompt || '');
    setDuration(node?.data?.duration || '5');
    setFps(node?.data?.fps || '30');
    setAspectRatio(node?.data?.aspectRatio || '16:9');
    setResolution(node?.data?.resolution || '1K');
    const availableModels = getAvailableModels(node?.type, apiProviders);
    setModel(node?.data?.model || availableModels?.[0] || '');
  }, [node?.id, node?.data?.prompt, node?.data?.duration, node?.data?.fps, node?.data?.aspectRatio, node?.data?.resolution, node?.data?.model, node?.type, apiProviders]);

  // Drawer direction
  useEffect(() => {
    if (drawerRef.current) {
      const rect = drawerRef.current.getBoundingClientRect();
      setDrawerDir(rect.bottom > window.innerHeight - 16 ? 'top' : 'bottom');
    }
  }, [prompt, aspectRatio, model, resolution, duration, fps]);

  // Sync prompt → DOM when prompt changes externally
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const current = serializeDOM(el);
    if (current !== prompt) {
      isBuildingRef.current = true;
      renderPromptToRoot(prompt, el, validSourceNodes);
      isBuildingRef.current = false;
    }
  }, [prompt, node?.id]);
  // validSourceNodes intentionally omitted — we read it fresh via closure inside renderPromptToRoot

  // Native wheel handler to stop React Flow from stealing scroll events
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const handler = (e) => {
      e.stopPropagation();
    };
    el.addEventListener('wheel', handler, { passive: true });
    return () => el.removeEventListener('wheel', handler);
  }, []);

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
        if (sourceNode.type !== 'text' && sourceNode.type !== 'source-text' && sourceNode.type !== 'source-markdown') return match;
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

  // ── ContentEditable input handler ─────────────────────────────────────

  const handleInput = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || isBuildingRef.current) return;

    // Detect @ typed at word boundary
    if (hasConnectedData && isLastCharAt(editor)) {
      const prev = getPrevChar(editor);
      if (prev === null || prev === ' ' || prev === '\n') {
        const sel = window.getSelection();
        if (sel.rangeCount) {
          savedRangeRef.current = sel.getRangeAt(0).cloneRange();
        }
        atMenuOpenRef.current = true;
        setAtReferenceState({
          active: true,
          filter: '',
          position: { x: 0, y: 30 },
          startIndex: -1,
        });
      }
    }

    // Update filter text when menu is open
    if (atMenuOpenRef.current && savedRangeRef.current) {
      const sel = window.getSelection();
      if (sel.rangeCount) {
        const curRange = sel.getRangeAt(0);
        const savedRange = savedRangeRef.current;
        if (editor.contains(savedRange.startContainer) && editor.contains(curRange.startContainer)) {
          const r = document.createRange();
          r.setStart(savedRange.startContainer, savedRange.startOffset);
          r.setEnd(curRange.startContainer, curRange.startOffset);
          const filterText = r.toString();
          if (filterText.includes(' ') || filterText.includes('\n')) {
            atMenuOpenRef.current = false;
            setAtReferenceState({ active: false, filter: '', position: null, startIndex: -1 });
          } else {
            setAtReferenceState(prev => prev.active ? { ...prev, filter: filterText } : prev);
          }
        }
      }
    }

    // Serialize and sync prompt
    const serialized = serializeDOM(editor);
    if (serialized !== promptRef.current) {
      setPrompt(serialized);
    }
  }, [hasConnectedData]);

  // ── KeyDown handler ───────────────────────────────────────────────────

  const handleKeyDown = useCallback((e) => {
    e.stopPropagation(); // prevent React Flow from stealing events

    if (e.key === 'Escape' && atMenuOpenRef.current) {
      atMenuOpenRef.current = false;
      setAtReferenceState({ active: false, filter: '', position: null, startIndex: -1 });
      e.preventDefault();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
      return;
    }

    if (e.key === 'Backspace' || e.key === 'Delete') {
      const editor = editorRef.current;
      if (editor && deleteAdjacentChip(editor, e.key === 'Backspace' ? 'backspace' : 'delete')) {
        e.preventDefault();
        // Sync prompt after chip deletion
        const serialized = serializeDOM(editor);
        if (serialized !== promptRef.current) {
          setPrompt(serialized);
        }
      }
    }
  }, [handleSubmit]);

  // ── Paste handler ─────────────────────────────────────────────────────

  const handlePaste = useCallback((e) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (text) {
      document.execCommand('insertText', false, text);
    }
  }, []);

  // ── Insert @-reference chip ──────────────────────────────────────────

  const insertReference = (sourceNode) => {
    const editor = editorRef.current;
    if (!editor) return;

    const sel = window.getSelection();
    const savedRange = savedRangeRef.current;

    if (sel && savedRange && editor.contains(savedRange.startContainer)) {
      // Get current cursor for filter text
      const curRange = sel.rangeCount ? sel.getRangeAt(0) : null;

      // Restore saved range
      sel.removeAllRanges();
      sel.addRange(savedRange);

      // Delete from @ to current cursor (covers @ + filter text)
      const deleteRange = document.createRange();
      const cont = savedRange.startContainer;
      const off = savedRange.startOffset;
      if (off > 0) {
        deleteRange.setStart(cont, off - 1); // the @ char
      } else {
        deleteRange.setStart(cont, 0);
      }
      if (curRange && editor.contains(curRange.startContainer)) {
        deleteRange.setEnd(curRange.startContainer, curRange.startOffset);
      } else {
        deleteRange.setEnd(cont, off);
      }
      deleteRange.deleteContents();
    }

    // Insert chip
    const title = sourceNode.data.title || 'Untitled';
    const thumbUrl = sourceNode.data?.images?.[0]?.url;
    insertChipAtEditor(editor, sourceNode.id, title, sourceNode.type, thumbUrl);

    atMenuOpenRef.current = false;
    setAtReferenceState({ active: false, filter: '', position: null, startIndex: -1 });
  };

  const filteredAtNodes = atReferenceState.active
    ? validSourceNodes.filter(n =>
        (n.data.title || '').toLowerCase().includes(atReferenceState.filter.toLowerCase())
      )
    : [];

  // ── Dock hover helpers ──────────────────────────────────────────────

  const getDockScale = (idx) => {
    if (hoveredDockIdx === null) return 1;
    if (idx === hoveredDockIdx) return 1.25;
    if (Math.abs(idx - hoveredDockIdx) === 1) return 1.10;
    return 1;
  };

  const getDockX = (idx) => {
    if (hoveredDockIdx === null) return 0;
    if (idx === hoveredDockIdx) return 0;
    if (Math.abs(idx - hoveredDockIdx) === 1) {
      return (idx < hoveredDockIdx ? -1 : 1) * 10;
    }
    return 0;
  };

  const getDockOpacity = (idx) => {
    if (hoveredDockIdx === null) return 0.65;
    if (idx === hoveredDockIdx || Math.abs(idx - hoveredDockIdx) === 1) return 1;
    return 0.4;
  };

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <>
      <div
        ref={drawerRef}
        className="nodrag"
      style={{
        position: 'absolute',
        left: '50%',
        marginLeft: -300,
        [drawerDir === 'bottom' ? 'top' : 'bottom']: 'calc(100% + 10px)',
        width: 600,
        zIndex: 1000,
        animation: 'slideUp 0.2s var(--ease-out)',
        transformOrigin: drawerDir === 'bottom' ? 'top center' : 'bottom center',
      }}
    >
      {/* Floating ConnectedNodesPreview */}
      {hasConnectedData && (
        <div className="nd-dock">
          {validSourceNodes.map((sourceNode, idx) => {
            const scale = getDockScale(idx);
            const x = getDockX(idx);
            const opacity = getDockOpacity(idx);
            const isHovered = idx === hoveredDockIdx || (hoveredChipNodeId === sourceNode.id && hoveredDockIdx === null);
            const sourceMeta = NODE_TYPE_REGISTRY[sourceNode.type] || NODE_TYPE_REGISTRY.image;
            const sourceImages = sourceNode.data?.images || [];
            const thumbSrc = sourceImages[0]?.url;
            return (
              <div
                key={sourceNode.id}
                className={'nd-dock-item' + (isHovered ? ' is-hovered' : '')}
                onClick={(e) => { e.stopPropagation(); insertReference(sourceNode); }}
                onMouseEnter={() => setHoveredDockIdx(idx)}
                onMouseLeave={() => setHoveredDockIdx(null)}
                title={sourceNode.data.title || sourceMeta.title}
                style={{
                  transform: `scale(${scale}) translateX(${x}px) translateY(${isHovered ? -4 : 0}px)`,
                  opacity,
                }}
              >
                {thumbSrc ? (
                  <img src={thumbSrc} alt="" className="nd-dock-thumb"
                    onError={(e) => { e.target.style.display = 'none'; }} />
                ) : (
                  <span className="nd-dock-icon" style={{ color: sourceMeta.accentVar }}>
                    {sourceMeta.smallIcon}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className={'nd-panel' + (focused ? ' is-focused' : '')}>
        <div style={{ position: 'relative' }}>
          {/* ContentEditable editor */}
          <div
            ref={editorRef}
            contentEditable
            className={'nd-editor' + (!prompt ? ' is-empty' : '')}
            data-placeholder={node.type === 'text' ? '输入文本内容...' : "输入描述或按'/'呼出指令（Enter 发送，Shift+Enter 换行）"}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onMouseOver={(e) => {
              const chip = e.target.closest('[data-ref-id]');
              if (chip) {
                const rect = chip.getBoundingClientRect();
                setChipTooltip({ rect, label: chip.getAttribute('data-ref-label') });
                setHoveredChipNodeId(chip.getAttribute('data-ref-id'));
              }
            }}
            onMouseOut={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) {
                setChipTooltip(null);
                setHoveredChipNodeId(null);
              }
            }}
          />

          {/* @-reference typeahead dropdown */}
          {atReferenceState.active && (
            <div className="nd-atmenu">
              {filteredAtNodes.length === 0 ? (
                <div className="nd-atmenu-empty">
                  {validSourceNodes.length === 0 ? '无可用连接数据' : '没有匹配的连接数据'}
                </div>
              ) : (
                filteredAtNodes.map((sourceNode) => {
                  const sourceMeta = NODE_TYPE_REGISTRY[sourceNode.type] || NODE_TYPE_REGISTRY.image;
                  return (
                    <div
                      key={sourceNode.id}
                      className="nd-atmenu-item"
                      onClick={() => insertReference(sourceNode)}
                    >
                      <span className="nd-atmenu-item-icon" style={{ color: sourceMeta.accentVar }}>
                        {sourceMeta.smallIcon}
                      </span>
                      <span className="nd-atmenu-item-label">
                        {sourceNode.data.title || sourceMeta.title}
                      </span>
                      <span className="nd-atmenu-item-type">
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
          <div className="nd-params">
            <div className="nd-param">
              <div className="nd-param-label">时长 (s)</div>
              <input type="number" className="nd-param-input" value={duration} onChange={(e) => setDuration(e.target.value)} min="1" max="60" />
            </div>
            <div className="nd-param">
              <div className="nd-param-label">帧率 (fps)</div>
              <input type="number" className="nd-param-input" value={fps} onChange={(e) => setFps(e.target.value)} min="15" max="60" />
            </div>
          </div>
        )}

        <div className="nd-footer">
          <div className="nd-footer-left">
            <CanvasDropdown
              value={node.type}
              onChange={handleTypeChange}
              options={[
                { value: 'image', label: '图片', icon: NODE_TYPE_REGISTRY.image.smallIcon },
                { value: 'text', label: '文字', icon: NODE_TYPE_REGISTRY.text.smallIcon },
                { value: 'video', label: '视频', icon: NODE_TYPE_REGISTRY.video.smallIcon },
              ]}
              trigger={<>{cloneElement(config.smallIcon, { width: 11, height: 11 })}<span className="nd-trigger-text">{config.title}</span></>}
              buttonStyle={triggerBtnBase}
              position="bottom"
              menuStyle={{ fontSize: 11, padding: '4px 0', minWidth: 80 }}
              itemStyle={{ padding: '5px 10px', fontSize: 11 }}
            />

            {availableModels.length > 0 ? (
              <CanvasDropdown
                value={model}
                onChange={(m) => setModel(m)}
                options={availableModels.map((m) => ({ value: m, label: m }))}
                trigger={<span className="nd-trigger-text">{model || '模型'}</span>}
                buttonStyle={triggerBtnBase}
                position="bottom"
                placeholder="模型"
                menuStyle={{ fontSize: 11, padding: '4px 0', minWidth: 80 }}
                itemStyle={{ padding: '5px 10px', fontSize: 11 }}
              />
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenSettings && handleOpenSettings();
                }}
                style={{ ...triggerBtnBase, gap: 4, color: 'var(--accent)' }}
                title="配置 API 平台"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
                <span className="nd-trigger-text">API</span>
              </button>
            )}

            {node.type !== 'text' && (
              <>
                <CanvasDropdown
                  value={aspectRatio}
                  onChange={handleAspectRatioChange}
                  options={ASPECT_RATIOS.map((r) => ({ value: r.label, label: r.label }))}
                  trigger={<span className="nd-trigger-text">{aspectRatio}</span>}
                  buttonStyle={triggerBtnBase}
                  position="bottom"
                  menuStyle={{ fontSize: 11, padding: '4px 0', minWidth: 80 }}
                  itemStyle={{ padding: '5px 10px', fontSize: 11 }}
                />

                <CanvasDropdown
                  value={resolution}
                  onChange={(r) => setResolution(r)}
                  options={RESOLUTIONS.map((r) => ({ value: r.label, label: r.label }))}
                  trigger={<span className="nd-trigger-text">{resolution}</span>}
                  buttonStyle={triggerBtnBase}
                  position="bottom"
                  menuStyle={{ fontSize: 11, padding: '4px 0', minWidth: 80 }}
                  itemStyle={{ padding: '5px 10px', fontSize: 11 }}
                />
              </>
            )}
          </div>

          <div className="nd-footer-right">
            <button
              onClick={(e) => { e.stopPropagation(); handleSubmit(); }}
              disabled={isSubmitting}
              className="nd-submit"
            >
              {isSubmitting ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 0.8s linear infinite' }}>
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
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="19" x2="12" y2="5" />
                    <polyline points="5 12 12 5 19 12" />
                  </svg>
                  <span>生成</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
      {chipTooltip && (
        <div
          className="nd-chip-tooltip"
          style={{
            left: chipTooltip.rect.left + chipTooltip.rect.width / 2,
            top: chipTooltip.rect.top - 8,
          }}
        >
          {chipTooltip.label}
        </div>
      )}
    </>
  );
}

export default NodeDrawer;
