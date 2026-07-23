import { useCallback, useEffect, useRef } from 'react';

const MENU_ITEMS = [
  {
    id: 'run',
    label: '运行',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
        <polygon points="6 4 20 12 6 20 6 4" />
      </svg>
    ),
    showWhen: (context) => !context.isDisabled && !context.isProcessing,
  },
  {
    id: 'rename',
    label: '重命名',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
      </svg>
    ),
  },
  { type: 'separator' },
  {
    id: 'duplicate',
    label: '复制节点',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
    ),
  },
  {
    id: 'toggle-disable',
    label: (ctx) => ctx.isDisabled ? '启用节点' : '禁用节点',
    icon: (ctx) => ctx.isDisabled ? (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="5 3 19 12 5 21 5 3" />
      </svg>
    ) : (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
  },
  { type: 'separator' },
  {
    id: 'copy',
    label: '复制',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
    ),
  },
  {
    id: 'paste',
    label: '粘贴',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
        <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
      </svg>
    ),
    showWhen: (context) => context.hasClipboard,
  },
  { type: 'separator' },
  {
    id: 'delete',
    label: '删除',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      </svg>
    ),
    danger: true,
  },
];

function NodeContextMenu({ position, nodeId, isDisabled, isProcessing, hasClipboard, onSelect, onClose }) {
  const menuRef = useRef(null);
  const context = { isDisabled, isProcessing, hasClipboard };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const getMenuPosition = () => {
    if (!position) return { left: 0, top: 0 };
    let left = position.x;
    let top = position.y;
    const menuWidth = 170;
    const menuHeight = 240;
    const padding = 16;
    if (left + menuWidth + padding > window.innerWidth) {
      left = window.innerWidth - menuWidth - padding;
    }
    if (top + menuHeight + padding > window.innerHeight) {
      top = window.innerHeight - menuHeight - padding;
    }
    return { left, top };
  };

  const menuPosition = getMenuPosition();

  const handleItemClick = useCallback((e, actionId) => {
    e.stopPropagation();
    onSelect(actionId, nodeId);
    onClose();
  }, [onSelect, nodeId, onClose]);

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: menuPosition.left,
        top: menuPosition.top,
        zIndex: 9999,
        minWidth: 170,
        padding: 6,
        background: 'var(--panel-bg-strong)',
        backdropFilter: 'var(--panel-blur)',
        border: '1px solid var(--sidebar-border)',
        borderRadius: 12,
        boxShadow: 'var(--panel-shadow)',
        animation: 'fadeIn 0.12s var(--ease-out)',
      }}
    >
      {MENU_ITEMS.map((item, index) => {
        if (item.type === 'separator') {
          return (
            <div key={`sep-${index}`} style={{
              height: 1,
              background: 'var(--sidebar-border)',
              margin: '4px 6px',
            }} />
          );
        }

        if (item.showWhen && !item.showWhen(context)) return null;

        const label = typeof item.label === 'function' ? item.label(context) : item.label;
        const icon = typeof item.icon === 'function' ? item.icon(context) : item.icon;

        return (
          <button
            key={item.id}
            onClick={(e) => handleItemClick(e, item.id)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 10px',
              background: 'transparent',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 600,
              color: item.danger ? 'var(--text-primary)' : 'var(--sidebar-text)',
              transition: 'background 0.1s var(--ease-out)',
              textAlign: 'left',
              opacity: item.id === 'paste' && !hasClipboard ? 0.4 : 1,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--sidebar-item-bg-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
            disabled={item.id === 'paste' && !hasClipboard}
          >
            <span style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 20,
              height: 20,
              flexShrink: 0,
              color: item.danger ? 'var(--text-primary)' : 'var(--text-tertiary)',
            }}>
              {icon}
            </span>
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default NodeContextMenu;
