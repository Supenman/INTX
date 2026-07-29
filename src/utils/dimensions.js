export const ASPECT_RATIOS = [
  { label: '1:1', ratio: 1 },
  { label: '4:3', ratio: 1.333 },
  { label: '3:4', ratio: 0.75 },
  { label: '16:9', ratio: 1.778 },
  { label: '9:16', ratio: 0.5625 },
  { label: '21:9', ratio: 2.333 },
  { label: '9:21', ratio: 0.4286 },
];

export const RESOLUTIONS = [
  { label: '480', size: 480 },
  { label: '720', size: 720 },
  { label: '1080', size: 1080 },
  { label: '4K', size: 2160 },
];

// 图片节点专用分辨率档位（默认 1080）
export const RESOLUTIONS_IMAGE = [
  { label: '1080', size: 1080 },
  { label: '2160', size: 2160 },
  { label: '3840', size: 3840 },
];

export function getAspectPixelSize(label, baseSize = 512) {
  const ar = ASPECT_RATIOS.find(r => r.label === label);
  if (!ar) return { width: baseSize, height: baseSize };
  if (ar.ratio >= 1) return { width: baseSize, height: Math.round(baseSize / ar.ratio) };
  return { width: Math.round(baseSize * ar.ratio), height: baseSize };
}