import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

function StoryboardNode({ id, data, selected, width: nodeWidth, height: nodeHeight }) {
  const w = nodeWidth || data?.width || data?.nodeWidth || 280;
  const h = nodeHeight || data?.height || data?.nodeHeight || w;
  const imageUrl = data?.imageUrl || data?.images?.[0]?.url || data?.result?.url;
  if (!imageUrl) {
    return <div className="node-card" style={{ width: w, height: Math.max(h, 60), display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--node-bg)', border: '1px solid var(--node-border)', borderRadius: 12, fontSize: 12, color: 'var(--text-tertiary)' }}>无图像</div>;
  }

  const rows = data?.gridRows || 2;
  const cols = data?.gridCols || 2;
  const total = rows * cols;
  // Ensure arrays are present and sized correctly
  const extracted = Array.isArray(data?.extractedCells) ? data.extractedCells : [];
  let overrides = Array.isArray(data?.cellOverrides) ? data.cellOverrides : [];
  if (overrides.length < total && data?.cellOverrides && !Array.isArray(data.cellOverrides)) {
    overrides = [];
  }
  // Custom grid positions (non-uniform)
  const rowPositions = Array.isArray(data?.rowPositions) ? data.rowPositions : [];
  const colPositions = Array.isArray(data?.colPositions) ? data.colPositions : [];
  const isCustomGrid = rowPositions.length > 0 || colPositions.length > 0;

  const [editing, setEditing] = useState(false);
  const [drag, setDrag] = useState(null);
  const [dropCell, setDropCell] = useState(null);
  const dragStartRef = useRef(null);

  // Toggle edit on double-click
  const toggleEdit = useCallback((e) => { e.stopPropagation(); setEditing(v => !v); }, []);
  useEffect(() => { const h = (e) => { if (e.key === 'Escape') setEditing(false); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, []);
  useEffect(() => { if (!selected) { setEditing(false); setDropCell(null); } }, [selected]);

  // Drag-out handler
  const cellPointerDown = useCallback((e, idx) => {
    if (!editing || (extracted[idx] && !overrides[idx])) return;
    e.stopPropagation();
    dragStartRef.current = { x: e.clientX, y: e.clientY, idx };
  }, [editing, extracted, overrides]);

  useEffect(() => {
    if (!editing) return;
    const onMove = (e) => {
      if (dragStartRef.current) setDrag({ idx: dragStartRef.current.idx, x: e.clientX, y: e.clientY });
    };
    const onUp = (e) => {
      const ds = dragStartRef.current;
      dragStartRef.current = null;
      setDrag(null);
      if (!ds) return;
      // If dropped outside the node, extract cell
      const el = document.querySelector(`.react-flow__node[data-id="${id}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
          // If cell has an overridden image, use it directly; otherwise crop from source
          if (overrides[ds.idx]?.url) {
            dispatchEvent(new CustomEvent('sb-extract', { detail: { dataUrl: overrides[ds.idx].url, label: `格 ${Math.floor(ds.idx / cols) + 1}-${(ds.idx % cols) + 1}`, idx: ds.idx, nodeId: id, clientX: e.clientX, clientY: e.clientY, isOverride: true } }));
          } else {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
              const iw = img.naturalWidth, ih = img.naturalHeight;
              const cellR = Math.floor(ds.idx / cols), cellC = ds.idx % cols;
              const cw = Math.floor(iw / cols), ch = Math.floor(ih / rows);
              const sx = cellC * cw, sy = cellR * ch;
              const sw = cellC === cols - 1 ? iw - sx : cw;
              const sh = cellR === rows - 1 ? ih - sy : ch;
              const canvas = document.createElement('canvas');
              canvas.width = sw; canvas.height = sh;
              canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
              dispatchEvent(new CustomEvent('sb-extract', { detail: { dataUrl: canvas.toDataURL('image/png'), label: `格 ${cellR + 1}-${cellC + 1}`, idx: ds.idx, nodeId: id, clientX: e.clientX, clientY: e.clientY } }));
            };
            img.src = imageUrl;
          }
        }
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    return () => { document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp); };
  }, [editing, id, imageUrl, cols, rows, overrides]);

  // External drag-over highlight — use elementsFromPoint like AI-Canvas
  useEffect(() => {
    const onMove = (e) => {
      const dragNode = document.querySelector('.react-flow__node.dragging');
      if (!dragNode) { setDropCell(null); return; }
      const stack = document.elementsFromPoint(e.clientX, e.clientY);
      let found = null;
      for (const el of stack) {
        const c = el.closest?.('[data-sb-idx]');
        if (c) {
          const sb = c.closest('.react-flow__node');
          if (sb?.getAttribute('data-id') === id) {
            found = parseInt(c.getAttribute('data-sb-idx'), 10);
            break;
          }
        }
      }
      setDropCell(found);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', () => setTimeout(() => setDropCell(null), 100));
    return () => document.removeEventListener('pointermove', onMove);
  }, [id]);

  const cells = [];
  const hRanges = [0, ...rowPositions, 100];
  const vRanges = [0, ...colPositions, 100];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let box, img;
      if (isCustomGrid) {
        const cellTop = hRanges[r], cellLeft = vRanges[c];
        const cellH = hRanges[r + 1] - hRanges[r], cellW = vRanges[c + 1] - vRanges[c];
        box = { left: `${cellLeft}%`, top: `${cellTop}%`, width: `${cellW}%`, height: `${cellH}%` };
        img = { width: `${(100 / cellW) * 100}%`, height: `${(100 / cellH) * 100}%`, left: `${-(cellLeft / cellW) * 100}%`, top: `${-(cellTop / cellH) * 100}%` };
      } else {
        box = { left: `${(c / cols) * 100}%`, top: `${(r / rows) * 100}%`, width: `${(1 / cols) * 100}%`, height: `${(1 / rows) * 100}%` };
        img = { width: `${cols * 100}%`, height: `${rows * 100}%`, left: `${-c * 100}%`, top: `${-r * 100}%` };
      }
      cells.push({ idx: r * cols + c, r, c, box, img });
    }
  }

  return (
    <>
      <div className={`node-card${selected ? ' selected' : ''}${editing ? ' editing nodrag' : ''}`}
        onDoubleClick={toggleEdit}
        style={{ position: 'relative', width: w, height: h, background: editing ? 'rgba(255,255,255,0.03)' : 'var(--node-bg)', border: editing ? '2px solid var(--accent)' : '1px solid var(--node-border)', borderRadius: 12, overflow: 'hidden', transition: 'border-color 0.15s' }}
      >
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          {cells.map((cell) => {
            const override = overrides[cell.idx];
            const isEmpty = !override && extracted[cell.idx];
            const draggable = editing && !isEmpty;
            return (
              <div key={cell.idx} data-sb-idx={cell.idx}
                onPointerDown={draggable ? (e) => cellPointerDown(e, cell.idx) : undefined}
                style={{ position: 'absolute', ...cell.box, overflow: 'hidden', cursor: draggable ? 'grab' : 'default', opacity: drag?.idx === cell.idx ? 0.35 : 1, transition: 'opacity 0.15s' }}>
                {/* Rendering priority: override > empty > original — matches AI-Canvas */}
                {override ? (
                  <img src={override.url} alt="" draggable={false}
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none', userSelect: 'none', display: 'block', maxWidth: 'none', maxHeight: 'none' }} />
                ) : isEmpty ? (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(128,128,128,0.08)', color: 'var(--text-secondary)', fontSize: 22, fontWeight: 300, pointerEvents: 'none' }}>+</div>
                ) : (
                  <img src={imageUrl} alt="" draggable={false}
                    style={{ position: 'absolute', objectFit: 'fill', pointerEvents: 'none', userSelect: 'none', display: 'block', maxWidth: 'none', maxHeight: 'none', ...cell.img }} />
                )}
                {/* Drop target outline */}
                {dropCell === cell.idx && <div style={{ position: 'absolute', inset: -1, borderRadius: 3, border: '2.5px solid var(--accent)', pointerEvents: 'none' }} />}
              </div>
            );
          })}
          <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none', width: '100%', height: '100%' }}>
            {Array.from({ length: cols - 1 }).map((_, i) => (<line key={`v${i}`} x1={`${colPositions[i] || ((i + 1) / cols) * 100}%`} y1="0" x2={`${colPositions[i] || ((i + 1) / cols) * 100}%`} y2="100%" stroke="var(--node-border-hover)" strokeWidth="1" strokeDasharray="3 2" />))}
            {Array.from({ length: rows - 1 }).map((_, i) => (<line key={`h${i}`} x1="0" y1={`${rowPositions[i] || ((i + 1) / rows) * 100}%`} x2="100%" y2={`${rowPositions[i] || ((i + 1) / rows) * 100}%`} stroke="var(--node-border-hover)" strokeWidth="1" strokeDasharray="3 2" />))}
          </svg>
        </div>
        <div style={{ position: 'absolute', bottom: 5, left: 5, padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 600, background: 'rgba(0,0,0,0.45)', color: 'rgba(255,255,255,0.75)', lineHeight: 1.2 }}>{data?.title || `${rows}×${cols}`}</div>
        {editing && <div style={{ position: 'absolute', top: 6, right: 6, padding: '3px 8px', borderRadius: 4, fontSize: 9, fontWeight: 700, background: 'var(--accent)', color: 'var(--bg-primary)', lineHeight: 1.2, letterSpacing: '0.06em', pointerEvents: 'none' }}>EDIT</div>}
        {!editing && <div style={{ position: 'absolute', bottom: 5, right: 5, padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 500, background: 'rgba(0,0,0,0.5)', color: 'rgba(255,255,255,0.7)', lineHeight: 1.2, pointerEvents: 'none' }}>双击编辑</div>}
      </div>
      {drag && createPortal(
        <div style={{ position: 'fixed', left: drag.x - 40, top: drag.y - 40, width: 80, height: 80, borderRadius: 8, overflow: 'hidden', pointerEvents: 'none', zIndex: 99999, boxShadow: '0 8px 32px rgba(0,0,0,0.3)', opacity: 0.85, backgroundImage: `url(${imageUrl})`, backgroundSize: `${cols * 100}% ${rows * 100}%`, backgroundPosition: `${cols > 1 ? ((drag.idx % cols) / (cols - 1)) * 100 : 50}% ${rows > 1 ? (Math.floor(drag.idx / cols) / (rows - 1)) * 100 : 50}%`, backgroundRepeat: 'no-repeat' }} />,
        document.body
      )}
    </>
  );
}

export default memo(StoryboardNode);
