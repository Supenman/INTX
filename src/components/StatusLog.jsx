import { useRef, useEffect } from 'react';
import { NODE_TYPE_REGISTRY } from '../domain/nodeTypes';

function StatusLog({ entries, isOpen, onToggle, onEntryClick }) {
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  const getStatusStyle = (status) => {
    switch (status) {
      case 'processing':
        return { label: 'Processing', color: 'var(--accent)', bg: 'var(--accent-soft)', dot: 'var(--accent)' };
      case 'succeeded':
        return { label: 'Succeeded', color: 'var(--signal-live)', bg: 'rgba(var(--signal-live-rgb), 0.10)', dot: 'var(--signal-live)' };
      case 'failed':
        return { label: 'Failed', color: 'var(--signal-error)', bg: 'rgba(var(--signal-error-rgb), 0.10)', dot: 'var(--signal-error)' };
      default:
        return { label: 'Queued', color: 'var(--text-tertiary)', bg: 'rgba(255,255,255,0.04)', dot: 'var(--text-tertiary)' };
    }
  };

  const statusIcon = (status) => {
    if (status === 'processing') {
      return (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 0.8s linear infinite' }}>
          <line x1="12" y1="2" x2="12" y2="6" />
          <line x1="12" y1="18" x2="12" y2="22" />
          <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
          <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
        </svg>
      );
    }
    if (status === 'succeeded') {
      return (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      );
    }
    if (status === 'failed') {
      return (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      );
    }
    return (
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--text-tertiary)' }} />
    );
  };

  const formatTime = (date) => {
    const d = new Date(date);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  };

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 150,
      animation: 'fadeIn 0.2s var(--ease-out)',
    }}>
      {/* Collapsed bar */}
      {!isOpen && (
        <button
          onClick={onToggle}
          style={{
            width: '100%',
            height: 30,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '0 14px',
            background: 'var(--panel-bg-strong)',
            backdropFilter: 'var(--panel-blur)',
            border: 'none',
            borderTop: '1px solid var(--panel-border)',
            cursor: 'pointer',
            fontSize: 10,
            fontWeight: 600,
            color: 'var(--text-tertiary)',
            transition: 'color 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--sidebar-text)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: 'rotate(180deg)' }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
          <span>Status Log</span>
          {entries.length > 0 && (
            <span style={{
              fontSize: 9,
              padding: '0 6px',
              height: 16,
              borderRadius: 8,
              background: 'rgba(var(--signal-live-rgb), 0.12)',
              color: 'var(--signal-live)',
              display: 'inline-flex',
              alignItems: 'center',
              lineHeight: 1,
            }}>
              {entries.length}
            </span>
          )}
          {entries.some(e => e.status === 'processing') && (
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', animation: 'pulse 1.5s ease-in-out infinite' }} />
          )}
        </button>
      )}

      {/* Expanded panel */}
      {isOpen && (
        <div style={{
          height: 180,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--panel-bg-strong)',
          backdropFilter: 'var(--panel-blur)',
          borderTop: '1px solid var(--panel-border)',
          boxShadow: '0 -4px 20px rgba(0,0,0,0.10)',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 14px',
            borderBottom: '1px solid var(--panel-border)',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--sidebar-text)' }}>Status Log</span>
              <span style={{
                fontSize: 9,
                padding: '1px 6px',
                borderRadius: 6,
                background: 'rgba(var(--signal-live-rgb), 0.10)',
                color: 'var(--signal-live)',
                fontWeight: 600,
              }}>
                {entries.length}
              </span>
            </div>
            <button
              onClick={onToggle}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-tertiary)',
                padding: 4,
                borderRadius: 4,
                display: 'flex',
                transition: 'color 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--sidebar-text)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Entries */}
          <div ref={scrollRef} style={{
            flex: 1,
            overflowY: 'auto',
            padding: '4px 0',
          }}>
            {entries.length === 0 ? (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                fontSize: 10,
                color: 'var(--text-tertiary)',
                fontWeight: 500,
              }}>
                No entries yet. Run a node to see its status.
              </div>
            ) : (
              entries.map((entry) => {
                const meta = NODE_TYPE_REGISTRY[entry.nodeType] || NODE_TYPE_REGISTRY.image;
                const statusStyle = getStatusStyle(entry.status);
                return (
                  <div
                    key={entry.id}
                    onClick={() => onEntryClick && onEntryClick(entry.nodeId)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '5px 14px',
                      fontSize: 10,
                      cursor: 'pointer',
                      color: 'var(--sidebar-text)',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--sidebar-item-bg-hover)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    {/* Timestamp */}
                    <span style={{
                      fontSize: 9,
                      fontFamily: 'ui-monospace, monospace',
                      color: 'var(--text-tertiary)',
                      minWidth: 60,
                      flexShrink: 0,
                    }}>
                      {formatTime(entry.timestamp)}
                    </span>

                    {/* Node icon + title */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      minWidth: 0,
                      flex: 1,
                    }}>
                      <span style={{ color: meta.accentVar, flexShrink: 0 }}>{meta.smallIcon}</span>
                      <span style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontWeight: 600,
                        fontSize: 10,
                      }}>
                        {entry.nodeTitle || meta.title}
                      </span>
                    </div>

                    {/* Status badge */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '2px 7px',
                      borderRadius: 4,
                      fontSize: 9,
                      fontWeight: 600,
                      color: statusStyle.color,
                      background: statusStyle.bg,
                      flexShrink: 0,
                    }}>
                      {statusIcon(entry.status)}
                      <span>{statusStyle.label}</span>
                    </div>

                    {/* Error message */}
                    {entry.status === 'failed' && entry.message && (
                      <span style={{
                        color: 'var(--signal-error)',
                        fontSize: 9,
                        maxWidth: 200,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flexShrink: 1,
                      }}>
                        {entry.message}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default StatusLog;
