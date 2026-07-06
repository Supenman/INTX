/* eslint-disable react-refresh/only-export-components */
const smallIconImage = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
);

const smallIconText = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4 7 4 4 20 4 20 7" />
    <line x1="12" y1="4" x2="12" y2="20" />
    <line x1="9" y1="20" x2="15" y2="20" />
  </svg>
);

const smallIconVideo = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

const smallIconMedia = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

export const NODE_TYPE_REGISTRY = {
  image: {
    id: 'image',
    title: '图片',
    smallIcon: smallIconImage,
    accentVar: 'var(--signal-image)',
    accentRgb: 'var(--signal-image-rgb)',
    labelEyebrow: 'FRAME',
    modelKey: 'image_models',
  },
  text: {
    id: 'text',
    title: '文字',
    smallIcon: smallIconText,
    accentVar: 'var(--signal-text)',
    accentRgb: 'var(--signal-text-rgb)',
    labelEyebrow: 'SCRIPT',
    modelKey: 'chat_models',
  },
  video: {
    id: 'video',
    title: '视频',
    smallIcon: smallIconVideo,
    accentVar: 'var(--signal-video)',
    accentRgb: 'var(--signal-video-rgb)',
    labelEyebrow: 'MOTION',
    modelKey: 'video_models',
  },
  media: {
    id: 'media',
    title: '素材',
    smallIcon: smallIconMedia,
    accentVar: 'var(--signal-image)',
    accentRgb: 'var(--signal-image-rgb)',
    labelEyebrow: 'ASSET',
    modelKey: null,
  },
};

export const NODE_TYPES = Object.keys(NODE_TYPE_REGISTRY);

export const getNodeMeta = (type) => NODE_TYPE_REGISTRY[type] || NODE_TYPE_REGISTRY.image;
