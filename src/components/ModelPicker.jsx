import { useState, useEffect } from 'react';
import CanvasButton from './primitives/CanvasButton';
import CanvasInput from './primitives/CanvasInput';
import { classifyModel } from '../utils/apiHelpers';
import { fetchUpstreamModels } from '../services/apiClient';
import { space, radius, fontSize, fontWeight, colorVar, motion, controlHeight } from '../styles/tokens';

const CATEGORIES = [
  { key: 'all', label: '全部' },
  { key: 'image', label: '生图' },
  { key: 'chat', label: '对话' },
  { key: 'video', label: '视频' },
];

const ICON_CLOSE = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18"></line>
    <line x1="6" y1="6" x2="18" y2="18"></line>
  </svg>
);

export default function ModelPicker({ provider, pickerData, onApply, onClose }) {
  const [data, setData] = useState(pickerData || null);
  const [selection, setSelection] = useState(() => ({
    image: [...(provider?.image_models || [])],
    chat: [...(provider?.chat_models || [])],
    video: [...(provider?.video_models || [])],
  }));
  const [cat, setCat] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(!pickerData);

  // Skip auto-fetch when pickerData is provided by parent
  useEffect(() => {
    if (pickerData) {
      setData(pickerData);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const result = await fetchUpstreamModels(provider);
        if (cancelled) return;
        setData(result);
        // Don't overwrite selection — keep provider's existing models as pre-checked
      } catch (err) {
        console.error('Fetch models failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [provider, pickerData]);

  const toggleModel = (model) => {
    const c = classifyModel(model);
    setSelection(prev => {
      const next = { ...prev };
      if (next[c].includes(model)) {
        next[c] = next[c].filter(m => m !== model);
      } else {
        next[c] = [...next[c], model];
      }
      return next;
    });
  };

  const isSelected = (model) =>
    selection.image.includes(model) ||
    selection.chat.includes(model) ||
    selection.video.includes(model);

  const upstreamModels = data?.all || [];
  const upstreamByCat = {
    image: data?.image_models || [],
    chat: data?.chat_models || [],
    video: data?.video_models || [],
  };

  const totalSelected = new Set([
    ...selection.image,
    ...selection.chat,
    ...selection.video,
  ]).size;

  // Compute selected/total for each category tab
  const tabInfo = (() => {
    if (!data) {
      return {
        all: { selected: 0, total: 0 },
        image: { selected: 0, total: 0 },
        chat: { selected: 0, total: 0 },
        video: { selected: 0, total: 0 },
      };
    }
    const selSet = new Set([...selection.image, ...selection.chat, ...selection.video]);
    return {
      all: { selected: upstreamModels.filter(m => selSet.has(m)).length, total: upstreamModels.length },
      image: { selected: upstreamByCat.image.filter(m => selSet.has(m)).length, total: upstreamByCat.image.length },
      chat: { selected: upstreamByCat.chat.filter(m => selSet.has(m)).length, total: upstreamByCat.chat.length },
      video: { selected: upstreamByCat.video.filter(m => selSet.has(m)).length, total: upstreamByCat.video.length },
    };
  })();

  const filteredModels = (() => {
    if (!upstreamModels.length) return [];
    let models = upstreamModels;
    if (search) {
      const s = search.toLowerCase();
      models = models.filter(m => m.toLowerCase().includes(s));
    }
    if (cat !== 'all') {
      models = models.filter(m => classifyModel(m) === cat);
    }
    return models;
  })();

  const handleApply = () => {
    onApply({
      image_models: selection.image,
      chat_models: selection.chat,
      video_models: selection.video,
    });
  };

  return (
    <div style={pickerOverlayStyle} onClick={onClose}>
      <div style={pickerModalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={pickerHeadStyle}>
          <div>
            <div style={pickerTitleStyle}>模型选择</div>
            <div style={pickerCountStyle}>
              {loading ? '正在从上游拉取模型...' :
               data ? `${upstreamModels.length} 个模型` :
               '暂未加载模型'}
            </div>
          </div>
          <div style={pickerCloseStyle} onClick={onClose}>
            {ICON_CLOSE}
          </div>
        </div>
        <div style={pickerToolbarStyle}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <CanvasInput
              placeholder="按名称搜索模型..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div style={pickerCatTabsStyle}>
            {CATEGORIES.map(({ key, label }) => {
              const info = tabInfo[key];
              return (
                <button
                  key={key}
                  style={{
                    ...pickerCatTabStyle,
                    ...(cat === key ? pickerCatTabActiveStyle : {}),
                  }}
                  onClick={() => setCat(key)}
                >
                  {label}
                  <span style={catCountStyle}>
                    {info.selected}/{info.total}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div style={pickerBodyStyle}>
          {loading ? (
            <div style={pickerEmptyStyle}>
              <div style={{ fontSize: 13, fontWeight: 700, color: colorVar.textSecondary }}>正在拉取模型...</div>
              <div style={{ fontSize: 11, color: colorVar.textTertiary, marginTop: 4 }}>请稍候</div>
            </div>
          ) : !data ? (
            <div style={pickerEmptyStyle}>
              <div style={{ fontSize: 13, fontWeight: 700, color: colorVar.textSecondary }}>暂无模型数据</div>
              <div style={{ fontSize: 11, color: colorVar.textTertiary, marginTop: 4 }}>
                请先点击「拉取模型」从上游获取模型清单
              </div>
            </div>
          ) : filteredModels.length === 0 ? (
            <div style={pickerEmptyStyle}>
              <div style={{ fontSize: 13, fontWeight: 700, color: colorVar.textSecondary }}>
                {search ? '没有匹配的模型' : '暂无模型'}
              </div>
            </div>
          ) : (
            filteredModels.map((model, i) => (
              <div
                key={i}
                style={{
                  ...pickerRowStyle,
                  ...(isSelected(model) ? pickerRowSelectedStyle : {}),
                }}
                onClick={() => toggleModel(model)}
              >
                <div
                  style={{
                    ...pickerCheckboxStyle,
                    ...(isSelected(model) ? pickerCheckboxCheckedStyle : {}),
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ width: 12, height: 12, opacity: isSelected(model) ? 1 : 0 }}>
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                </div>
                <span style={pickerModelNameStyle}>{model}</span>
              </div>
            ))
          )}
        </div>
        <div style={pickerSummaryStyle}>
          <span style={pickerSummaryTitleStyle}>已选:</span>
          <span style={pickerSumChipStyle}>生图 {selection.image.length}</span>
          <span style={pickerSumChipStyle}>对话 {selection.chat.length}</span>
          <span style={pickerSumChipStyle}>视频 {selection.video.length}</span>
          <span style={{ fontSize: 10, color: colorVar.textTertiary, marginLeft: 'auto' }}>
            共 {totalSelected} 个
          </span>
        </div>
        <div style={pickerFootStyle}>
          <CanvasButton variant="secondary" onClick={onClose}>取消</CanvasButton>
          <CanvasButton variant="primary" onClick={handleApply}>应用到模型列表</CanvasButton>
        </div>
      </div>
    </div>
  );
}

const pickerOverlayStyle = {
  display: 'flex',
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.6)',
  zIndex: 99999,
  alignItems: 'center',
  justifyContent: 'center',
  padding: '32px',
};

const pickerModalStyle = {
  width: '100%',
  maxWidth: 780,
  maxHeight: '90vh',
  background: colorVar.panel,
  border: `1px solid ${colorVar.borderStrong}`,
  borderRadius: radius.xl,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  boxShadow: '0 28px 64px rgba(0, 0, 0, 0.3)',
};

const pickerHeadStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: space.md,
  padding: `${space.xl}px ${space.xl}px`,
  borderBottom: `1px solid ${colorVar.border}`,
};

const pickerTitleStyle = { fontSize: 15, fontWeight: fontWeight.black, color: colorVar.text };
const pickerCountStyle = {
  fontSize: fontSize.sm, color: colorVar.textSecondary, fontWeight: fontWeight.bold, marginTop: 2,
};
const pickerCloseStyle = {
  width: controlHeight.sm + 2, height: controlHeight.sm + 2, borderRadius: radius.md,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: colorVar.textSecondary, cursor: 'pointer', transition: motion.fast,
};

const pickerToolbarStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: space.md,
  padding: `${space.md + 4}px ${space.xl}px`,
  borderBottom: `1px solid ${colorVar.border}`,
  flexWrap: 'wrap',
};

const pickerCatTabsStyle = {
  display: 'flex', gap: space.xs, background: colorVar.soft,
  padding: 3, borderRadius: radius.md, border: `1px solid ${colorVar.border}`,
};

const pickerCatTabStyle = {
  height: controlHeight.sm, padding: `0 ${space.md}px`, borderRadius: radius.sm,
  display: 'inline-flex', alignItems: 'center', gap: 5,
  color: colorVar.textSecondary, fontSize: fontSize.sm, fontWeight: fontWeight.black,
  cursor: 'pointer', border: 'none', background: 'transparent',
};

const pickerCatTabActiveStyle = {
  background: colorVar.panel, color: colorVar.text,
  boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
};

const catCountStyle = {
  fontSize: 10, padding: '1px 5px', borderRadius: 5,
  background: colorVar.border, color: colorVar.textSecondary, fontWeight: fontWeight.black,
};

const pickerBodyStyle = { flex: 1, overflow: 'auto', padding: `${space.md}px ${space.md + 4}px ${space.md + 4}px` };

const pickerEmptyStyle = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  padding: '48px 24px', textAlign: 'center',
};

const pickerRowStyle = {
  display: 'flex', alignItems: 'center', gap: space.md,
  padding: `${space.md + 4}px ${space.md + 4}px`, borderBottom: `1px solid ${colorVar.border}`,
  cursor: 'pointer', transition: 'background 0.12s ease',
};

const pickerRowSelectedStyle = { background: 'rgba(15,23,42,0.04)' };

const pickerCheckboxStyle = {
  width: 18, height: 18, border: `1.5px solid ${colorVar.borderStrong}`,
  borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: colorVar.panel, flexShrink: 0, color: colorVar.bg,
  transition: motion.normal,
};

const pickerCheckboxCheckedStyle = {
  background: colorVar.text, border: `1.5px solid ${colorVar.text}`,
};

const pickerModelNameStyle = {
  minWidth: 0, flex: 1, fontSize: fontSize.lg, fontWeight: 650,
  color: colorVar.text, overflow: 'hidden', textOverflow: 'ellipsis',
  whiteSpace: 'nowrap', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

const pickerSummaryStyle = {
  display: 'flex', alignItems: 'center', gap: space.md,
  padding: `${space.md + 4}px ${space.xl}px`, background: colorVar.soft,
  borderTop: `1px solid ${colorVar.border}`, fontSize: 11.5,
  fontWeight: fontWeight.black, color: colorVar.text, flexWrap: 'wrap',
};

const pickerSummaryTitleStyle = { fontWeight: fontWeight.black, color: colorVar.text };

const pickerSumChipStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: `${5}px ${space.md + 4}px`, borderRadius: radius.md,
  background: colorVar.panel, border: `1px solid ${colorVar.border}`, color: colorVar.text,
};
const pickerFootStyle = {
  display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
  gap: space.md, padding: `${space.xl}px ${space.xl}px`,
  borderTop: `1px solid ${colorVar.border}`, background: colorVar.panel,
};
