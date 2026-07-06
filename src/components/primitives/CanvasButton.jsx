import { space, radius, fontSize, fontWeight, motion, controlHeight, colorVar } from '../../styles/tokens';

const VARIANT_BASE = {
  height: controlHeight.md,
  padding: `0 ${space.xl}px`,
  borderRadius: radius.lg,
  border: '1px solid transparent',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: space.sm,
  fontSize: fontSize.md,
  fontWeight: fontWeight.bold,
  cursor: 'pointer',
  transition: motion.normal,
  whiteSpace: 'nowrap',
};

const VARIANT_STYLE = {
  primary: {
    background: colorVar.accent,
    color: colorVar.bg,
    border: `1px solid ${colorVar.accent}`,
  },
  secondary: {
    background: colorVar.panel,
    color: colorVar.textSecondary,
    border: `1px solid ${colorVar.border}`,
  },
  ghost: {
    background: 'transparent',
    color: colorVar.textSecondary,
    border: `1px solid ${colorVar.border}`,
  },
  danger: {
    background: 'transparent',
    color: '#dc2626',
    border: '1px solid #fecaca',
  },
};

const SIZE_STYLE = {
  sm: { height: controlHeight.sm, fontSize: fontSize.sm, padding: `0 ${space.md}px`, borderRadius: radius.md },
  md: { height: controlHeight.md, fontSize: fontSize.md, padding: `0 ${space.xl}px`, borderRadius: radius.lg },
  lg: { height: controlHeight.lg, fontSize: fontSize.lg, padding: `0 ${space.xxl}px`, borderRadius: radius.lg },
};

function hoverStyle(variant) {
  if (variant === 'primary') return { background: colorVar.accentStrong };
  if (variant === 'secondary') return { background: colorVar.soft, color: colorVar.text };
  if (variant === 'danger') return { background: 'rgba(220,38,38,0.08)' };
  return { background: colorVar.soft, color: colorVar.text };
}

export default function CanvasButton({
  variant = 'secondary',
  size = 'md',
  icon,
  children,
  disabled,
  onClick,
  style,
  ...rest
}) {
  const composedStyle = {
    ...VARIANT_BASE,
    ...SIZE_STYLE[size],
    ...VARIANT_STYLE[variant],
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
    ...style,
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={(e) => {
        if (disabled) return;
        Object.assign(e.currentTarget.style, hoverStyle(variant));
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        const base = { ...VARIANT_STYLE[variant] };
        e.currentTarget.style.background = base.background || '';
        e.currentTarget.style.color = base.color || '';
      }}
      style={composedStyle}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}