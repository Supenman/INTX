// Single source of truth for design tokens used by Canvas primitives.
// CSS variables in index.css provide runtime theming; this file gives
// the primitive components their JavaScript-readable counterparts.

export const space = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  xxl: 24,
};

export const radius = {
  sm: 6,
  md: 8,
  lg: 10,
  xl: 12,
  pill: 999,
};

export const fontSize = {
  xs: 10,
  sm: 11,
  md: 12,
  lg: 13,
  xl: 14,
};

export const fontWeight = {
  regular: 500,
  semibold: 600,
  bold: 700,
  black: 800,
};

export const motion = {
  fast: '0.15s var(--ease-out)',
  normal: '0.2s var(--ease-out)',
  slow: '0.28s var(--ease-out)',
};

export const controlHeight = {
  sm: 26,
  md: 32,
  lg: 40,
};

// Re-exported from index.css when needed; kept here so primitives do not
// need to know about var(—…) directly.
export const colorVar = {
  panel: 'var(--panel)',
  panelStrong: 'var(--panel-bg-strong)',
  text: 'var(--text)',
  textSecondary: 'var(--muted)',
  textTertiary: 'var(--faint)',
  accent: 'var(--accent)',
  accentStrong: 'var(--accent-strong)',
  border: 'var(--line)',
  borderStrong: 'var(--line-strong)',
  soft: 'var(--soft)',
  bg: 'var(--bg)',
  // signal colors for canvas accents
  signalImage: 'var(--signal-image)',
  signalText: 'var(--signal-text)',
  signalVideo: 'var(--signal-video)',
  signalError: 'var(--signal-error)',
};

export default {
  space,
  radius,
  fontSize,
  fontWeight,
  motion,
  controlHeight,
  colorVar,
};
