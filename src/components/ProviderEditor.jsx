
import { useState, useCallback } from 'react';
import { PROTOCOLS, IMAGE_REQUEST_MODES, RESERVED_IDS } from '../utils/apiHelpers';
import { testConnection } from '../services/apiClient';
import { space, radius, fontSize, fontWeight, colorVar, controlHeight, motion } from '../styles/tokens';

const FIXED_PROTOCOL_IDS = ['modelscope', 'volcengine', 'jimeng', 'runninghub', 'codex'];
const VOLCENGINE_DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com';
const RUNNINGHUB_DEFAULT_BASE_URL = 'https://www.runninghub.cn';

function KeyInput({ label, placeholder, hint, value, onChange, onSave, onDelete, hasSavedKey }) {
  return (
    <div style={keyRowStyle}>
      <label style={fieldLabelStyle}>{label}</label>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 1 }}>
        <div style={{ ...inputFrameStyle, flex: 1 }}>
          <input
            type="password"
            style={inputStyle}
            placeholder={placeholder}
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
        {value ? (
          <button style={keyActionBtnStyle} onClick={() => onSave(value)}>
            保存
          </button>
        ) : hasSavedKey ? (
          <button style={keyActionDangerBtnStyle} onClick={onDelete}>
            删除
          </button>
        ) : (
          hint && <span style={{ fontSize: 10, color: colorVar.textTertiary, whiteSpace: 'nowrap' }}>{hint}</span>
        )}
      </div>
    </div>
  );
}

export default function ProviderEditor({
  provider, allProviders, onChange, onDelete, onSave, onFetchModels,
  onOpenModelPicker, onAddModel, onRemoveModel, hasPickerData, status,
  isFetchingModels, onKeySave, onKeyDelete,
}) {
  const isFixed = RESERVED_IDS.includes(provider.id);
  const isFixedProtocol = FIXED_PROTOCOL_IDS.includes(provider.id);
  const isRunningHub = provider.id === 'runninghub';
  const isVolcengine = provider.id === 'volcengine';
  const isJimeng = provider.id === 'jimeng';
  const isCodex = provider.id === 'codex';
  const isModelScope = provider.id === 'modelscope';

  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);

  const handleProtocolChange = useCallback((protocol) => {
    const updates = { protocol };
    if (protocol === 'volcengine' && !provider.base_url) updates.base_url = VOLCENGINE_DEFAULT_BASE_URL;
    if (protocol === 'runninghub' && !provider.base_url) updates.base_url = RUNNINGHUB_DEFAULT_BASE_URL;
    if (protocol === 'jimeng' || protocol === 'codex') updates.base_url = '';
    onChange(updates);
  }, [provider.base_url, onChange]);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testConnection(provider);
      setTestResult(result);
    } catch (err) {
      setTestResult({ ok: false, message: err.message });
    } finally {
      setTesting(false);
    }
  };

  const handleKeyChange = (field, value) => {
    const clearField =
      field === '_api_key' ? '_clear_key'
      : field === '_wallet_api_key' ? '_clear_wallet_key'
      : field === '_volcengine_access_key' ? '_clear_volcengine_access_key'
      : field === '_volcengine_secret_key' ? '_clear_volcengine_secret_key'
      : null;
    onChange({ [field]: value, [clearField]: false });
  };

  const handleClearKey = (field) => {
    const clearField = field === '_api_key' ? '_clear_key'
      : field === '_wallet_api_key' ? '_clear_wallet_key'
      : field === '_volcengine_access_key' ? '_clear_volcengine_access_key'
      : field === '_volcengine_secret_key' ? '_clear_volcengine_secret_key'
      : null;
    onChange({ [field]: '', [clearField]: true });
  };

  const handleKeySave = (field, value) => {
    handleKeyChange(field, value);
    onKeySave?.(field, value);
  };

  const handleKeyDelete = (field) => {
    handleClearKey(field);
    onKeyDelete?.(field);
  };

  const inputProps = (field, placeholder) => ({
    value: provider[field] || '',
    onChange: (e) => onChange({ [field]: e.target.value }),
    placeholder: placeholder || '',
  });

  return (
    <div style={editorStyle}>
      {/* Basic info */}
      <section style={sectionStyle}>
        <div style={sectionTitleRowStyle}>
          <div style={sectionTitleStyle}>基本信息</div>
        </div>
        <div style={fieldRowStyle}>
          <label style={fieldLabelStyle}>名称</label>
          <div style={inputFrameStyle}>
            <input style={inputStyle} {...inputProps('name', '平台名称')} disabled={isFixed && !isModelScope} />
          </div>
        </div>
        <div style={fieldRowStyle}>
          <label style={fieldLabelStyle}>ID</label>
          <div style={inputFrameStyle}>
            <input style={{ ...inputStyle, color: colorVar.textTertiary }} value={provider.id} disabled />
          </div>
        </div>
        <div style={fieldRowStyle}>
          <label style={fieldLabelStyle}>Base URL</label>
          <div style={inputFrameStyle}>
            <input
              style={inputStyle}
              {...inputProps('base_url', 'https://api.example.com/v1')}
              disabled={isJimeng || isCodex || isFixedProtocol}
            />
          </div>
        </div>
        <div style={fieldRowStyle}>
          <label style={fieldLabelStyle}>协议</label>
          <div style={inputFrameStyle}>
            <select
              style={selectStyle}
              value={provider.protocol || 'openai'}
              onChange={(e) => handleProtocolChange(e.target.value)}
              disabled={isFixedProtocol}
            >
              {PROTOCOLS.map(p => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Image settings */}
      <section style={sectionStyle}>
        <div style={sectionTitleRowStyle}>
          <div style={sectionTitleStyle}>图片设置</div>
        </div>
        <div style={fieldRowStyle}>
          <label style={fieldLabelStyle}>请求模式</label>
          <div style={inputFrameStyle}>
            <select
              style={selectStyle}
              value={provider.image_request_mode || 'openai'}
              onChange={(e) => onChange({ image_request_mode: e.target.value })}
              disabled={isFixedProtocol}
            >
              {IMAGE_REQUEST_MODES.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div style={fieldRowStyle}>
          <label style={fieldLabelStyle}>文生图端口</label>
          <div style={inputFrameStyle}>
            <input style={inputStyle} {...inputProps('image_generation_endpoint', '留空默认 /v1/images/generations')} />
          </div>
        </div>
        <div style={fieldRowStyle}>
          <label style={fieldLabelStyle}>图生图端口</label>
          <div style={inputFrameStyle}>
            <input style={inputStyle} {...inputProps('image_edit_endpoint', '留空默认 /v1/images/edits')} />
          </div>
        </div>
      </section>

      {/* API Key */}
      <section style={sectionStyle}>
        <div style={sectionTitleRowStyle}>
          <div style={sectionTitleStyle}>API Key</div>
          {provider.has_key && (
            <span style={{ fontSize: 10, color: colorVar.textTertiary }}>
              已保存 {provider.key_preview}
            </span>
          )}
        </div>
        <KeyInput
          label="API Key"
          placeholder={provider.has_key ? `保持当前 Key ${provider.key_preview}` : '输入 API Key'}
          hint={provider.has_key ? `已保存到 ${provider.key_env}` : '未保存 Key'}
          value={provider._api_key}
          onChange={(v) => handleKeyChange('_api_key', v)}
          onSave={(v) => handleKeySave('_api_key', v)}
          onDelete={() => handleKeyDelete('_api_key')}
          hasSavedKey={!!provider.has_key}
        />
      </section>

      {/* RunningHub specific */}
      {isRunningHub && (
        <section style={sectionStyle}>
          <div style={sectionTitleRowStyle}>
            <div style={sectionTitleStyle}>RunningHub 设置</div>
          </div>
          <KeyInput
            label="扣币 API Key"
            placeholder={provider.has_key ? `保持当前 Key ${provider.key_preview}` : '输入扣币 API Key'}
            hint={provider.has_key ? `已保存到 ${provider.key_env}` : '未保存扣币 Key'}
            value={provider._api_key}
            onChange={(v) => handleKeyChange('_api_key', v)}
            onSave={(v) => handleKeySave('_api_key', v)}
            onDelete={() => handleKeyDelete('_api_key')}
            hasSavedKey={!!provider.has_key}
          />
          <KeyInput
            label="钱包 API Key"
            placeholder={provider.has_wallet_key ? `保持当前 Wallet Key ${provider.wallet_key_preview}` : '输入钱包 API Key'}
            hint={provider.has_wallet_key ? `已保存到 ${provider.wallet_key_env}` : '未保存钱包 Key'}
            value={provider._wallet_api_key}
            onChange={(v) => handleKeyChange('_wallet_api_key', v)}
            onSave={(v) => handleKeySave('_wallet_api_key', v)}
            onDelete={() => handleKeyDelete('_wallet_api_key')}
            hasSavedKey={!!provider.has_wallet_key}
          />
        </section>
      )}

      {/* Volcengine specific */}
      {isVolcengine && (
        <section style={sectionStyle}>
          <div style={sectionTitleRowStyle}>
            <div style={sectionTitleStyle}>火山引擎设置</div>
          </div>
          <KeyInput
            label="方舟 API Key"
            placeholder={provider.has_key ? `保持当前 Key ${provider.key_preview}` : '输入方舟 API Key'}
            hint={provider.has_key ? `已保存到 ${provider.key_env}` : '未保存方舟 Key'}
            value={provider._api_key}
            onChange={(v) => handleKeyChange('_api_key', v)}
            onSave={(v) => handleKeySave('_api_key', v)}
            onDelete={() => handleKeyDelete('_api_key')}
            hasSavedKey={!!provider.has_key}
          />
          <KeyInput
            label="Access Key ID"
            placeholder={provider.has_volcengine_access_key ? `保持当前 AK ${provider.volcengine_access_key_preview}` : '输入 Access Key ID'}
            hint={provider.has_volcengine_access_key ? `已保存到 ${provider.volcengine_access_key_env}` : '未保存 Access Key'}
            value={provider._volcengine_access_key}
            onChange={(v) => handleKeyChange('_volcengine_access_key', v)}
            onSave={(v) => handleKeySave('_volcengine_access_key', v)}
            onDelete={() => handleKeyDelete('_volcengine_access_key')}
            hasSavedKey={!!provider.has_volcengine_access_key}
          />
          <KeyInput
            label="Secret Access Key"
            placeholder={provider.has_volcengine_secret_key ? `保持当前 SK ${provider.volcengine_secret_key_preview}` : '输入 Secret Access Key'}
            hint={provider.has_volcengine_secret_key ? `已保存到 ${provider.volcengine_secret_key_env}` : '未保存 Secret Key'}
            value={provider._volcengine_secret_key}
            onChange={(v) => handleKeyChange('_volcengine_secret_key', v)}
            onSave={(v) => handleKeySave('_volcengine_secret_key', v)}
            onDelete={() => handleKeyDelete('_volcengine_secret_key')}
            hasSavedKey={!!provider.has_volcengine_secret_key}
          />
          <div style={fieldRowStyle}>
            <label style={fieldLabelStyle}>项目名称</label>
            <div style={inputFrameStyle}>
              <input style={inputStyle} {...inputProps('volcengine_project_name', 'default')} />
            </div>
          </div>
          <div style={fieldRowStyle}>
            <label style={fieldLabelStyle}>区域</label>
            <div style={inputFrameStyle}>
              <input style={inputStyle} {...inputProps('volcengine_region', 'cn-north-1')} />
            </div>
          </div>
        </section>
      )}

      {/* ModelScope specific */}
      {isModelScope && (
        <section style={sectionStyle}>
          <div style={sectionTitleRowStyle}>
            <div style={sectionTitleStyle}>ModelScope 设置</div>
          </div>
          <div style={fieldRowStyle}>
            <label style={fieldLabelStyle}>LoRA 配置</label>
            <div style={{ fontSize: 11, color: colorVar.textTertiary }}>
              {(provider.ms_loras || []).length > 0
                ? `${provider.ms_loras.length} 个 LoRA 已配置`
                : '未配置 LoRA'}
            </div>
          </div>
        </section>
      )}

      {/* Model lists */}
      <section style={sectionStyle}>
        <div style={sectionTitleRowStyle}>
          <div style={sectionTitleStyle}>模型列表</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              style={{ ...smallBtnStyle, ...(isFetchingModels ? { opacity: 0.5 } : {}) }}
              onClick={onFetchModels}
              disabled={isFetchingModels}
            >
              {isFetchingModels ? '拉取中...' : '拉取模型'}
            </button>
            <button style={smallBtnStyle} onClick={onOpenModelPicker}>
              选择模型
            </button>
          </div>
        </div>
        {['image', 'chat', 'video'].map(type => {
          const models = provider[`${type}_models`] || [];
          const typeLabel = type === 'image' ? '生图' : type === 'chat' ? '对话' : '视频';
          return (
            <div key={type} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: colorVar.textSecondary }}>{typeLabel}</span>
                <span style={{ fontSize: 10, color: colorVar.textTertiary }}>{models.length} 个</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {models.map((m, i) => (
                  <span key={i} style={modelChipStyle}>
                    {m}
                    <button style={chipRemoveStyle} onClick={() => onRemoveModel(type, i)}>×</button>
                  </span>
                ))}
                <button style={addModelBtnStyle} onClick={() => onAddModel(type)}>+</button>
              </div>
            </div>
          );
        })}
      </section>

      {/* Connection test */}
      <section style={sectionStyle}>
        <div style={sectionTitleRowStyle}>
          <div style={sectionTitleStyle}>连接测试</div>
          <button
            style={{ ...smallBtnStyle, ...(testing ? { opacity: 0.5 } : {}) }}
            onClick={handleTest}
            disabled={testing}
          >
            {testing ? '测试中...' : '测试连接'}
          </button>
        </div>
        {testResult && (
          <div style={{
            padding: '8px 12px', borderRadius: 8, marginTop: 4,
            fontSize: 12, fontWeight: 600,
            background: testResult.ok ? 'var(--white-10)' : 'var(--white-10)',
            color: 'var(--text-primary)',
          }}>
            {testResult.ok
              ? `连接成功 · ${testResult.model_count || 0} 个模型`
              : `连接失败: ${testResult.message || '未知错误'}`}
          </div>
        )}
      </section>

      {/* Actions */}
      <div style={actionRowStyle}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: colorVar.textSecondary }}>
            <input
              type="checkbox"
              checked={provider.enabled !== false}
              onChange={(e) => onChange({ enabled: e.target.checked })}
            />
            启用
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: colorVar.textSecondary }}>
            <input
              type="checkbox"
              checked={!!provider.primary}
              onChange={(e) => onChange({ primary: e.target.checked })}
            />
            默认
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {status && (
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' }}>
              {status}
            </span>
          )}
          {!isFixed && (
            <button style={deleteBtnStyle} onClick={onDelete}>删除</button>
          )}
          <button style={saveBtnStyle} onClick={onSave}>保存</button>
        </div>
      </div>
    </div>
  );
}

const editorStyle = {
  display: 'flex', flexDirection: 'column', gap: 16,
};

const sectionStyle = {
  background: colorVar.panel, border: `1px solid ${colorVar.border}`,
  borderRadius: 12, padding: '14px 16px',
};

const sectionTitleRowStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  marginBottom: 10,
};

const sectionTitleStyle = {
  fontSize: 11, fontWeight: 800, color: colorVar.textSecondary,
  letterSpacing: '0.04em', textTransform: 'uppercase',
};

const fieldRowStyle = {
  display: 'flex', alignItems: 'center', gap: 10, marginBottom: 7,
};

const fieldLabelStyle = {
  minWidth: 80, fontSize: 11.5, fontWeight: 700, color: colorVar.textSecondary, flexShrink: 0,
};

const inputFrameStyle = {
  display: 'flex', alignItems: 'center',
  border: `1px solid ${colorVar.border}`, borderRadius: 8,
  background: colorVar.bg, flex: 1,
};

const inputStyle = {
  width: '100%', padding: '0 10px', height: 32, border: 'none',
  background: 'transparent', color: colorVar.text, outline: 'none',
  fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit',
};

const selectStyle = {
  ...inputStyle, appearance: 'auto', cursor: 'pointer',
};

const keyRowStyle = {
  display: 'flex', alignItems: 'center', gap: 10, marginBottom: 7,
};

const keyActionBtnStyle = {
  height: 28, padding: '0 10px', borderRadius: 6, border: 'none',
  background: colorVar.accentSoft, color: colorVar.accent, fontSize: 11,
  fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
};

const keyActionDangerBtnStyle = {
  height: 28, padding: '0 10px', borderRadius: 6,
  border: '1px solid var(--text-primary)',
  background: 'var(--white-10)', color: 'var(--text-primary)', fontSize: 11,
  fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
};

const smallBtnStyle = {
  height: 26, padding: '0 10px', borderRadius: 6, border: `1px solid ${colorVar.border}`,
  background: colorVar.bg, color: colorVar.textSecondary, fontSize: 10.5,
  fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
};

const modelChipStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '4px 8px', borderRadius: 6,
  background: colorVar.accentSoft, color: colorVar.text,
  fontSize: 11, fontWeight: 600, fontFamily: 'ui-monospace, monospace',
};

const chipRemoveStyle = {
  background: 'none', border: 'none', color: colorVar.textTertiary,
  cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1,
};

const addModelBtnStyle = {
  width: 28, height: 26, borderRadius: 6, border: `1px dashed ${colorVar.border}`,
  background: 'transparent', color: colorVar.textTertiary,
  fontSize: 16, cursor: 'pointer', display: 'inline-flex',
  alignItems: 'center', justifyContent: 'center',
};

const actionRowStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '10px 0',
};

const saveBtnStyle = {
  height: 32, padding: '0 18px', borderRadius: 8, border: 'none',
  background: 'var(--accent)', color: 'var(--bg-primary)', fontSize: 12,
  fontWeight: 700, cursor: 'pointer', transition: motion.fast,
};
const deleteBtnStyle = {
  height: 32, padding: '0 14px', borderRadius: 8,
  border: `1px solid ${colorVar.border}`,
  background: 'var(--panel)',
  color: 'var(--text-secondary)', fontSize: 12,
  fontWeight: 700, cursor: 'pointer',
  transition: motion.fast,
};
