
import { useState, useEffect, useCallback, useRef } from 'react';
import ProviderEditor from './ProviderEditor';
import ModelPicker from './ModelPicker';
import { newProviderTemplate, PROTOCOLS, RESERVED_IDS } from '../utils/apiHelpers';
import { fetchProviders, saveProviders, fetchUpstreamModels } from '../services/apiClient';
import { colorVar, fontWeight, motion } from '../styles/tokens';

const PROTOCOL_BADGES = {
  openai:    { bg: 'var(--text-primary)18', color: 'var(--text-primary)', label: 'O' },
  apimart:   { bg: 'var(--white-10)', color: 'var(--text-primary)', label: 'A' },
  gemini:    { bg: 'var(--white-10)', color: 'var(--text-primary)', label: 'G' },
  volcengine:{ bg: 'var(--white-10)', color: 'var(--text-primary)', label: 'V' },
  runninghub:{ bg: 'var(--white-10)', color: 'var(--text-primary)', label: 'R' },
  jimeng:    { bg: 'var(--white-10)', color: 'var(--text-primary)', label: 'J' },
  codex:     { bg: 'var(--white-10)', color: 'var(--text-primary)', label: 'X' },
};

function getProtocolBadge(protocol) {
  return PROTOCOL_BADGES[protocol] || { bg: 'var(--panel)', color: 'var(--text)', label: '?' };
}

function getProtocolLabel(protocol) {
  const found = PROTOCOLS.find(p => p.value === protocol);
  return found ? found.label : protocol || 'OpenAI 兼容';
}

export default function ApiSettings({ onClose, onUpdate, embedded }) {
  const [providers, setProviders] = useState([]);
  const [selectedProviderId, setSelectedProviderId] = useState(null);
  const [status, setStatus] = useState('');
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);
  const [fetchedModelData, setFetchedModelData] = useState(null);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const loadedRef = useRef(false);

  const loadProviders = useCallback(async () => {
    try {
      const list = await fetchProviders();
      setProviders(list);
      if (onUpdate) onUpdate(list);
      if (list.length > 0 && !selectedProviderId) {
        setSelectedProviderId(list[0].id);
      }
    } catch (err) {
      console.error('Failed to load providers:', err);
    }
  }, [onUpdate]);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    loadProviders();
  }, [loadProviders]);

  const selectedProvider = providers.find(p => p.id === selectedProviderId);

  // Clear cached model data when provider changes
  useEffect(() => {
    setFetchedModelData(null);
  }, [selectedProviderId]);

  const updateProvider = useCallback((updates) => {
    if (!selectedProviderId) return;
    setProviders(prev => prev.map(p =>
      p.id === selectedProviderId ? { ...p, ...updates } : p
    ));
  }, [selectedProviderId]);

  const addProvider = useCallback(() => {
    const newProvider = newProviderTemplate();
    setProviders(prev => [...prev, newProvider]);
    setSelectedProviderId(newProvider.id);
  }, []);

  const deleteProvider = useCallback(() => {
    if (!selectedProviderId) return;
    if (providers.length <= 1) {
      alert('至少保留一个 API 平台');
      return;
    }
    setProviders(prev => {
      const next = prev.filter(p => p.id !== selectedProviderId);
      setSelectedProviderId(next[0].id);
      return next;
    });
  }, [selectedProviderId, providers.length]);

  const handleSave = async () => {
    try {
      const data = await saveProviders(providers);
      setProviders(data.providers);
      if (onUpdate) onUpdate(data.providers);
      setStatus('保存成功');
      setTimeout(() => setStatus(''), 2000);
    } catch (err) {
      console.error('Failed to save:', err);
      setStatus('保存失败');
    }
  };

  const handleKeySave = useCallback(async (field, value) => {
    if (!selectedProviderId) return;
    const cf = field === '_api_key' ? '_clear_key'
      : field === '_wallet_api_key' ? '_clear_wallet_key'
      : field === '_volcengine_access_key' ? '_clear_volcengine_access_key'
      : field === '_volcengine_secret_key' ? '_clear_volcengine_secret_key'
      : null;
    const updated = providers.map(p =>
      p.id === selectedProviderId ? { ...p, [field]: value, [cf]: false } : p
    );
    try {
      const data = await saveProviders(updated);
      setProviders(data.providers);
      if (onUpdate) onUpdate(data.providers);
      setStatus('Key 已保存');
      setTimeout(() => setStatus(''), 2000);
    } catch (err) {
      console.error('Failed to save key:', err);
      setStatus('保存失败');
    }
  }, [providers, selectedProviderId, onUpdate]);

  const handleKeyDelete = useCallback(async (field) => {
    if (!selectedProviderId) return;
    const cf = field === '_api_key' ? '_clear_key'
      : field === '_wallet_api_key' ? '_clear_wallet_key'
      : field === '_volcengine_access_key' ? '_clear_volcengine_access_key'
      : field === '_volcengine_secret_key' ? '_clear_volcengine_secret_key'
      : null;
    const updated = providers.map(p =>
      p.id === selectedProviderId ? { ...p, [field]: '', [cf]: true } : p
    );
    try {
      const data = await saveProviders(updated);
      setProviders(data.providers);
      if (onUpdate) onUpdate(data.providers);
      setStatus('Key 已删除');
      setTimeout(() => setStatus(''), 2000);
    } catch (err) {
      console.error('Failed to delete key:', err);
      setStatus('删除失败');
    }
  }, [providers, selectedProviderId, onUpdate]);

  const handleToggleEnabled = useCallback(async (id) => {
    const updated = providers.map(p =>
      p.id === id ? { ...p, enabled: p.enabled === false ? true : false } : p
    );
    try {
      const data = await saveProviders(updated);
      setProviders(data.providers);
      if (onUpdate) onUpdate(data.providers);
    } catch (err) {
      console.error('Toggle failed:', err);
    }
  }, [providers, onUpdate]);

  const handleFetchModels = useCallback(async () => {
    if (!selectedProvider) return;
    setIsFetchingModels(true);
    try {
      const result = await fetchUpstreamModels(selectedProvider);
      setFetchedModelData(result);
      setIsModelPickerOpen(true);
    } catch (err) {
      console.error('Fetch models failed:', err);
    } finally {
      setIsFetchingModels(false);
    }
  }, [selectedProvider]);

  const handleOpenModelPicker = useCallback(() => {
    if (fetchedModelData) {
      setIsModelPickerOpen(true);
    } else {
      handleFetchModels();
    }
  }, [fetchedModelData, handleFetchModels]);

  const addModel = (type) => {
    const model = prompt('输入模型名称:');
    if (!model) return;
    const current = selectedProvider?.[`${type}_models`] || [];
    const next = [...current, model].filter((m, i, arr) => arr.indexOf(m) === i);
    updateProvider({ [`${type}_models`]: next });
  };

  const removeModel = (type, index) => {
    const current = selectedProvider?.[`${type}_models`] || [];
    updateProvider({ [`${type}_models`]: current.filter((_, i) => i !== index) });
  };

  const content = (
    <>
      {!embedded && (
        <div style={headerStyle}>
          <h2 style={titleStyle}>API 设置</h2>
          <button style={closeButtonStyle} onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
      )}

      <div style={embedded ? embeddedLayoutStyle : layoutStyle}>
        <aside style={sidebarStyle}>
          <div style={sectionTitleStyle}>平台列表</div>
          <div style={providerListStyle}>
              {providers.map((p) => {
                const badge = getProtocolBadge(p.protocol);
                const enabled = p.enabled !== false;
                return (
                  <button
                    key={p.id}
                    style={{
                      ...providerCardStyle,
                      ...(p.id === selectedProviderId ? providerCardActiveStyle : {}),
                      ...(!enabled ? providerCardDisabledStyle : {}),
                    }}
                    onClick={() => setSelectedProviderId(p.id)}
                  >
                    <div style={{ ...providerBadgeStyle, background: badge.bg, color: badge.color }}>
                      {badge.label}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={providerNameStyle}>{p.name || p.id}</div>
                      <div style={providerMetaStyle}>
                        {getProtocolLabel(p.protocol)}
                        {p.primary ? ' · 默认' : ''}
                        {!enabled ? ' · 已禁用' : ''}
                      </div>
                    </div>
                    <div
                      style={toggleTrackStyle(enabled)}
                      onClick={(e) => { e.stopPropagation(); handleToggleEnabled(p.id); }}
                    >
                      <div style={toggleThumbStyle(enabled)} />
                    </div>
                  </button>
                );
              })}
            </div>
            <button style={addButtonStyle} onClick={addProvider}>
              + 新增平台
            </button>
          </aside>

          <main style={contentStyle}>
            {selectedProvider ? (
              <ProviderEditor
                provider={selectedProvider}
                allProviders={providers}
                onChange={updateProvider}
                onDelete={deleteProvider}
                onSave={handleSave}
                onFetchModels={handleFetchModels}
                isFetchingModels={isFetchingModels}
                onOpenModelPicker={handleOpenModelPicker}
                onAddModel={addModel}
                onRemoveModel={removeModel}
                status={status}
                onKeySave={handleKeySave}
                onKeyDelete={handleKeyDelete}
              />
            ) : (
              <div style={emptyEditorStyle}>
                <div style={{ fontWeight: 800, fontSize: 15, color: colorVar.textSecondary }}>
                  未选择平台
                </div>
                <div style={{ fontWeight: 600, fontSize: 12, color: colorVar.textTertiary, marginTop: 8 }}>
                  请从左侧选择一个 API 平台进行配置
                </div>
              </div>
            )}
          </main>
        </div>

        {isModelPickerOpen && selectedProvider && (
          <ModelPicker
            provider={selectedProvider}
            pickerData={fetchedModelData}
            onApply={(sel) => {
              updateProvider(sel);
              setIsModelPickerOpen(false);
            }}
            onClose={() => setIsModelPickerOpen(false)}
          />
        )}
      </>
    );

    if (embedded) return content;

    return (
      <div style={overlayStyle} onClick={onClose}>
        <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
          {content}
        </div>
      </div>
    );
}

function CloseIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

const overlayStyle = {
  position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 9999, padding: '32px',
};

const modalStyle = {
  width: '100%', maxWidth: 1000, maxHeight: '88vh',
  background: colorVar.bg, border: `1px solid ${colorVar.border}`,
  borderRadius: 16, display: 'flex', flexDirection: 'column',
  overflow: 'hidden', boxShadow: '0 16px 56px rgba(0, 0, 0, 0.22)',
};

const headerStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '18px 22px', borderBottom: `1px solid ${colorVar.border}`,
};

const titleStyle = { fontSize: 16, fontWeight: 800, margin: 0, color: colorVar.text };

const closeButtonStyle = {
  width: 34, height: 34, border: 'none', background: 'transparent',
  cursor: 'pointer', color: colorVar.textSecondary, display: 'flex', alignItems: 'center',
  justifyContent: 'center', borderRadius: 8, transition: motion.fast,
};

const layoutStyle = {
  display: 'grid', gridTemplateColumns: '220px minmax(0, 1fr)',
  alignItems: 'start', padding: '18px', gap: 18,
  overflowY: 'auto', flex: 1,
};

const embeddedLayoutStyle = {
  display: 'grid', gridTemplateColumns: '220px minmax(0, 1fr)',
  alignItems: 'start', padding: '18px', gap: 18,
  flex: 1, minHeight: 0,
};

const sidebarStyle = {
  display: 'flex', flexDirection: 'column', gap: 12,
  padding: 12, background: colorVar.panel, border: `1px solid ${colorVar.border}`,
  borderRadius: 12,
};

const sectionTitleStyle = {
  color: colorVar.textTertiary, fontSize: 10, fontWeight: 800,
  letterSpacing: '0.10em', textTransform: 'uppercase', padding: '2px 4px',
};

const providerListStyle = {
  display: 'flex', flexDirection: 'column', gap: 3,
  paddingBottom: 8, borderBottom: `1px solid ${colorVar.border}`,
};

const providerCardStyle = {
  width: '100%', textAlign: 'left', border: 'none',
  background: 'transparent', borderRadius: 8, padding: '8px 9px',
  display: 'flex', alignItems: 'center', gap: 9, color: colorVar.textSecondary,
  transition: motion.fast, cursor: 'pointer',
};

const providerCardActiveStyle = {
  background: colorVar.accentSoft, color: colorVar.text,
};

const providerCardDisabledStyle = {
  opacity: 0.5,
};

const providerBadgeStyle = {
  width: 26, height: 26, borderRadius: 7, display: 'flex',
  alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  fontSize: 11, fontWeight: 800, lineHeight: 1,
};

const providerNameStyle = {
  minWidth: 0, fontSize: 12.5, fontWeight: 800,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  letterSpacing: '-0.01em', color: 'inherit',
};

const providerMetaStyle = {
  marginTop: 2, fontSize: 10, fontWeight: 600,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  color: colorVar.textTertiary,
};

const toggleTrackStyle = (enabled) => ({
  width: 28, height: 16, borderRadius: 8, flexShrink: 0,
  background: enabled ? 'var(--accent-soft)' : 'var(--panel)',
  border: `1px solid ${enabled ? 'var(--accent)' : 'var(--border-color)'}`,
  cursor: 'pointer', position: 'relative', transition: motion.fast,
});

const toggleThumbStyle = (enabled) => ({
  width: 12, height: 12, borderRadius: '50%',
  background: enabled ? 'var(--accent)' : 'var(--text-secondary)',
  position: 'absolute', top: 2,
  left: enabled ? 14 : 2,
  transition: motion.fast,
});

const addButtonStyle = {
  width: '100%', height: 34, border: `1px dashed ${colorVar.border}`,
  borderRadius: 8, color: colorVar.textSecondary, display: 'inline-flex',
  alignItems: 'center', justifyContent: 'center', gap: 6,
  fontSize: 11.5, fontWeight: 800, transition: motion.fast,
  background: 'transparent', cursor: 'pointer',
};

const contentStyle = {
  display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0,
};

const emptyEditorStyle = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  minHeight: 260, textAlign: 'center',
  background: colorVar.panel, border: `1px solid ${colorVar.border}`,
  borderRadius: 14,
};
