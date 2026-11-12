import { useEffect, useState } from 'react';
import type { ModelSpec, ProviderCapability, ProviderConfig } from '@/domain';
import { adapterFor, isModelScopeEndpoint } from '@/infra/provider';
import { useProviderStore } from '@/app/stores/providerStore';
import { PanelMask } from '@/ui/common/PanelMask';

/**
 * 厂商设置。
 *
 * 旧代码的 ProviderEditor 有 20 KB，是因为它把「选协议、拼请求、试连接、
 * 猜模型类型」全塞进了一个组件。这里只做一件事：编辑一份配置数据，
 * 请求怎么发由适配器决定。
 *
 * 关于 API Key：桌面端落在本机 config.json，浏览器调试落在 localStorage，
 * 都不会上传。UI 里明说这一点，比藏在文档里更诚实。
 */

const CAP_LABEL: Record<ProviderCapability, string> = {
  text: '文本',
  image: '图片',
  video: '视频',
};

export function SettingsPanel({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const configs = useProviderStore((s) => s.configs);
  const upsert = useProviderStore((s) => s.upsert);
  const remove = useProviderStore((s) => s.remove);

  const [activeId, setActiveId] = useState<string | null>(configs[0]?.id ?? null);
  const [draft, setDraft] = useState<ProviderConfig | null>(null);
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [testMsg, setTestMsg] = useState('');

  useEffect(() => {
    const found = configs.find((c) => c.id === activeId) ?? null;
    setDraft(found ? structuredClone(found) : null);
    setTestState('idle');
    setTestMsg('');
  }, [activeId, configs]);

  function patch(p: Partial<ProviderConfig>) {
    setDraft((d) => {
      if (!d) return d;
      const next = { ...d, ...p };
      // 填完 Base URL 就自动选对协议：真机上「协议」默认是 OpenAI 兼容，
      // 用户填了 ModelScope 地址直接保存，就会扣了费却只拿到 task_id。
      // 不要求用户知道这个下拉框的存在，也不影响手动选择。
      if (p.baseUrl !== undefined && d.adapter !== 'mock') {
        next.adapter = isModelScopeEndpoint(p.baseUrl) ? 'modelscope' : 'openai-compatible';
      }
      return next;
    });
  }

  async function test() {
    if (!draft) return;
    setTestState('testing');
    setTestMsg('');
    const r = await adapterFor(draft).test(draft);
    if (r.ok) {
      setTestState('ok');
      setTestMsg(r.models.length > 0 ? `连通，厂商报告 ${r.models.length} 个模型` : '连通');
    } else {
      setTestState('fail');
      setTestMsg(r.message);
    }
  }

  function addProvider() {
    const id = `p${Date.now().toString(36)}`;
    const next: ProviderConfig = {
      id,
      name: '新厂商',
      adapter: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      models: [
        { id: 'gpt-image-1', label: 'gpt-image-1', capabilities: ['image'], note: '示例，按实际服务改' },
      ],
    };
    upsert(next);
    setActiveId(id);
  }

  return (
    <PanelMask onClose={onClose}>
      <div className="panel" role="dialog" aria-label="厂商设置">
        <header className="panel-head">
          <h2>厂商设置</h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭" title="关闭 (Esc)">
            ×
          </button>
        </header>

        <div className="panel-body two-col">
          <nav className="panel-list">
            {configs.map((c) => (
              <button
                key={c.id}
                className={`list-item${c.id === activeId ? ' active' : ''}`}
                onClick={() => setActiveId(c.id)}
              >
                <span>{c.name}</span>
                <small>{c.adapter}</small>
              </button>
            ))}
            <button className="list-item add" onClick={addProvider}>
              + 添加厂商
            </button>
          </nav>

          <div className="panel-form">
            {!draft && <p className="muted">选择左侧厂商，或添加一个。</p>}

            {draft && (
              <>
                <Field label="名称">
                  <input value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
                </Field>

                <Field label="协议">
                  <select
                    value={draft.adapter}
                    onChange={(e) => patch({ adapter: e.target.value as ProviderConfig['adapter'] })}
                  >
                    <option value="openai-compatible">OpenAI 兼容（同步回图）</option>
                    <option value="modelscope">ModelScope（异步 task_id 轮询）</option>
                    <option value="mock">本地演示（不联网）</option>
                  </select>
                </Field>

                <Field label="Base URL" hint="填到版本号为止，例如 https://api.openai.com/v1 或 https://api-inference.modelscope.cn/v1">
                  <input
                    value={draft.baseUrl}
                    onChange={(e) => patch({ baseUrl: e.target.value })}
                    placeholder="https://api.openai.com/v1"
                  />
                </Field>

                <Field label="API Key" hint="只存在本机，不会上传到任何服务器">
                  <input
                    type="password"
                    value={draft.apiKey}
                    onChange={(e) => patch({ apiKey: e.target.value })}
                    placeholder="sk-…"
                  />
                </Field>

                <Field label="数据归属" hint="外部厂商意味着提示词/图片会发到公司外；审计台账据此标注「出境」">
                  <select
                    value={draft.scope === 'internal' ? 'internal' : 'external'}
                    onChange={(e) => patch({ scope: e.target.value as 'internal' | 'external' })}
                  >
                    <option value="external">外部（出境）</option>
                    <option value="internal">内部（自部署）</option>
                  </select>
                </Field>

                <h4>模型与能力</h4>
                <p className="muted small">
                  能力由这里声明，不由模型名猜。节点需要什么就只列什么。
                </p>
                <ModelsEditor models={draft.models} onChange={(models) => patch({ models })} />

                <div className="row">
                  <button className="btn" onClick={test} disabled={testState === 'testing'}>
                    {testState === 'testing' ? '测试中…' : '测试连通'}
                  </button>
                  {testState === 'ok' && <span style={{ color: 'var(--ok)' }}>✓ {testMsg}</span>}
                  {testState === 'fail' && <span style={{ color: 'var(--danger)' }}>✕ {testMsg}</span>}
                </div>

                <div className="row end">
                  <button
                    className="btn ghost"
                    style={{ color: 'var(--danger)' }}
                    onClick={() => {
                      remove(draft.id);
                      setActiveId(null);
                    }}
                  >
                    删除
                  </button>
                  <button
                    className="btn primary"
                    onClick={() => {
                      upsert(draft);
                      onSaved();
                    }}
                  >
                    保存
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </PanelMask>
  );
}

function ModelsEditor({
  models,
  onChange,
}: {
  models: ModelSpec[];
  onChange: (next: ModelSpec[]) => void;
}) {
  function toggleCap(i: number, cap: ProviderCapability) {
    onChange(
      models.map((m, idx) =>
        idx === i
          ? {
              ...m,
              capabilities: m.capabilities.includes(cap)
                ? m.capabilities.filter((c) => c !== cap)
                : [...m.capabilities, cap],
            }
          : m,
      ),
    );
  }

  return (
    <div className="models">
      {models.map((m, i) => (
        <div className="model-row" key={`${m.id}-${i}`}>
          <input
            className="model-id"
            value={m.id}
            placeholder="模型 id"
            onChange={(e) => onChange(models.map((x, idx) => (idx === i ? { ...x, id: e.target.value } : x)))}
          />
          <div className="caps">
            {(['text', 'image', 'video'] as ProviderCapability[]).map((cap) => (
              <label key={cap} className={`cap${m.capabilities.includes(cap) ? ' on' : ''}`}>
                <input
                  type="checkbox"
                  checked={m.capabilities.includes(cap)}
                  onChange={() => toggleCap(i, cap)}
                />
                {CAP_LABEL[cap]}
              </label>
            ))}
          </div>
          <button
            className="icon-btn"
            title="删除该模型"
            onClick={() => onChange(models.filter((_, idx) => idx !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        className="btn ghost small"
        onClick={() =>
          onChange([...models, { id: '', label: '', capabilities: ['image'] }])
        }
      >
        + 模型
      </button>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}
