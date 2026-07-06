import { useState } from 'react';
import { useTheme } from '../ThemeContext';

function Sidebar({ onAddNodeClick, addButtonRef, toggleTheme, onNewCanvas, canUndo, canRedo, onUndo, onRedo, onOpenApiSettings }) {
  const [hoveredItem, setHoveredItem] = useState(null);
  const { isDark } = useTheme();

  const themeIcon = isDark ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );

  return (
    <nav style={sidebarStyle} aria-label="BeastTV 工具栏">
      <div style={brandStyle} aria-hidden="true">
        <span style={brandSignalStyle} />
        <span style={brandTextStyle}>BTV</span>
      </div>

      <button
        ref={addButtonRef}
        onClick={onAddNodeClick}
        style={{ ...getItemStyle(hoveredItem === 'add'), color: 'var(--accent-strong)' }}
        onMouseEnter={() => setHoveredItem('add')}
        onMouseLeave={() => setHoveredItem(null)}
        aria-label="添加节点"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        <span style={{ ...tooltipStyle, opacity: hoveredItem === 'add' ? 1 : 0, transform: `translateY(-50%) ${hoveredItem === 'add' ? 'translateX(4px)' : ''}` }}>添加节点</span>
      </button>

      <div style={dividerStyle}></div>

      <button
        onClick={onNewCanvas}
        style={{ ...getItemStyle(hoveredItem === 'new') }}
        onMouseEnter={() => setHoveredItem('new')}
        onMouseLeave={() => setHoveredItem(null)}
        aria-label="新建画布"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="12" y1="18" x2="12" y2="12" />
          <line x1="9" y1="15" x2="15" y2="15" />
        </svg>
        <span style={{ ...tooltipStyle, opacity: hoveredItem === 'new' ? 1 : 0, transform: `translateY(-50%) ${hoveredItem === 'new' ? 'translateX(4px)' : ''}` }}>新建画布</span>
      </button>

      <div style={dividerStyle}></div>

      <button
        onClick={onUndo}
        disabled={!canUndo}
        style={{ ...getItemStyle(hoveredItem === 'undo'), opacity: canUndo ? 1 : 0.25, cursor: canUndo ? 'pointer' : 'default' }}
        onMouseEnter={() => setHoveredItem('undo')}
        onMouseLeave={() => setHoveredItem(null)}
        aria-label="撤销"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="1 4 1 10 7 10" />
          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
        </svg>
        <span style={{ ...tooltipStyle, opacity: hoveredItem === 'undo' ? 1 : 0, transform: `translateY(-50%) ${hoveredItem === 'undo' ? 'translateX(4px)' : ''}` }}>撤销 Ctrl+Z</span>
      </button>

      <button
        onClick={onRedo}
        disabled={!canRedo}
        style={{ ...getItemStyle(hoveredItem === 'redo'), opacity: canRedo ? 1 : 0.25, cursor: canRedo ? 'pointer' : 'default' }}
        onMouseEnter={() => setHoveredItem('redo')}
        onMouseLeave={() => setHoveredItem(null)}
        aria-label="重做"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
        <span style={{ ...tooltipStyle, opacity: hoveredItem === 'redo' ? 1 : 0, transform: `translateY(-50%) ${hoveredItem === 'redo' ? 'translateX(4px)' : ''}` }}>重做 Ctrl+Y</span>
      </button>

      <div style={dividerStyle}></div>

      <button
        onClick={onOpenApiSettings}
        style={{ ...getItemStyle(hoveredItem === 'api') }}
        onMouseEnter={() => setHoveredItem('api')}
        onMouseLeave={() => setHoveredItem(null)}
        aria-label="API 设置"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </svg>
        <span style={{ ...tooltipStyle, opacity: hoveredItem === 'api' ? 1 : 0, transform: `translateY(-50%) ${hoveredItem === 'api' ? 'translateX(4px)' : ''}` }}>API 设置</span>
      </button>

      <div style={{ flex: 1 }} />

      <button
        onClick={toggleTheme}
        style={{ ...getItemStyle(hoveredItem === 'theme') }}
        onMouseEnter={() => setHoveredItem('theme')}
        onMouseLeave={() => setHoveredItem(null)}
        aria-label="切换主题"
      >
        {themeIcon}
        <span style={{ ...tooltipStyle, opacity: hoveredItem === 'theme' ? 1 : 0, transform: `translateY(-50%) ${hoveredItem === 'theme' ? 'translateX(4px)' : ''}` }}>切换主题</span>
      </button>
    </nav>
  );
}

const sidebarStyle = {
  position: 'fixed',
  left: 12,
  top: '50%',
  transform: 'translateY(-50%)',
  zIndex: 200,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  padding: '8px 6px',
  background: 'var(--sidebar-bg)',
  backdropFilter: 'var(--panel-blur)',
  border: '1px solid var(--sidebar-border)',
  borderRadius: 14,
  boxShadow: 'var(--panel-shadow)',
  gap: 2,
  minWidth: 46,
  transition: 'all 0.3s var(--ease-out)',
};

const brandStyle = {
  width: 38,
  minHeight: 36,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  marginBottom: 2,
  borderRadius: 10,
  background: 'var(--accent-soft)',
  border: '1px solid var(--panel-border)',
};

const brandSignalStyle = {
  width: 14,
  height: 2.5,
  borderRadius: 99,
  background: 'linear-gradient(90deg, var(--signal-image), var(--signal-text), var(--signal-video))',
  boxShadow: '0 0 8px rgba(124, 107, 246, 0.20)',
};

const brandTextStyle = {
  fontSize: 8,
  fontWeight: 800,
  letterSpacing: '0.06em',
  color: 'var(--sidebar-text)',
};

const dividerStyle = {
  width: 24,
  height: 1,
  background: 'linear-gradient(90deg, transparent, var(--sidebar-border), transparent)',
  margin: '4px 0',
};

const getItemStyle = (isHovered) => ({
  position: 'relative',
  width: 38,
  height: 38,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 10,
  cursor: 'pointer',
  transition: 'all 0.2s var(--ease-out)',
  color: 'var(--sidebar-icon)',
  background: isHovered ? 'var(--sidebar-item-bg-hover)' : 'transparent',
  border: '1px solid transparent',
  outline: 'none',
  transform: isHovered ? 'translateX(2px)' : 'translateX(0)',
  boxShadow: isHovered ? '0 6px 16px rgba(0, 0, 0, 0.18)' : 'none',
});

const tooltipStyle = {
  position: 'absolute',
  left: 'calc(100% + 12px)',
  top: '50%',
  transform: 'translateY(-50%)',
  background: 'var(--panel-bg-strong)',
  color: 'var(--sidebar-text)',
  padding: '7px 11px',
  borderRadius: 8,
  fontSize: 11,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  opacity: 0,
  pointerEvents: 'none',
  boxShadow: 'var(--panel-shadow)',
  border: '1px solid var(--sidebar-border)',
  transition: 'all 0.18s var(--ease-out)',
  zIndex: 1000,
};

export default Sidebar;
