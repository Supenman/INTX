import { useState, useRef, useEffect } from 'react';
import { colorVar, motion, radius } from '../styles/tokens';

const overlayStyle = {
  position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 9999, padding: '24px',
  animation: 'fadeIn 0.15s var(--ease-out)',
};

const modalStyle = {
  width: '100%', maxWidth: 460, maxHeight: '82vh',
  background: colorVar.bg, border: `1px solid ${colorVar.border}`,
  borderRadius: 16, display: 'flex', flexDirection: 'column',
  overflow: 'hidden', boxShadow: '0 16px 56px rgba(0, 0, 0, 0.28)',
};

const headerStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '16px 20px', borderBottom: `1px solid ${colorVar.border}`,
  flexShrink: 0,
};

const titleStyle = { fontSize: 15, fontWeight: 700, margin: 0, color: colorVar.text };

const closeBtnStyle = {
  width: 32, height: 32, border: 'none', borderRadius: 8,
  background: 'transparent', cursor: 'pointer', color: colorVar.textSecondary,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  transition: motion.fast,
};

const listStyle = {
  flex: 1, overflowY: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: '4px',
};

function relativeTime(ts) {
  const diff = Date.now() - ts;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

export default function ProjectSelector({ open, onClose, projects, currentProjectId, onSwitch, onCreate, onRename, onDelete }) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (creating && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [creating]);

  useEffect(() => {
    if (renamingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renamingId]);

  useEffect(() => {
    if (!open) {
      setCreating(false);
      setRenamingId(null);
      setConfirmDeleteId(null);
    }
  }, [open]);

  if (!open) return null;

  const currentName = projects.find((p) => p.id === currentProjectId)?.name || '';

  function handleCreate() {
    const name = newName.trim() || `未命名项目 ${projects.length + 1}`;
    onCreate(name);
    setCreating(false);
    setNewName('');
  }

  function handleRenameConfirm(id) {
    const name = renameValue.trim();
    if (name) onRename(id, name);
    setRenamingId(null);
    setRenameValue('');
  }

  function handleDelete(id) {
    onDelete(id);
    setConfirmDeleteId(null);
  }

  function startRename(project) {
    setRenamingId(project.id);
    setRenameValue(project.name);
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={headerStyle}>
          <h2 style={titleStyle}>项目管理</h2>
          <button style={closeBtnStyle} onClick={onClose} title="关闭">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Project list */}
        <div style={listStyle}>
          {projects.length === 0 ? (
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', gap: 8, padding: '40px 20px', color: colorVar.textSecondary, fontSize: 13,
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.3">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span>还没有项目</span>
              <span style={{ fontSize: 11, opacity: 0.7 }}>点击下方按钮创建第一个项目</span>
            </div>
          ) : (
            projects.map((p) => {
              const isCurrent = p.id === currentProjectId;
              const isRenaming = renamingId === p.id;
              const isDeleting = confirmDeleteId === p.id;

              return (
                <div key={p.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '10px 12px', borderRadius: 10,
                  cursor: isDeleting ? 'default' : 'pointer',
                  background: isCurrent ? colorVar.soft : hoveredId === p.id ? colorVar.soft : 'transparent',
                  border: `1px solid ${isCurrent ? colorVar.border : 'transparent'}`,
                  transition: motion.fast,
                  position: 'relative',
                }}
                  onClick={() => { if (!isDeleting && !isRenaming && !isCurrent) onSwitch(p.id); }}
                  onMouseEnter={() => setHoveredId(p.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  {/* Project icon */}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ flexShrink: 0, color: isCurrent ? colorVar.accent : colorVar.textSecondary, opacity: isCurrent ? 1 : 0.5 }}>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>

                  {/* Name and date */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {isRenaming ? (
                      <input
                        ref={inputRef}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRenameConfirm(p.id);
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                        onBlur={() => handleRenameConfirm(p.id)}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          width: '100%', border: 'none', background: colorVar.panel,
                          borderRadius: 6, padding: '3px 8px', fontSize: 13,
                          color: colorVar.text, outline: `1px solid ${colorVar.accent}`,
                          fontFamily: 'inherit',
                        }}
                      />
                    ) : isDeleting ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: colorVar.textSecondary }}>
                        <span>确认删除「{p.name}」？</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }}
                          style={{
                            border: 'none', background: 'var(--signal-error)', color: '#fff',
                            borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer',
                            fontWeight: 600, fontFamily: 'inherit',
                          }}
                        >删除</button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                          style={{
                            border: `1px solid ${colorVar.border}`, background: 'transparent',
                            color: colorVar.textSecondary, borderRadius: 6, padding: '3px 10px',
                            fontSize: 11, cursor: 'pointer', fontWeight: 500, fontFamily: 'inherit',
                          }}
                        >取消</button>
                      </div>
                    ) : (
                      <>
                        <div style={{ fontSize: 13, fontWeight: 600, color: colorVar.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.name}
                          {isCurrent && <span style={{ fontSize: 10, color: colorVar.accent, marginLeft: 6, fontWeight: 500 }}>当前</span>}
                        </div>
                        <div style={{ fontSize: 11, color: colorVar.textSecondary, marginTop: 2 }}>{relativeTime(p.updatedAt)}</div>
                      </>
                    )}
                  </div>

                  {/* Action buttons (show on hover, always visible for current) */}
                  {!isRenaming && !isDeleting && (hoveredId === p.id || isCurrent) && (
                    <div style={{ display: 'flex', gap: 2, flexShrink: 0, opacity: 0.6, transition: motion.fast }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); startRename(p); }}
                        title="重命名"
                        style={{
                          width: 26, height: 26, border: 'none', borderRadius: 6,
                          background: 'transparent', cursor: 'pointer',
                          color: colorVar.textSecondary, display: 'flex', alignItems: 'center',
                          justifyContent: 'center', transition: motion.fast, fontFamily: 'inherit',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = colorVar.panel; e.currentTarget.style.color = colorVar.text; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = colorVar.textSecondary; }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                        </svg>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(p.id); }}
                        title="删除"
                        style={{
                          width: 26, height: 26, border: 'none', borderRadius: 6,
                          background: 'transparent', cursor: 'pointer',
                          color: colorVar.textSecondary, display: 'flex', alignItems: 'center',
                          justifyContent: 'center', transition: motion.fast, fontFamily: 'inherit',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--signal-error)'; e.currentTarget.style.color = '#fff'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = colorVar.textSecondary; }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Create new project */}
        <div style={{
          padding: '12px 16px', borderTop: `1px solid ${colorVar.border}`,
          display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0,
        }}>
          {creating ? (
            <>
              <input
                ref={inputRef}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setCreating(false); }}
                placeholder="项目名称"
                style={{
                  flex: 1, border: `1px solid ${colorVar.border}`, background: colorVar.panel,
                  borderRadius: 8, padding: '8px 12px', fontSize: 13,
                  color: colorVar.text, outline: 'none', fontFamily: 'inherit',
                }}
              />
              <button
                onClick={handleCreate}
                style={{
                  border: 'none', background: colorVar.accent, color: '#fff',
                  borderRadius: 8, padding: '8px 16px', fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                }}
              >创建</button>
              <button
                onClick={() => setCreating(false)}
                style={{
                  border: `1px solid ${colorVar.border}`, background: 'transparent',
                  color: colorVar.textSecondary, borderRadius: 8, padding: '8px 12px',
                  fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >取消</button>
            </>
          ) : (
            <button
              onClick={() => setCreating(true)}
              style={{
                width: '100%', border: `1px dashed ${colorVar.border}`, background: 'transparent',
                borderRadius: 10, padding: '9px 0', fontSize: 12, fontWeight: 600,
                color: colorVar.textSecondary, cursor: 'pointer', fontFamily: 'inherit',
                transition: motion.fast,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = colorVar.accent; e.currentTarget.style.color = colorVar.accent; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = colorVar.border; e.currentTarget.style.color = colorVar.textSecondary; }}
            >
              + 新建项目
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
