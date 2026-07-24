import { useState, useRef, useCallback, useEffect } from 'react';
import FullscreenOverlay from './FullscreenOverlay';

const ASPECTS = [
  { key: 'free', label: '自由', ratio: null },
  { key: '1:1', label: '1:1', ratio: 1 },
  { key: '4:3', label: '4:3', ratio: 4 / 3 },
  { key: '16:9', label: '16:9', ratio: 16 / 9 },
  { key: '3:4', label: '3:4', ratio: 3 / 4 },
  { key: '9:16', label: '9:16', ratio: 9 / 16 },
];

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

/**
 * Given a crop rect {x,y,w,h} (display pixels), apply the current aspect ratio
 * constraint by adjusting width based on height (or vice versa) anchored at center.
 */
function applyAspectRatio(rect, ratio, displayW, displayH) {
  if (!ratio) return rect;
  let { x, y, w, h } = rect;
  const newH = w / ratio;
  if (newH > h) {
    h = newH;
    if (h > displayH) { h = displayH; w = h * ratio; }
  } else {
    w = h * ratio;
    if (w > displayW) { w = displayW; h = w / ratio; }
  }
  x = clamp(x, 0, displayW - w);
  y = clamp(y, 0, displayH - h);
  return { x, y, w, h };
}

const HANDLE_SIZE = 10;

export default function CropEditor({ isOpen, imageUrl, onClose, onSave }) {
  const imgRef = useRef(null);
  const containerRef = useRef(null);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [crop, setCrop] = useState(null); // { x, y, w, h } display pixels
  const [mode, setMode] = useState('idle'); // idle | creating | moving | resizing
  const [activeHandle, setActiveHandle] = useState(null);
  const [aspect, setAspect] = useState('free');
  const dragRef = useRef({ startX: 0, startY: 0, startCrop: null });

  const ratio = ASPECTS.find((a) => a.key === aspect).ratio;

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setCrop(null);
      setMode('idle');
      setAspect('free');
    }
  }, [isOpen]);

  const getDisplayRect = useCallback(() => {
    const c = containerRef.current;
    if (!c) return { w: 0, h: 0 };
    return { w: c.clientWidth, h: c.clientHeight };
  }, []);

  const handleImgLoad = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
  }, []);

  // Mouse down on image — create or move
  const handleMouseDown = useCallback(
    (e) => {
      if (e.button !== 0) return;
      const rect = containerRef.current.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (!crop) {
        // Start creating
        setMode('creating');
        dragRef.current = { startX: mx, startY: my };
        setCrop({ x: mx, y: my, w: 0, h: 0 });
        return;
      }

      // Check if clicking a handle
      const hs = getHandles(crop);
      for (const h of hs) {
        if (mx >= h.x && mx <= h.x + h.w && my >= h.y && my <= h.y + h.h) {
          setMode('resizing');
          setActiveHandle(h.id);
          dragRef.current = { startX: mx, startY: my, startCrop: { ...crop } };
          return;
        }
      }

      // Check if inside crop rect
      if (mx >= crop.x && mx <= crop.x + crop.w && my >= crop.y && my <= crop.y + crop.h) {
        setMode('moving');
        dragRef.current = { startX: mx, startY: my, startCrop: { ...crop } };
      }
    },
    [crop],
  );

  const handleMouseMove = useCallback(
    (e) => {
      if (mode === 'idle') return;
      const rect = containerRef.current.getBoundingClientRect();
      const mx = clamp(e.clientX - rect.left, 0, rect.width);
      const my = clamp(e.clientY - rect.top, 0, rect.height);
      const { startX, startY, startCrop } = dragRef.current;

      if (mode === 'creating') {
        let x = Math.min(startX, mx);
        let y = Math.min(startY, my);
        let w = Math.abs(mx - startX);
        let h = Math.abs(my - startY);
        if (ratio) {
          h = w / ratio;
          if (y + h > rect.height) { h = rect.height - y; w = h * ratio; }
        }
        setCrop({ x: clamp(x, 0, rect.width - w), y: clamp(y, 0, rect.height - h), w, h });
        return;
      }

      if (mode === 'moving' && startCrop) {
        const dx = mx - startX;
        const dy = my - startY;
        let nx = clamp(startCrop.x + dx, 0, rect.width - startCrop.w);
        let ny = clamp(startCrop.y + dy, 0, rect.height - startCrop.h);
        setCrop({ ...startCrop, x: nx, y: ny });
        return;
      }

      if (mode === 'resizing' && startCrop) {
        const dx = mx - startX;
        const dy = my - startY;
        let nc = { ...startCrop };

        if (activeHandle.includes('e')) nc.w = clamp(startCrop.w + dx, 40, rect.width - startCrop.x);
        if (activeHandle.includes('w')) { nc.x = startCrop.x + dx; nc.w = clamp(startCrop.w - dx, 40, startCrop.x + startCrop.w); if (nc.x < 0) { nc.w += nc.x; nc.x = 0; } }
        if (activeHandle.includes('s')) nc.h = clamp(startCrop.h + dy, 40, rect.height - startCrop.y);
        if (activeHandle.includes('n')) { nc.y = startCrop.y + dy; nc.h = clamp(startCrop.h - dy, 40, startCrop.y + startCrop.h); if (nc.y < 0) { nc.h += nc.y; nc.y = 0; } }

        if (ratio) {
          const constrained = applyAspectRatio(nc, ratio, rect.width, rect.height);
          // Apply with pivot based on which handle is active
          if (activeHandle === 'se' || activeHandle === 'e') {
            nc.h = nc.w / ratio;
            if (nc.y + nc.h > rect.height) { nc.h = rect.height - nc.y; nc.w = nc.h * ratio; }
          } else if (activeHandle === 'sw' || activeHandle === 'w') {
            nc.h = nc.w / ratio;
            if (nc.y + nc.h > rect.height) { nc.h = rect.height - nc.y; nc.w = nc.h * ratio; nc.x = startCrop.x + startCrop.w - nc.w; }
          } else if (activeHandle === 'ne' || activeHandle === 'e') {
            nc.h = nc.w / ratio;
            nc.y = startCrop.y + startCrop.h - nc.h;
          } else if (activeHandle === 'nw' || activeHandle === 'w') {
            nc.h = nc.w / ratio;
            nc.y = startCrop.y + startCrop.h - nc.h;
            nc.x = startCrop.x + startCrop.w - nc.w;
          }
          nc.w = clamp(nc.w, 40, rect.width);
          nc.h = clamp(nc.h, 40, rect.height);
          nc.x = clamp(nc.x, 0, rect.width - nc.w);
          nc.y = clamp(nc.y, 0, rect.height - nc.h);
        }

        setCrop(nc);
      }
    },
    [mode, ratio],
  );

  const handleMouseUp = useCallback(() => {
    if (mode === 'creating' && crop && (crop.w < 5 || crop.h < 5)) {
      setCrop(null);
    }
    setMode('idle');
    setActiveHandle(null);
  }, [mode, crop]);

  // Attach document-level move/up handlers
  useEffect(() => {
    if (mode === 'idle') return;
    const onMove = (e) => handleMouseMove(e);
    const onUp = () => handleMouseUp();
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [mode, handleMouseMove, handleMouseUp]);

  const handleAspectChange = useCallback(
    (key) => {
      setAspect(key);
      if (!crop || crop.w < 1) return;
      const newRatio = ASPECTS.find((a) => a.key === key).ratio;
      if (newRatio) {
        setCrop(applyAspectRatio(crop, newRatio, imgSize.w, imgSize.h));
      }
    },
    [crop, imgSize],
  );

  const handleConfirm = useCallback(async () => {
    const img = imgRef.current;
    if (!img || !crop || crop.w < 1 || crop.h < 1) return;

    // Convert display crop coords to natural image coords
    const displayW = containerRef.current.clientWidth;
    const displayH = containerRef.current.clientHeight;
    const scaleX = img.naturalWidth / displayW;
    const scaleY = img.naturalHeight / displayH;

    const sx = Math.round(crop.x * scaleX);
    const sy = Math.round(crop.y * scaleY);
    const sw = Math.round(crop.w * scaleX);
    const sh = Math.round(crop.h * scaleY);

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

    const dataUrl = canvas.toDataURL('image/png');
    onSave(dataUrl, { width: sw, height: sh });
    onClose();
  }, [crop, onSave, onClose]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter' && crop) handleConfirm();
    },
    [crop, handleConfirm],
  );

  return (
    <FullscreenOverlay isOpen={isOpen} onClose={onClose}>
      <div
        className="crop-editor"
        onKeyDown={handleKeyDown}
        tabIndex={-1}
        ref={(el) => {
          if (el) el.focus();
        }}
      >
        {/* Toolbar */}
        <div className="crop-toolbar">
          <button className="crop-toolbar-btn" onClick={onClose} title="取消">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <div className="crop-toolbar-divider" />
          {ASPECTS.map((a) => (
            <button
              key={a.key}
              className={`crop-aspect-btn${aspect === a.key ? ' active' : ''}`}
              onClick={() => handleAspectChange(a.key)}
            >
              {a.label}
            </button>
          ))}
          <div className="crop-toolbar-spacer" />
          <button
            className="crop-confirm-btn"
            onClick={handleConfirm}
            disabled={!crop || crop.w < 1}
            title="确认裁切 (Enter)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>确认</span>
          </button>
        </div>

        {/* Image + crop overlay */}
        <div
          className="crop-stage" style={{ position: 'relative', overflow: 'hidden', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.06)' }}
        >
          <div
            ref={containerRef}
            className="crop-image-wrap"
            onMouseDown={handleMouseDown}
            style={{ position: 'relative', maxWidth: '90vw', maxHeight: 'calc(90vh - 60px)', display: 'inline-block', userSelect: 'none' }}
          >
            <img
              ref={imgRef}
              src={imageUrl}
              alt="裁切预览"
              onLoad={handleImgLoad}
              style={{ display: 'block', maxWidth: '90vw', maxHeight: 'calc(90vh - 60px)', objectFit: 'contain' }}
              draggable={false}
            />
            {crop && crop.w > 0 && crop.h > 0 && (
              <>
                {/* Shaded overlay */}
                <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                  <defs>
                    <mask id="cropMask">
                      <rect width="100%" height="100%" fill="white" />
                      <rect x={crop.x} y={crop.y} width={crop.w} height={crop.h} fill="black" />
                    </mask>
                  </defs>
                  <rect width="100%" height="100%" fill="rgba(0,0,0,0.45)" mask="url(#cropMask)" />
                </svg>
                {/* Crop border */}
                <div style={{
                  position: 'absolute', left: crop.x, top: crop.y, width: crop.w, height: crop.h,
                  border: '1.5px solid white', boxShadow: '0 0 0 1px rgba(0,0,0,0.15), inset 0 0 0 1px rgba(0,0,0,0.15)',
                  pointerEvents: 'none', boxSizing: 'border-box',
                }} />
                {/* Corner handles */}
                {['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'].map((h) => {
                  const pos = getHandlePos(crop, h);
                  return (
                    <div key={h} style={{
                      position: 'absolute', left: pos.x, top: pos.y, width: HANDLE_SIZE, height: HANDLE_SIZE,
                      marginLeft: -HANDLE_SIZE / 2, marginTop: -HANDLE_SIZE / 2,
                      background: 'white', border: '1px solid rgba(0,0,0,0.2)', borderRadius: 2,
                      cursor: ({ nw: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', se: 'nwse-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' })[h],
                    }} />
                  );
                })}
              </>
            )}
            {/* Cursor hint */}
            {!crop && (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                pointerEvents: 'none', color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: 600,
              }}>
                在图片上拖拽选择裁切区域
              </div>
            )}
          </div>
        </div>
      </div>
    </FullscreenOverlay>
  );
}

function getHandles(c) {
  const hs = [];
  const add = (id, x, y) => hs.push({ id, x, y, w: HANDLE_SIZE, h: HANDLE_SIZE });
  add('nw', c.x - HANDLE_SIZE / 2, c.y - HANDLE_SIZE / 2);
  add('ne', c.x + c.w - HANDLE_SIZE / 2, c.y - HANDLE_SIZE / 2);
  add('sw', c.x - HANDLE_SIZE / 2, c.y + c.h - HANDLE_SIZE / 2);
  add('se', c.x + c.w - HANDLE_SIZE / 2, c.y + c.h - HANDLE_SIZE / 2);
  add('n', c.x + c.w / 2 - HANDLE_SIZE / 2, c.y - HANDLE_SIZE / 2);
  add('s', c.x + c.w / 2 - HANDLE_SIZE / 2, c.y + c.h - HANDLE_SIZE / 2);
  add('e', c.x + c.w - HANDLE_SIZE / 2, c.y + c.h / 2 - HANDLE_SIZE / 2);
  add('w', c.x - HANDLE_SIZE / 2, c.y + c.h / 2 - HANDLE_SIZE / 2);
  return hs;
}

function getHandlePos(c, id) {
  switch (id) {
    case 'nw': return { x: c.x, y: c.y };
    case 'ne': return { x: c.x + c.w, y: c.y };
    case 'sw': return { x: c.x, y: c.y + c.h };
    case 'se': return { x: c.x + c.w, y: c.y + c.h };
    case 'n': return { x: c.x + c.w / 2, y: c.y };
    case 's': return { x: c.x + c.w / 2, y: c.y + c.h };
    case 'e': return { x: c.x + c.w, y: c.y + c.h / 2 };
    case 'w': return { x: c.x, y: c.y + c.h / 2 };
    default: return { x: 0, y: 0 };
  }
}
