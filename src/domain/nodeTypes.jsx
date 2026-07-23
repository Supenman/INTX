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

const smallIconSourceText = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="12" y1="18" x2="12" y2="12" />
    <line x1="9" y1="15" x2="15" y2="15" />
  </svg>
);

const smallIconSourceImage = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
);

const smallIconSourceVideo = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <polygon points="10 8 16 12 10 16 10 8" />
  </svg>
);

const smallIconSourceAudio = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </svg>
);

const smallIconSourceMarkdown = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="10" y1="13" x2="8" y2="13" />
    <line x1="16" y1="13" x2="14" y2="13" />
    <line x1="12" y1="9" x2="12" y2="17" />
    <line x1="10" y1="17" x2="14" y2="17" />
  </svg>
);

export const NODE_TYPE_REGISTRY = {
  image: {
    id: 'image',
    title: '图片',
    smallIcon: smallIconImage,
    borderStyle: 'solid',
    labelEyebrow: 'FRAME',
    modelKey: 'image_models',
  },
  text: {
    id: 'text',
    title: '文字',
    smallIcon: smallIconText,
    borderStyle: 'dashed',
    labelEyebrow: 'SCRIPT',
    modelKey: 'chat_models',
  },
  video: {
    id: 'video',
    title: '视频',
    smallIcon: smallIconVideo,
    borderStyle: 'dotted',
    labelEyebrow: 'MOTION',
    modelKey: 'video_models',
  },
  'source-text': {
    id: 'source-text',
    title: '文本',
    smallIcon: smallIconSourceText,
    borderStyle: 'double',
    labelEyebrow: 'TEXT',
    modelKey: null,
  },
  'source-image': {
    id: 'source-image',
    title: '图像',
    smallIcon: smallIconSourceImage,
    borderStyle: 'solid',
    labelEyebrow: 'IMAGE',
    modelKey: null,
  },
  'source-video': {
    id: 'source-video',
    title: '视频',
    smallIcon: smallIconSourceVideo,
    borderStyle: 'groove',
    labelEyebrow: 'VIDEO',
    modelKey: null,
  },
  'source-audio': {
    id: 'source-audio',
    title: '音频',
    smallIcon: smallIconSourceAudio,
    borderStyle: 'outset',
    labelEyebrow: 'AUDIO',
    modelKey: null,
  },
  'source-markdown': {
    id: 'source-markdown',
    title: 'Markdown',
    smallIcon: smallIconSourceMarkdown,
    borderStyle: 'ridge',
    labelEyebrow: 'MD',
    modelKey: null,
  },
};

export const NODE_TYPES = Object.keys(NODE_TYPE_REGISTRY);

export const getNodeMeta = (type) => NODE_TYPE_REGISTRY[type] || NODE_TYPE_REGISTRY.image;
