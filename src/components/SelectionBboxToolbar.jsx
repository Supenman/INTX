import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useViewport } from '@xyflow/react';

const ArrangeIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="1" width="5" height="5" rx="1" />
    <rect x="8" y="1" width="5" height="5" rx="1" />
    <rect x="1" y="8" width="5" height="5" rx="1" />
    <rect x="8" y="8" width="5" height="5" rx="1" />
  </svg>
);

const ChevronDownIcon = ({ className }) => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
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

  const screenTop = minY * zoom + ty;
  const screenBottom = maxY * zoom + ty;
  const centerX = (minX * zoom + tx + maxX * zoom + tx) / 2;

  const gap = 6;
  const toolbarH = 42;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const margin = 8;

  const wouldOverflowTop = screenTop - toolbarH - gap < margin;
  const placement = wouldOverflowTop ? 'bottom' : 'top';

  if (placement === 'top') {
    return { left: centerX, bottom: vh - screenTop + gap, placement };
  }
  return { left: centerX, top: Math.min(screenBottom + gap, vh - toolbarH - margin), placement };
}

const GROUP_BG_COLORS = [
  'rgba(142,142,147,0.35)', 'rgba(74,120,200,0.35)', 'rgba(90,154,90,0.35)', 'rgba(138,92,184,0.35)', 'rgba(154,118,71,0.35)',
  'rgba(184,90,138,0.35)', 'rgba(166,74,74,0.35)', 'rgba(138,138,74,0.35)', 'rgba(74,138,138,0.35)', 'rgba(122,90,58,0.35)',
];

const ARRANGE_ITEMS = [
  { key: 'grid', label: '宫格排列' },
  { key: 'horizontal', label: '水平排列' },
  { key: 'vertical', label: '垂直排列' },
];

export default function SelectionBboxToolbar({ bbox, onArrange, onGroup, onUngroup, onGroupBgColorChange }) {
  const viewport = useViewport();
  const [menuOpen, setMenuOpen] = useState(false);
  const [colorMenuOpen, setColorMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const colorMenuRef = useRef(null);

  const position = useMemo(
    () => computeToolbarPosition(bbox, viewport),
    [bbox, viewport]
  );

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

  useEffect(() => {
    if (!colorMenuOpen) return;
    const handleClick = (e) => {
      if (colorMenuRef.current && !colorMenuRef.current.contains(e.target)) {
        setColorMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick, true);
    return () => document.removeEventListener('mousedown', handleClick, true);
  }, [colorMenuOpen]);

  const handleArrangeClick = useCallback((key) => {
    setMenuOpen(false);
    onArrange?.(key);
  }, [onArrange]);

  if (!position) return null;

  const hasGroup = bbox.hasGroup;
  const showGroupBtn = hasGroup || bbox.count >= 2;
  const groupLabel = hasGroup ? '解组' : '打组';
  const groupTitle = hasGroup ? '取消打组' : '打组';
  const groupHandler = hasGroup ? onUngroup : onGroup;

  return (
    <div className={`bbox-toolbar bbox-toolbar-${position.placement}`} style={position}>
      <div className="bbox-toolbar-arrange-wrap" ref={menuRef}>
        <button
          className="bbox-toolbar-btn bbox-toolbar-btn-label"
          title="排列"
          onClick={() => { setMenuOpen((v) => !v); setColorMenuOpen(false); }}
        >
          <ArrangeIcon />
          <span className="bbox-toolbar-btn-label-text">排列</span>
          <ChevronDownIcon className={menuOpen ? 'chevron-up' : ''} />
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
      {showGroupBtn && (
        <>
          <div className="bbox-toolbar-divider" />
          <button
            className="bbox-toolbar-btn bbox-toolbar-btn-label"
            title={groupTitle}
            onClick={() => groupHandler?.()}
          >
            {hasGroup ? <UngroupIcon /> : <GroupIcon />}
            <span className="bbox-toolbar-btn-label-text">{groupLabel}</span>
          </button>
        </>
      )}
      {hasGroup && onGroupBgColorChange && (
        <>
          <div className="bbox-toolbar-divider" />
          <div className="bbox-toolbar-arrange-wrap" ref={colorMenuRef}>
            <button
              className="bbox-toolbar-btn bbox-toolbar-btn-swatch"
              title="组背景色"
              onClick={() => { setColorMenuOpen((v) => !v); setMenuOpen(false); }}
            >
              <span
                className={`bbox-toolbar-current-swatch${bbox.groupBgColor ? '' : ' unset'}`}
                style={bbox.groupBgColor ? { background: bbox.groupBgColor } : undefined}
              />
              <ChevronDownIcon className={colorMenuOpen ? 'chevron-up' : ''} />
            </button>
            {colorMenuOpen && (
              <div className="bbox-toolbar-submenu bbox-toolbar-submenu-colors">
                {GROUP_BG_COLORS.map((rgba) => (
                  <button
                    key={rgba}
                    className={`bbox-toolbar-color-swatch${bbox.groupBgColor === rgba ? ' active' : ''}`}
                    style={{ background: rgba }}
                    onClick={() => {
                      onGroupBgColorChange(bbox.groupId, bbox.groupBgColor === rgba ? null : rgba);
                      setColorMenuOpen(false);
                    }}
                  />
                ))}
                <div className="bbox-toolbar-color-clear-wrap">
                  <button
                    className="bbox-toolbar-color-clear"
                    onClick={() => {
                      onGroupBgColorChange(bbox.groupId, null);
                      setColorMenuOpen(false);
                    }}
                  >
                    清除背景色
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
