import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';

const MASK_COLOR = '#ffc800';
const MASK_RGB = [255, 200, 0];
const MASK_DISPLAY_ALPHA = 0.45;

function floodFill(imageData, startX, startY, fillColor) {
  const { data, width, height } = imageData;
  const si = (startY * width + startX) * 4;
  const tr = data[si], tg = data[si + 1], tb = data[si + 2], ta = data[si + 3];
  if (tr === fillColor[0] && tg === fillColor[1] && tb === fillColor[2] && ta === fillColor[3]) return;

  const stack = [[startX, startY]];
  const visited = new Uint8Array(width * height);
  visited[startY * width + startX] = 1;

  while (stack.length) {
    const [x, y] = stack.pop();
    const pi = (y * width + x) * 4;
    data[pi] = fillColor[0]; data[pi + 1] = fillColor[1]; data[pi + 2] = fillColor[2]; data[pi + 3] = fillColor[3];

    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      if (visited[ny * width + nx]) continue;
      const np = (ny * width + nx) * 4;
      const tol = 20;
      if (Math.abs(data[np] - tr) <= tol && Math.abs(data[np + 1] - tg) <= tol &&
          Math.abs(data[np + 2] - tb) <= tol && Math.abs(data[np + 3] - ta) <= tol) {
        visited[ny * width + nx] = 1;
        stack.push([nx, ny]);
      }
    }
  }
}

export default function MattingEditor({ isOpen, imageUrl, onClose, onSave }) {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const baseRef = useRef(null);
  const ptsRef = useRef([]);
  const drawingRef = useRef(false);
  const historyRef = useRef([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [tool, setTool] = useState('brush'); // brush | eraser | bucket
  const [brushSize, setBrushSize] = useState(30);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const panningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

  const getCoords = useCallback((e) => {
    const c = canvasRef.current;
    if (!c) return [0, 0];
    const r = c.getBoundingClientRect();
    return [(e.clientX - r.left) * (c.width / r.width), (e.clientY - r.top) * (c.height / r.height)];
  }, []);

  const pushHistory = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    const data = ctx.getImageData(0, 0, c.width, c.height);
    setHistoryIdx(i => {
      const h = historyRef.current.slice(0, i + 1);
      h.push(data);
      if (h.length > 30) h.shift();
      historyRef.current = h;
      return h.length - 1;
    });
  }, []);

  const restoreHistory = useCallback((idx) => {
    const c = canvasRef.current;
    if (!c) return;
    const d = historyRef.current[idx];
    if (!d) return;
    c.getContext('2d').putImageData(d, 0, 0);
  }, []);

  // Init canvas
  const initCanvas = useCallback(() => {
    const c = canvasRef.current, img = imgRef.current;
    if (!c || !img) return;
    c.width = Math.min(img.naturalWidth, 2048);
    c.height = Math.min(img.naturalHeight, 2048);
    const initial = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    historyRef.current = [initial];
    setHistoryIdx(0);
  }, []);

  useEffect(() => { if (isOpen) { setTool('brush'); setScale(1); setOffset({ x: 0, y: 0 }); historyRef.current = []; setHistoryIdx(-1); } }, [isOpen]);

  const handlePointerDown = useCallback((e) => {
    e.preventDefault();
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');

    if (e.button === 1) {
      panningRef.current = true;
      panStartRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
      return;
    }

    drawingRef.current = true;

    if (tool === 'bucket') {
      const id = ctx.getImageData(0, 0, c.width, c.height);
      const fill = tool === 'eraser' ? [0, 0, 0, 0] : [...MASK_RGB, 255];
      floodFill(id, Math.round(e.nativeEvent.offsetX), Math.round(e.nativeEvent.offsetY), fill);
      ctx.putImageData(id, 0, 0);
      pushHistory();
      return;
    }

    baseRef.current = ctx.getImageData(0, 0, c.width, c.height);
    ptsRef.current = [getCoords(e)];
  }, [tool, offset, pushHistory, getCoords]);

  const handlePointerMove = useCallback((e) => {
    if (panningRef.current) {
      setOffset({ x: panStartRef.current.ox + e.clientX - panStartRef.current.x, y: panStartRef.current.oy + e.clientY - panStartRef.current.y });
      return;
    }
    if (!drawingRef.current || tool === 'bucket') return;
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    const [x, y] = getCoords(e);
    ptsRef.current.push({ x, y });
    if (baseRef.current) ctx.putImageData(baseRef.current, 0, 0);
    const isErase = tool === 'eraser';
    ctx.save();
    ctx.globalCompositeOperation = isErase ? 'destination-out' : 'source-over';
    ctx.strokeStyle = isErase ? '#000' : MASK_COLOR;
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(ptsRef.current[0].x, ptsRef.current[0].y);
    for (let i = 1; i < ptsRef.current.length; i++) ctx.lineTo(ptsRef.current[i].x, ptsRef.current[i].y);
    ctx.stroke();
    ctx.restore();
  }, [tool, brushSize, getCoords]);

  const handlePointerUp = useCallback(() => {
    if (panningRef.current) { panningRef.current = false; return; }
    if (!drawingRef.current) return;
    drawingRef.current = false;
    baseRef.current = null;
    ptsRef.current = [];
    pushHistory();
  }, [pushHistory]);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    setScale(s => Math.max(0.5, Math.min(6, s * (e.deltaY > 0 ? (1 / 1.12) : 1.12))));
  }, []);

  const handleUndo = useCallback(() => setHistoryIdx(i => { if (i <= 0) return i; restoreHistory(i - 1); return i - 1; }), [restoreHistory]);
  const handleRedo = useCallback(() => setHistoryIdx(i => { if (i >= historyRef.current.length - 1) return i; restoreHistory(i + 1); return i + 1; }), [restoreHistory]);
  const handleClear = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.getContext('2d').clearRect(0, 0, c.width, c.height);
    pushHistory();
  }, [pushHistory]);

  const handleSave = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const out = document.createElement('canvas');
    out.width = c.width; out.height = c.height;
    const octx = out.getContext('2d');
    octx.globalAlpha = MASK_DISPLAY_ALPHA;
    octx.drawImage(c, 0, 0);
    onSave(out.toDataURL('image/png'));
  }, [onSave]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'b') setTool('brush');
      if (e.key === 'e') setTool('eraser');
      if (e.key === 'g') setTool('bucket');
      if (e.key === 'r') handleClear();
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); handleUndo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); handleRedo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose, handleClear, handleUndo, handleRedo]);

  if (!isOpen) return null;

  const canUndo = historyIdx > 0;
  const canRedo = historyIdx < historyRef.current.length - 1;

  return createPortal(
    <div className="me-overlay">
      {/* Toolbar */}
      <div className="me-toolbar">
        <button className="me-btn" onClick={onClose} title="取消 (Esc)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
        <div className="me-divider" />
        <button className={`me-btn me-tool-btn${tool === 'brush' ? ' active' : ''}`} onClick={() => setTool('brush')} title="画笔 B">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
        </button>
        <button className={`me-btn me-tool-btn${tool === 'eraser' ? ' active' : ''}`} onClick={() => setTool('eraser')} title="橡皮擦 E">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13-5 5L3 12l5-5Z" /><path d="M18 13l4-4-5-5-4 4" /></svg>
        </button>
        <button className={`me-btn me-tool-btn${tool === 'bucket' ? ' active' : ''}`} onClick={() => setTool('bucket')} title="油漆桶 G">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12l4-4 8 8-4 4Z" /><path d="M15 15l5-5-5-5" /><path d="M21 6l-3 3" /></svg>
        </button>
        <div className="me-divider" />
        <div className="me-size-wrap">
          <span className="me-size-label">{brushSize}</span>
          <input className="me-size-range" type="range" min="2" max="120" value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} />
        </div>
        <div className="me-divider" />
        <button className="me-btn" onClick={handleUndo} disabled={!canUndo} title="撤销 Ctrl+Z">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
        </button>
        <button className="me-btn" onClick={handleRedo} disabled={!canRedo} title="重做 Ctrl+Y">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
        </button>
        <button className="me-btn" onClick={handleClear} title="清空 R">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
        </button>
        <div className="me-spacer" />
        <button className="me-btn me-save-btn" onClick={handleSave} title="保存">保存</button>
      </div>

      {/* Stage */}
      <div className="me-stage" onWheel={handleWheel}>
        <div className="me-zoom" style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}>
          <div className="me-viewport">
            <img ref={imgRef} src={imageUrl} alt="编辑" className="me-image" draggable={false} onLoad={initCanvas} crossOrigin="anonymous" />
            <canvas ref={canvasRef} className="me-canvas"
              style={{ opacity: MASK_DISPLAY_ALPHA }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
            />
          </div>
        </div>
        {scale !== 1 && (
          <button className="me-zoom-indicator" onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }); }}>
            {Math.round(scale * 100)}%
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}
