import { NODE_TYPE_REGISTRY } from '../domain/nodeTypes';

function OutputHistoryPanel({ entries, isOpen, onToggle, onEntryClick }) {
  const formatTime = (date) => {
    const d = new Date(date);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  };

  const formatDate = (date) => {
    const d = new Date(date);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
      return formatTime(date);
    }
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${formatTime(date)}`;
  };

  const handleDragStart = (e, entry) => {
    const data = JSON.stringify({ _source: 'output-history', ...entry });
    e.dataTransfer.setData('text/plain', data);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const renderThumbnail = (entry) => {
    const meta = NODE_TYPE_REGISTRY[entry.nodeType] || NODE_TYPE_REGISTRY.image;
    if (entry.result?.type === 'image' && entry.result?.url) {
      return (
        <div style={{
          width: 28, height: 28, borderRadius: 4, overflow: 'hidden', flexShrink: 0,
          background: 'var(--node-bg)',
          border: '1px solid var(--panel-border)',
        }}>
          <img
            src={entry.result.url}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            draggable={false}
          />
        </div>
      );
    }
    if (entry.result?.type === 'video' && entry.result?.url) {
      return (
        <div style={{
          width: 28, height: 28, borderRadius: 4, overflow: 'hidden', flexShrink: 0,
          background: 'var(--white-10)',
          border: '1px solid var(--panel-border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-primary)' }}>
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        </div>
      );
    }
    return (
      <span style={{ color: meta.accentVar, flexShrink: 0, display: 'flex' }}>
        {meta.smallIcon}
      </span>
    );
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
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span>输出历史</span>
          {entries.length > 0 && (
            <span style={{
              fontSize: 9,
              padding: '0 6px',
              height: 16,
              borderRadius: 8,
              background: 'var(--white-10)',
              color: 'var(--text-primary)',
              display: 'inline-flex',
              alignItems: 'center',
              lineHeight: 1,
            }}>
              {entries.length}
            </span>
          )}
        </button>
      )}

      {/* Expanded panel */}
      {isOpen && (
        <div style={{
          height: 200,
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
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--sidebar-text)' }}>输出历史</span>
              <span style={{
                fontSize: 9,
                padding: '1px 6px',
                borderRadius: 6,
                background: 'var(--white-10)',
                color: 'var(--text-primary)',
                fontWeight: 600,
              }}>
                {entries.length}
              </span>
              <span style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 500, marginLeft: 4 }}>
                拖拽条目到画布复用
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
          <div style={{
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
                暂无历史输出。成功生成的素材将显示在这里。
              </div>
            ) : (
              [...entries].reverse().map((entry) => {
                const meta = NODE_TYPE_REGISTRY[entry.nodeType] || NODE_TYPE_REGISTRY.image;
                return (
                  <div
                    key={entry.id}
                    draggable="true"
                    onDragStart={(e) => handleDragStart(e, entry)}
                    onClick={() => onEntryClick && onEntryClick(entry.nodeId)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '5px 14px',
                      fontSize: 10,
                      cursor: 'grab',
                      color: 'var(--sidebar-text)',
                      transition: 'background 0.1s',
                      userSelect: 'none',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--sidebar-item-bg-hover)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    {/* Thumbnail / icon */}
                    {renderThumbnail(entry)}

                    {/* Title + prompt */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                      }}>
                        <span style={{
                          fontWeight: 600,
                          fontSize: 10,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {entry.title || meta.title}
                        </span>
                        <span style={{
                          fontSize: 8,
                          padding: '0 4px',
                          height: 14,
                          borderRadius: 3,
                          background: 'var(--accent-soft)',
                          color: 'var(--accent)',
                          fontWeight: 600,
                          display: 'inline-flex',
                          alignItems: 'center',
                          lineHeight: 1,
                          flexShrink: 0,
                        }}>
                          {meta.title}
                        </span>
                      </div>
                      {entry.prompt && (
                        <div style={{
                          fontSize: 9,
                          color: 'var(--text-tertiary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          marginTop: 1,
                        }}>
                          {entry.prompt}
                        </div>
                      )}
                    </div>

                    {/* Timestamp */}
                    <span style={{
                      fontSize: 9,
                      fontFamily: 'ui-monospace, monospace',
                      color: 'var(--text-tertiary)',
                      flexShrink: 0,
                    }}>
                      {formatDate(entry.timestamp)}
                    </span>

                    {/* Drag indicator */}
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}>
                      <circle cx="12" cy="12" r="1" />
                      <circle cx="12" cy="5" r="1" />
                      <circle cx="12" cy="19" r="1" />
                    </svg>
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

export default OutputHistoryPanel;
