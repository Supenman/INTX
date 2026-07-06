import { useEffect, useRef, useState } from 'react';
import { space, radius, fontSize, fontWeight, colorVar, motion, controlHeight } from '../../styles/tokens';

const triggerBase = {
  height: controlHeight.md - 6,
  padding: `0 ${space.lg}px`,
  background: colorVar.panel,
  border: '1px solid transparent',
  borderRadius: radius.md,
  display: 'inline-flex',
  alignItems: 'center',
  gap: space.sm + 2,
  fontSize: fontSize.md - 1,
  color: colorVar.text,
  cursor: 'pointer',
  fontWeight: fontWeight.semibold,
  whiteSpace: 'nowrap',
  transition: motion.fast,
};

const menuBase = {
  position: 'absolute',
  left: 0,
  minWidth: 120,
  maxHeight: 240,
  overflowY: 'auto',
  background: colorVar.panelStrong || colorVar.panel,
  border: `1px solid ${colorVar.border}`,
  borderRadius: radius.md,
  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.25)',
  zIndex: 1000,
};

const itemBase = {
  padding: `${space.sm + 2}px ${space.md}px`,
  fontSize: fontSize.md - 1,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: space.sm + 2,
  color: colorVar.text,
  transition: motion.fast,
  background: 'transparent',
};

function getMenuPosition(position) {
  return position === 'top'
    ? { bottom: 'calc(100% + 6px)', top: 'auto' }
    : { top: 'calc(100% + 6px)', bottom: 'auto' };
}

export default function CanvasDropdown({
  value,
  onChange,
  options = [],
  trigger,
  position = 'bottom',
  align = 'left',
  placeholder,
  style,
  buttonStyle,
  ...rest
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const current = options.find((o) => o.value === value) || null;

  useEffect(() => {
    if (!open) return undefined;
    const handle = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const handleKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-block', ...style }} {...rest}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        style={{ ...triggerBase, ...buttonStyle }}
        title={current?.label}
      >
        {trigger || current?.label || placeholder || '选择'}
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{
            opacity: 0.6,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: motion.fast,
            flexShrink: 0,
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          style={{
            ...menuBase,
            ...getMenuPosition(position),
            ...(align === 'right' ? { left: 'auto', right: 0 } : {}),
          }}
        >
          {options.map((opt) => {
            const selected = opt.value === value;
            return (
              <div
                key={String(opt.value)}
                role="option"
                aria-selected={selected}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange && onChange(opt.value);
                  setOpen(false);
                }}
                onMouseEnter={(e) => {
                  if (!selected) e.currentTarget.style.background = colorVar.soft;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
                style={{
                  ...itemBase,
                  ...(selected ? { background: colorVar.soft, color: colorVar.text } : {}),
                }}
              >
                {opt.icon}
                {opt.label}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
