/**
 * GridCropEditor — 自定义宫格裁切编辑器
 * 点击图像添加横/竖分割线，拖拽调整，点 × 删除，确认后生成 storyboard 节点
 */
import { useCallback, useRef, useState } from 'react';
import FullscreenOverlay from './FullscreenOverlay';

let guid = 0;
const nextId = () => `gl-${++guid}`;

export default function GridCropEditor({ isOpen, imageUrl, onClose, onSave }) {
  const imgRef = useRef(null);
  const justDraggedRef = useRef(false);
  const [hLines, setHLines] = useState([]);
  const [vLines, setVLines] = useState([]);
  const [mode, setMode] = useState('h'); // 'h' | 'v'
  const [dragging, setDragging] = useState(null);

  const handleClose = useCallback(() => {
    setHLines([]); setVLines([]); setMode('h');
    onClose();
  }, [onClose]);

  const handleStageClick = useCallback((e) => {
    if (justDraggedRef.current) { justDraggedRef.current = false; return; }
    if (!imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    if (mode === 'h') {
      const yPct = ((e.clientY - rect.top) / rect.height) * 100;
      setHLines((prev) => [...prev, { id: nextId(), pos: Math.max(0, Math.min(100, yPct)) }]);
    } else {
      const xPct = ((e.clientX - rect.left) / rect.width) * 100;
      setVLines((prev) => [...prev, { id: nextId(), pos: Math.max(0, Math.min(100, xPct)) }]);
    }
  }, [mode]);

  const handleLinePointerDown = useCallback((id, type) => (e) => {
    e.stopPropagation();
    e.preventDefault();
    setDragging(id);
    const onMove = (ev) => {
      if (!imgRef.current) return;
      const rect = imgRef.current.getBoundingClientRect();
      if (type === 'h') {
        const yPct = ((ev.clientY - rect.top) / rect.height) * 100;
        setHLines((prev) => prev.map((l) => (l.id === id ? { ...l, pos: Math.max(0, Math.min(100, yPct)) } : l)));
      } else {
        const xPct = ((ev.clientX - rect.left) / rect.width) * 100;
        setVLines((prev) => prev.map((l) => (l.id === id ? { ...l, pos: Math.max(0, Math.min(100, xPct)) } : l)));
      }
    };
    const onUp = () => { justDraggedRef.current = true; setDragging(null); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);

  const deleteLine = useCallback((id, type) => {
    if (type === 'h') setHLines((prev) => prev.filter((l) => l.id !== id));
    else setVLines((prev) => prev.filter((l) => l.id !== id));
  }, []);

  const handleClearAll = useCallback(() => { setHLines([]); setVLines([]); }, []);

  const handleConfirm = useCallback(() => {
    const hPcts = [...hLines].sort((a, b) => a.pos - b.pos).map((l) => l.pos);
    const vPcts = [...vLines].sort((a, b) => a.pos - b.pos).map((l) => l.pos);
    onSave(hPcts, vPcts);
    setHLines([]); setVLines([]); setMode('h');
  }, [hLines, vLines, onSave]);

  const hasLines = hLines.length > 0 || vLines.length > 0;

  return (
    <FullscreenOverlay isOpen={isOpen} onClose={handleClose}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: 16, width: '100vw', height: '100vh' }}>
        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', background: 'var(--panel-bg-strong)', backdropFilter: 'var(--panel-blur)', border: '1px solid var(--sidebar-border)', borderRadius: 10 }}>
          <button onClick={handleClose} style={{ width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 'none', borderRadius: 5, background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 16 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
          <div style={{ width: 1, height: 20, background: 'var(--sidebar-border)' }} />
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => setMode('h')} style={{ padding: '4px 12px', border: 'none', borderRadius: 5, background: mode === 'h' ? 'var(--accent-soft)' : 'transparent', color: mode === 'h' ? 'var(--accent)' : 'var(--text-secondary)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>横线</button>
            <button onClick={() => setMode('v')} style={{ padding: '4px 12px', border: 'none', borderRadius: 5, background: mode === 'v' ? 'var(--accent-soft)' : 'transparent', color: mode === 'v' ? 'var(--accent)' : 'var(--text-secondary)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>竖线</button>
          </div>
          <div style={{ width: 1, height: 20, background: 'var(--sidebar-border)' }} />
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>点击图像添加{mode === 'h' ? '横向' : '竖向'}分割线 · 拖拽调整 · 点 × 删除</span>
          <div style={{ flex: 1 }} />
          <button onClick={handleClearAll} disabled={!hasLines} style={{ padding: '4px 12px', border: 'none', borderRadius: 5, background: 'transparent', color: 'var(--text-secondary)', fontSize: 12, cursor: hasLines ? 'pointer' : 'default', opacity: hasLines ? 1 : 0.4 }}>清除全部</button>
          <button onClick={handleConfirm} disabled={!hasLines} style={{ padding: '5px 16px', border: 'none', borderRadius: 6, background: hasLines ? 'var(--accent)' : 'var(--text-tertiary)', color: 'var(--bg-primary)', fontSize: 12, fontWeight: 600, cursor: hasLines ? 'pointer' : 'default' }}>确认</button>
        </div>

        {/* Image stage */}
        <div onClick={handleStageClick} style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', maxWidth: '90vw', overflow: 'hidden', cursor: mode === 'h' ? 'row-resize' : 'col-resize' }}>
          <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', maxHeight: 'calc(100vh - 100px)' }}>
            <img ref={imgRef} src={imageUrl} alt="自定义宫格" style={{ display: 'block', maxWidth: '100%', maxHeight: 'calc(100vh - 100px)', objectFit: 'contain' }} draggable={false} />
            {hLines.map((line) => (
              <div key={line.id} onPointerDown={handleLinePointerDown(line.id, 'h')} style={{ position: 'absolute', left: 0, right: 0, top: `${line.pos}%`, height: 20, marginTop: -10, cursor: 'row-resize', zIndex: 10 }}>
                <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 2, marginTop: -1, background: 'rgba(255,255,255,0.7)', boxShadow: '0 0 4px rgba(0,0,0,0.5)' }} />
                <button onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); deleteLine(line.id, 'h'); }} style={{ position: 'absolute', right: 8, top: '50%', marginTop: -8, width: 16, height: 16, border: 'none', borderRadius: '50%', background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 9, lineHeight: '16px', textAlign: 'center', cursor: 'pointer', padding: 0 }}>×</button>
              </div>
            ))}
            {vLines.map((line) => (
              <div key={line.id} onPointerDown={handleLinePointerDown(line.id, 'v')} style={{ position: 'absolute', top: 0, bottom: 0, left: `${line.pos}%`, width: 20, marginLeft: -10, cursor: 'col-resize', zIndex: 10 }}>
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: 2, marginLeft: -1, background: 'rgba(255,255,255,0.7)', boxShadow: '0 0 4px rgba(0,0,0,0.5)' }} />
                <button onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); deleteLine(line.id, 'v'); }} style={{ position: 'absolute', top: 8, left: '50%', marginLeft: -8, width: 16, height: 16, border: 'none', borderRadius: '50%', background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 9, lineHeight: '16px', textAlign: 'center', cursor: 'pointer', padding: 0 }}>×</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </FullscreenOverlay>
  );
}
