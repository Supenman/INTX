import { useState, useRef, useCallback, useEffect } from 'react';

export default function ZoomableImage({ src, alt }) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({ sx: 0, sy: 0, px: 0, py: 0 });

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.85 : 1.18;
    setScale((s) => Math.min(8, Math.max(1, s * delta)));
  }, []);

  const handleMouseDown = useCallback((e) => {
    if (scale <= 1) return;
    setIsDragging(true);
    dragRef.current = { sx: e.clientX, sy: e.clientY, px: position.x, py: position.y };
  }, [scale, position]);

  const handleMouseMove = useCallback((e) => {
    if (!isDragging) return;
    setPosition({
      x: dragRef.current.px + e.clientX - dragRef.current.sx,
      y: dragRef.current.py + e.clientY - dragRef.current.sy,
    });
  }, [isDragging]);

  const handleMouseUp = useCallback(() => setIsDragging(false), []);

  const reset = useCallback(() => { setScale(1); setPosition({ x: 0, y: 0 }); }, []);

  const zoomIn = useCallback(() => setScale((s) => Math.min(8, s * 1.4)), []);
  const zoomOut = useCallback(() => setScale((s) => Math.max(1, s / 1.4)), []);

  return (
    <div
      className="zi-container"
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{
        cursor: isDragging ? 'grabbing' : scale > 1 ? 'grab' : 'default',
        width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      }}
    >
      <img
        src={src} alt={alt}
        draggable={false}
        style={{
          maxWidth: '92vw', maxHeight: '92vh', objectFit: 'contain',
          transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
          transition: isDragging ? 'none' : 'transform 0.15s ease-out',
        }}
      />
      <div className="zi-controls" onMouseDown={(e) => e.stopPropagation()}>
        <button className="zi-btn" onClick={zoomOut} disabled={scale <= 1} title="缩小">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12" /></svg>
        </button>
        <button className="zi-percent" onClick={reset} title="点击复位">{Math.round(scale * 100)}%</button>
        <button className="zi-btn" onClick={zoomIn} disabled={scale >= 8} title="放大">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        </button>
      </div>
    </div>
  );
}
