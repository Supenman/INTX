import { useState } from 'react';
import ApiSettings from './ApiSettings';
import UsageGuide from './UsageGuide';
import { colorVar, motion, fontWeight } from '../styles/tokens';

export default function SettingsPanel({ onClose, onApiUpdate }) {
  const [activeTab, setActiveTab] = useState('api');

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={panelStyle} onClick={e => e.stopPropagation()}>
        <div style={headerStyle}>
          <h2 style={titleStyle}>设置</h2>
          <button style={closeBtnStyle} onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div style={bodyStyle}>
          <nav style={navStyle}>
            <button
              style={navItemStyle(activeTab === 'api')}
              onClick={() => setActiveTab('api')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
              </svg>
              API 设置
            </button>
            <button
              style={navItemStyle(activeTab === 'guide')}
              onClick={() => setActiveTab('guide')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              使用说明
            </button>
          </nav>
          <div style={contentAreaStyle}>
            {activeTab === 'api' && (
              <ApiSettings onClose={onClose} onUpdate={onApiUpdate} embedded />
            )}
            {activeTab === 'guide' && <UsageGuide />}
          </div>
        </div>
      </div>
    </div>
  );
}

const overlayStyle = {
  position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 9999, padding: '32px',
};

const panelStyle = {
  width: '100%', maxWidth: 1000, maxHeight: '88vh',
  background: colorVar.bg, border: `1px solid ${colorVar.border}`,
  borderRadius: 16, display: 'flex', flexDirection: 'column',
  overflow: 'hidden', boxShadow: '0 16px 56px rgba(0, 0, 0, 0.22)',
};

const headerStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '18px 22px', borderBottom: `1px solid ${colorVar.border}`,
};

const titleStyle = {
  fontSize: 16, fontWeight: 800, margin: 0, color: colorVar.text,
};

const closeBtnStyle = {
  width: 34, height: 34, border: 'none', background: 'transparent',
  cursor: 'pointer', color: colorVar.textSecondary,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: 8, transition: motion.fast,
};

const bodyStyle = {
  display: 'grid', gridTemplateColumns: '180px minmax(0, 1fr)',
  flex: 1, overflow: 'hidden',
};

const navStyle = {
  display: 'flex', flexDirection: 'column', gap: 2,
  padding: 14, borderRight: `1px solid ${colorVar.border}`,
};

const navItemStyle = (active) => ({
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '9px 12px', borderRadius: 8, border: 'none',
  fontSize: 12.5, fontWeight: active ? fontWeight.bold : fontWeight.semibold,
  color: active ? colorVar.text : colorVar.textSecondary,
  background: active ? 'var(--accent-soft)' : 'transparent',
  cursor: 'pointer', textAlign: 'left', width: '100%',
  transition: motion.fast,
});

const contentAreaStyle = {
  flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column',
};
