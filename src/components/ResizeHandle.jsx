import { useRef, useCallback, useEffect } from 'react';
import { useViewport } from '@xyflow/react';
import { computeResizeDimensions } from '../utils/nodeResize';

export default function ResizeHandle({ nodeId, type, width, height, aspectRatio = 1.778, defaultWidth = 150, defaultHeight = 150, onResize, isVisible }) {
  const viewport = useViewport();
  const dragRef = useRef(null);
  const handleRef = useRef(null);

  // Prevent d3-drag (used by React Flow) from intercepting mousedown/touchstart
  // on the resize handle. Native listeners fire before React's synthetic events
  // and before d3-drag's listeners on parent elements.
  useEffect(() => {
    const el = handleRef.current;
    if (!el) return;
    const stopProp = (e) => e.stopPropagation();
    el.addEventListener('mousedown', stopProp);
    el.addEventListener('touchstart', stopProp);
    return () => {
      el.removeEventListener('mousedown', stopProp);
      el.removeEventListener('touchstart', stopProp);
    };
  }, []);

  const handlePointerDown = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    e.nativeEvent.stopPropagation();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    dragRef.current = {
      startWidth: width,
      startHeight: height,
      startX: e.clientX,
      startY: e.clientY,
    };
  }, [width, height]);

  const handlePointerMove = useCallback((e) => {
    if (!dragRef.current) return;
    const { startWidth, startHeight, startX, startY } = dragRef.current;
    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;
    const { width: newW, height: newH } = computeResizeDimensions(
      type, startWidth, startHeight, deltaX, deltaY, aspectRatio, viewport.zoom, defaultWidth, defaultHeight
    );
    onResize(nodeId, newW, newH);
  }, [type, aspectRatio, viewport.zoom, onResize, nodeId, defaultWidth, defaultHeight]);

  const handlePointerUp = useCallback((e) => {
    if (dragRef.current) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      dragRef.current = null;
    }
  }, []);

  if (!isVisible) return null;

  return (
    <div
      ref={handleRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        position: 'absolute',
        right: 0,
        bottom: 0,
        width: 22,
        height: 22,
        cursor: 'nwse-resize',
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '0 0 16px 0',
        background: 'rgba(255,255,255,0.08)',
        backdropFilter: 'blur(4px)',
        opacity: 0.7,
        transition: 'opacity 0.15s var(--ease-out)',
        touchAction: 'none',
      }}
    >
      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ color: 'rgba(255,255,255,0.6)' }}>
        <line x1="9" y1="12" x2="12" y2="9" />
        <line x1="6" y1="12" x2="12" y2="6" />
        <line x1="3" y1="12" x2="12" y2="3" />
      </svg>
    </div>
  );
}
