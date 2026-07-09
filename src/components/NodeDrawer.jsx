import { useState, useEffect, useRef, useCallback, cloneElement } from 'react';
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
  chip.className = 'prompt-chip chip-' + (nodeType || 'image');
  chip.setAttribute('data-ref-id', nodeId);
  chip.setAttribute('data-ref-label', label);
  if (options?.thumbUrl) {
    const img = document.createElement('img');
    img.className = 'prompt-chip-thumb';
    img.src = options.thumbUrl;
    img.draggable = false;
    img.onerror = (e) => { e.target.style.display = 'none'; };
    chip.appendChild(img);
  } else {
    const icon = document.createElement('span');
    icon.className = 'prompt-chip-icon';
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
  const [isExpanded, setIsExpanded] = useState(false);
  const [hoveredDockIdx, setHoveredDockIdx] = useState(null);
  const [chipTooltip, setChipTooltip] = useState(null);
  const [hoveredChipNodeId, setHoveredChipNodeId] = useState(null);
  const drawerRef = useRef(null);
  const editorRef = useRef(null);
  const savedRangeRef = useRef(null);
  const isBuildingRef = useRef(false);
  const atMenuOpenRef = useRef(false);
  const promptRef = useRef(prompt);

  promptRef.current = prompt;

  const config = NODE_TYPE_REGISTRY[node.type] || NODE_TYPE_REGISTRY.image;
  const { handleOpenApiSettings, handleUpdateNodeData } = useActiveNode() || {};
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

  // Inject editor CSS once
  useEffect(() => {
    if (document.getElementById('nd-editor-styles')) return;
    const style = document.createElement('style');
    style.id = 'nd-editor-styles';
    style.textContent = `
.prompt-editor {
  width:100%; min-height:60px; max-height:110px; overflow-y:auto;
  background:transparent; border:none; outline:none;
  font-size:11px; line-height:1.5;
  color:var(--drawer-text); caret-color:var(--drawer-text);
  font-family:inherit; white-space:pre-wrap; word-wrap:break-word;
  padding:0; position:relative; z-index:2;
  scrollbar-width:none;
}
.prompt-editor::-webkit-scrollbar { display:none; }
.prompt-editor.nd-expanded { height:250px; max-height:none; }
.prompt-editor:empty::before {
  content:attr(data-placeholder); color:var(--text-tertiary);
  pointer-events:none; display:block;
}
.prompt-editor:focus { outline:none; }
.prompt-chip {
  display:inline-flex; align-items:center; gap:3px;
  padding:0 6px 0 4px; border-radius:5px;
  font-size:10px; font-weight:600; line-height:1.5;
  vertical-align:middle; margin:0 1px; border:1px solid transparent;
  cursor:default; transition:filter 0.15s, box-shadow 0.15s;
}
.prompt-chip:hover { filter:brightness(1.12); box-shadow:0 1px 6px rgba(0,0,0,0.2); }
.prompt-chip-icon { font-size:9px; font-weight:700; opacity:0.9; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; }
.chip-image { background:rgba(var(--signal-image-rgb),0.12); color:var(--signal-image); border-color:rgba(var(--signal-image-rgb),0.25); }
.chip-text { background:rgba(var(--signal-text-rgb),0.12); color:var(--signal-text); border-color:rgba(var(--signal-text-rgb),0.25); }
.chip-video { background:rgba(var(--signal-video-rgb),0.12); color:var(--signal-video); border-color:rgba(var(--signal-video-rgb),0.25); }
.prompt-chip-thumb { width:14px; height:14px; border-radius:3px; object-fit:cover; display:block; }
`;
    document.head.appendChild(style);
  }, []);

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
        left: 0,
        [drawerDir === 'bottom' ? 'top' : 'bottom']: 'calc(100% + 8px)',
        width: '100%',
        minWidth: 280,
        zIndex: 1000,
        animation: 'slideUp 0.2s var(--ease-out)',
        transformOrigin: drawerDir === 'bottom' ? 'top center' : 'bottom center',
      }}
    >
      {/* Floating ConnectedNodesPreview */}
      {hasConnectedData && (
        <div className="nodrag" style={{
          position: 'absolute',
          bottom: 'calc(100% + 6px)',
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          zIndex: 10,
          pointerEvents: 'auto',
        }}>
          <div style={{
            display: 'flex',
            gap: 4,
            padding: '3px 8px',
            background: 'var(--drawer-bg)',
            border: '1px solid var(--drawer-border)',
            borderRadius: 8,
            backdropFilter: 'blur(20px)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            alignItems: 'center',
          }}>
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
                  onClick={(e) => { e.stopPropagation(); insertReference(sourceNode); }}
                  onMouseEnter={() => setHoveredDockIdx(idx)}
                  onMouseLeave={() => setHoveredDockIdx(null)}
                  title={sourceNode.data.title || sourceMeta.title}
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 6,
                    overflow: 'hidden',
                    cursor: 'pointer',
                    flexShrink: 0,
                    transition: 'transform 0.2s var(--ease-out), opacity 0.2s var(--ease-out)',
                    transform: `scale(${scale}) translateX(${x}px) translateY(${isHovered ? -4 : 0}px)`,
                    opacity,
                    background: isHovered ? 'var(--accent-soft)' : 'var(--panel-bg)',
                    border: isHovered ? '1px solid var(--accent)' : '1px solid var(--drawer-border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {thumbSrc ? (
                    <img src={thumbSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      onError={(e) => { e.target.style.display = 'none'; e.target.parentElement.style.background = 'var(--panel-bg)'; }} />
                  ) : (
                    <div style={{ color: sourceMeta.accentVar, opacity: 0.8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {sourceMeta.smallIcon}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

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
        <div style={{ position: 'relative' }}>
          {/* ContentEditable editor */}
          <div
            ref={editorRef}
            contentEditable
            className={'prompt-editor' + (isExpanded ? ' nd-expanded' : '')}
            data-placeholder={node.type === 'text' ? '输入文本内容...' : '描述你想生成的内容...'}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
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
            trigger={<>{cloneElement(config.smallIcon, { width: 11, height: 11 })}{config.title}</>}
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
              trigger={<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 38 }}>{model || '模型'}</span>}
              buttonStyle={{ ...triggerBtnBase, maxWidth: 58, minWidth: 0 }}
              position="bottom"
              placeholder="模型"
              menuStyle={{ fontSize: 11, padding: '4px 0', minWidth: 80 }}
              itemStyle={{ padding: '5px 10px', fontSize: 11 }}
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
                position="bottom"
                menuStyle={{ fontSize: 11, padding: '4px 0', minWidth: 80 }}
                itemStyle={{ padding: '5px 10px', fontSize: 11 }}
              />

              <CanvasDropdown
                value={resolution}
                onChange={(r) => setResolution(r)}
                options={RESOLUTIONS.map((r) => ({ value: r.label, label: r.label }))}
                trigger={<span style={{ maxWidth: 18, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{resolution}</span>}
                buttonStyle={{ ...triggerBtnBase, fontSize: 8 }}
                position="bottom"
                menuStyle={{ fontSize: 11, padding: '4px 0', minWidth: 80 }}
                itemStyle={{ padding: '5px 10px', fontSize: 11 }}
              />
            </>
          )}

          <div style={{ flex: 1 }} />

          <button
            onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
            title={isExpanded ? '收起' : '展开'}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 24, height: 24, flexShrink: 0, marginRight: 6,
              background: 'var(--bg-secondary)',
              border: '1px solid var(--drawer-border)',
              borderRadius: 5,
              color: 'var(--text-tertiary)',
              cursor: 'pointer',
              opacity: 0.7,
              transition: 'opacity 0.15s, background 0.15s',
              padding: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'var(--accent-soft)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.7'; e.currentTarget.style.background = 'var(--bg-secondary)'; }}
          >
            {isExpanded ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="18 15 12 9 6 15" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            )}
          </button>

          <button
            onClick={(e) => { e.stopPropagation(); handleSubmit(); }}
            disabled={isSubmitting}
            className="drawer-run-btn"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 28, height: 28,
              background: 'var(--signal-live)',
              border: 'none', borderRadius: 6,
              color: '#0e0e14',
              cursor: isSubmitting ? 'wait' : 'pointer',
              transition: 'all 0.15s ease',
              opacity: isSubmitting ? 0.4 : 0.85,
              flexShrink: 0,
            }}
            onMouseEnter={(e) => { if (!isSubmitting) { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'scale(1.1)'; } }}
            onMouseLeave={(e) => { if (!isSubmitting) { e.currentTarget.style.opacity = '0.85'; e.currentTarget.style.transform = 'scale(1)'; } }}
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
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="6,4 20,12 6,20" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
      {chipTooltip && (
        <div style={{
          position: 'fixed',
          left: chipTooltip.rect.left + chipTooltip.rect.width / 2,
          top: chipTooltip.rect.top - 8,
          transform: 'translate(-50%, -100%)',
          zIndex: 10050,
          padding: '3px 8px',
          background: 'rgba(0,0,0,0.85)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 6,
          fontSize: 11,
          color: '#fff',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}>
          {chipTooltip.label}
        </div>
      )}
    </>
  );
}

export default NodeDrawer;
