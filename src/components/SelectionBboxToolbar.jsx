import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useViewport } from '@xyflow/react';

/* ── Inline SVG Icons ── */
const ArrangeIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="1" width="5" height="5" rx="1" />
    <rect x="8" y="1" width="5" height="5" rx="1" />
    <rect x="1" y="8" width="5" height="5" rx="1" />
    <rect x="8" y="8" width="5" height="5" rx="1" />
  </svg>
);

const ChevronDownIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.5 3.5L5 6.5L7.5 3.5" />
  </svg>
);

const GroupIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1.5" y="1.5" width="5" height="5" rx="1" />
    <rect x="7.5" y="1.5" width="5" height="5" rx="1" />
    <rect x="1.5" y="7.5" width="5" height="5" rx="1" />
    <rect x="7.5" y="7.5" width="5" height="5" rx="1" />
    <path d="M4 6.5V11.5M10 6.5V11.5M4 12H10" strokeDasharray="2 1" />
  </svg>
);

const UngroupIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1.5" y="1.5" width="5" height="5" rx="1" />
    <rect x="7.5" y="1.5" width="5" height="5" rx="1" />
    <rect x="1.5" y="7.5" width="5" height="5" rx="1" />
    <rect x="7.5" y="7.5" width="5" height="5" rx="1" />
    <path d="M4 6V8M10 6V8M4 12H10" strokeDasharray="2 1" />
  </svg>
);

function computeToolbarPosition(bbox, viewport) {
  if (!bbox) return null;
  const { minX, minY, maxX, maxY } = bbox;
  const zoom = viewport.zoom;
  const tx = viewport.x;
  const ty = viewport.y;

  const screenLeft = minX * zoom + tx;
  const screenTop = minY * zoom + ty;
  const screenRight = maxX * zoom + tx;
  const screenBottom = maxY * zoom + ty;
  const centerX = (screenLeft + screenRight) / 2;

  const gap = 0;
  const toolbarH = 42;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const margin = 8;

  const wouldOverflowTop = screenTop - toolbarH - gap < margin;
  const placement = wouldOverflowTop ? 'bottom' : 'top';

  if (placement === 'top') {
    return {
      left: centerX,
      bottom: vh - screenTop + gap,
      placement,
    };
  }
  return {
    left: centerX,
    top: Math.min(screenBottom + gap, vh - toolbarH - margin),
    placement,
  };
}

const ARRANGE_ITEMS = [
  { key: 'grid', label: '宫格排列' },
  { key: 'horizontal', label: '水平排列' },
  { key: 'vertical', label: '垂直排列' },
];

export default function SelectionBboxToolbar({ bbox, onArrange, onGroup, onUngroup }) {
  const viewport = useViewport();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  const position = useMemo(
    () => computeToolbarPosition(bbox, viewport),
    [bbox, viewport]
  );

  // Close menu on click outside
  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick, true);
    return () => document.removeEventListener('mousedown', handleClick, true);
  }, [menuOpen]);

  const handleArrangeClick = useCallback((key) => {
    setMenuOpen(false);
    onArrange?.(key);
  }, [onArrange]);

  if (!position) return null;

  const isGroupSelected = bbox.hasGroup;
  const arrangeLabel = '排列';

  return (
    <div className={`bbox-toolbar bbox-toolbar-${position.placement}`} style={position}>
      <span className="bbox-toolbar-count">{bbox.count} 个节点</span>
      <div className="bbox-toolbar-divider" />
      {/* Arrange button with submenu */}
      <div className="bbox-toolbar-arrange-wrap" ref={menuRef}>
        <button
          className="bbox-toolbar-btn bbox-toolbar-btn-label"
          title="排列"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <ArrangeIcon />
          <span className="bbox-toolbar-btn-label-text">{arrangeLabel}</span>
          <ChevronDownIcon />
        </button>
        {menuOpen && (
          <div className="bbox-toolbar-submenu">
            {ARRANGE_ITEMS.map((item) => (
              <button
                key={item.key}
                className="bbox-toolbar-submenu-item"
                onClick={() => handleArrangeClick(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="bbox-toolbar-divider" />
      {/* Group / Ungroup toggle */}
      <button
        className="bbox-toolbar-btn bbox-toolbar-btn-label"
        title={isGroupSelected ? '取消打组' : '打组'}
        onClick={isGroupSelected ? onUngroup : onGroup}
      >
        {isGroupSelected ? <UngroupIcon /> : <GroupIcon />}
        <span className="bbox-toolbar-btn-label-text">
          {isGroupSelected ? '解组' : '打组'}
        </span>
      </button>
    </div>
  );
}
