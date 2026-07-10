import { useState } from 'react';
import { useTheme } from '../ThemeContext';

function Sidebar({ toggleTheme, onOpenProjectSelector, canUndo, canRedo, onUndo, onRedo, onOpenSettings, showMinimap, onToggleMinimap, historyOpen, onToggleHistory, historyEntryCount }) {
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
      <button
        onClick={onOpenProjectSelector}
        style={{ ...getItemStyle(hoveredItem === 'projects') }}
        onMouseEnter={() => setHoveredItem('projects')}
        onMouseLeave={() => setHoveredItem(null)}
        aria-label="项目管理"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        <span style={{ ...tooltipStyle, opacity: hoveredItem === 'projects' ? 1 : 0, transform: `translateY(-50%) ${hoveredItem === 'projects' ? 'translateX(4px)' : ''}` }}>项目管理</span>
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
        onClick={onOpenSettings}
        style={{ ...getItemStyle(hoveredItem === 'settings') }}
        onMouseEnter={() => setHoveredItem('settings')}
        onMouseLeave={() => setHoveredItem(null)}
        aria-label="设置"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        <span style={{ ...tooltipStyle, opacity: hoveredItem === 'settings' ? 1 : 0, transform: `translateY(-50%) ${hoveredItem === 'settings' ? 'translateX(4px)' : ''}` }}>设置</span>
      </button>

      <div style={dividerStyle}></div>

      <button
        onClick={onToggleHistory}
        style={{ ...getItemStyle(hoveredItem === 'history'), color: historyOpen ? 'var(--accent-strong)' : 'var(--sidebar-icon)' }}
        onMouseEnter={() => setHoveredItem('history')}
        onMouseLeave={() => setHoveredItem(null)}
        aria-label="输出历史"
      >
        <div style={{ position: 'relative', display: 'flex' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          {historyEntryCount > 0 && !historyOpen && (
            <div style={{
              position: 'absolute',
              top: -2,
              right: -3,
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--signal-live)',
              boxShadow: '0 0 4px rgba(var(--signal-live-rgb), 0.6)',
            }} />
          )}
        </div>
        <span style={{ ...tooltipStyle, opacity: hoveredItem === 'history' ? 1 : 0, transform: `translateY(-50%) ${hoveredItem === 'history' ? 'translateX(4px)' : ''}` }}>输出历史</span>
      </button>

      <div style={dividerStyle}></div>

      <div style={{ flex: 1 }} />

      <button
        onClick={onToggleMinimap}
        style={{ ...getItemStyle(hoveredItem === 'minimap'), color: showMinimap ? 'var(--accent-strong)' : 'var(--sidebar-icon)' }}
        onMouseEnter={() => setHoveredItem('minimap')}
        onMouseLeave={() => setHoveredItem(null)}
        aria-label="小地图"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="2" width="8" height="8" rx="1" />
          <rect x="14" y="2" width="8" height="8" rx="1" />
          <rect x="2" y="14" width="8" height="8" rx="1" />
          <rect x="14" y="14" width="8" height="8" rx="1" />
        </svg>
        <span style={{ ...tooltipStyle, opacity: hoveredItem === 'minimap' ? 1 : 0, transform: `translateY(-50%) ${hoveredItem === 'minimap' ? 'translateX(4px)' : ''}` }}>小地图 M</span>
      </button>

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
