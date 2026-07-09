import { useCallback, useEffect, useRef } from 'react';
import { NODE_TYPE_REGISTRY } from '../domain/nodeTypes';

const TYPE_DESCRIPTIONS = {
  image: '生成画面、参考图和关键帧',
  text: '沉淀提示词、旁白和分镜脚本',
  video: '生成动态镜头和成片片段',
  'source-text': '上传或粘贴文本内容',
  'source-image': '上传图片参考素材',
  'source-video': '上传视频参考素材',
  'source-audio': '上传音频素材文件',
  'source-markdown': '上传 Markdown 文档',
};

const NODE_TYPE_OPTIONS = Object.entries(NODE_TYPE_REGISTRY).map(([id, meta]) => ({
  type: id,
  label: `${meta.title}节点`,
  description: TYPE_DESCRIPTIONS[id],
  accent: meta.accentVar,
  rgb: meta.accentRgb,
  icon: meta.smallIcon,
}));

const GEN_TYPES = ['image', 'text', 'video'];
const generationOptions = NODE_TYPE_OPTIONS.filter(o => GEN_TYPES.includes(o.type));
const sourceOptions = NODE_TYPE_OPTIONS.filter(o => !GEN_TYPES.includes(o.type));

function NodeTypeMenu({
  position,
  onSelect,
  onClose,
  triggerButtonRef,
}) {
  const menuRef = useRef(null);

  const handleItemClick = useCallback(
    (e, type) => {
      e.stopPropagation();
      onSelect(type, position);
      onClose();
    },
    [onSelect, onClose, position]
  );

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target) &&
        (!triggerButtonRef || !triggerButtonRef.current.contains(e.target))
      ) {
        onClose();
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, triggerButtonRef]);

  const getMenuPosition = () => {
    if (!position) return { left: 0, top: 0 };

    let left = position.x;
    let top = position.y;
    const menuWidth = 250;
    const menuHeight = 260;
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

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: menuPosition.left,
        top: menuPosition.top,
        zIndex: 9999,
        width: 250,
        padding: 8,
        background: 'var(--panel-bg-strong)',
        backdropFilter: 'var(--panel-blur)',
        border: '1px solid var(--sidebar-border)',
        borderRadius: 14,
        boxShadow: 'var(--panel-shadow)',
        animation: 'fadeIn 0.16s var(--ease-out)',
      }}
    >
      <div
        style={{
          padding: '6px 8px 8px',
          marginBottom: 4,
          borderBottom: '1px solid var(--sidebar-border)',
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--sidebar-text)' }}>
          添加一个创作节点
        </div>
      </div>

      {generationOptions.length > 0 && (
        <>
          {generationOptions.map((option, index) => (
            <button
              key={option.type}
              onClick={(e) => handleItemClick(e, option.type)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 8px',
                background: 'transparent',
                border: 'none',
                borderRadius: 10,
                cursor: 'pointer',
                color: 'var(--sidebar-text)',
                fontSize: 12,
                fontWeight: 600,
                transition: 'background 0.14s var(--ease-out)',
                textAlign: 'left',
                animation: 'fadeIn 0.16s var(--ease-out) forwards',
                animationDelay: `${index * 35}ms`,
                opacity: 0,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--sidebar-item-bg-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 30,
                height: 30,
                borderRadius: 8,
                color: option.accent,
                background: `rgba(${option.rgb}, 0.10)`,
                flexShrink: 0,
              }}>
                {option.icon}
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span>{option.label}</span>
                <span style={{
                  fontSize: 10,
                  color: 'var(--sidebar-text-secondary)',
                  marginTop: 2,
                  lineHeight: 1.35,
                  fontWeight: 500,
                }}>
                  {option.description}
                </span>
              </div>
            </button>
          ))}
        </>
      )}

      {sourceOptions.length > 0 && (
        <>
          <div style={{
            padding: '8px 8px 4px',
            marginTop: 4,
            borderTop: '1px solid var(--sidebar-border)',
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.08em' }}>
              素材节点
            </div>
          </div>
          {sourceOptions.map((option, index) => (
            <button
              key={option.type}
              onClick={(e) => handleItemClick(e, option.type)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 8px',
                background: 'transparent',
                border: 'none',
                borderRadius: 10,
                cursor: 'pointer',
                color: 'var(--sidebar-text)',
                fontSize: 12,
                fontWeight: 600,
                transition: 'background 0.14s var(--ease-out)',
                textAlign: 'left',
                animation: 'fadeIn 0.16s var(--ease-out) forwards',
                animationDelay: `${(generationOptions.length + index) * 35}ms`,
                opacity: 0,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--sidebar-item-bg-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 30,
                height: 30,
                borderRadius: 8,
                color: option.accent,
                background: `rgba(${option.rgb}, 0.10)`,
                flexShrink: 0,
              }}>
                {option.icon}
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span>{option.label}</span>
                <span style={{
                  fontSize: 10,
                  color: 'var(--sidebar-text-secondary)',
                  marginTop: 2,
                  lineHeight: 1.35,
                  fontWeight: 500,
                }}>
                  {option.description}
                </span>
              </div>
            </button>
          ))}
        </>
      )}
    </div>
  );
}

export default NodeTypeMenu;
