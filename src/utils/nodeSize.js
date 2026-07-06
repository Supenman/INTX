import { ASPECT_RATIOS } from './dimensions';

export function getNodeSize(aspectRatio, type) {
  if (type === 'text') {
    return { width: 260, height: 190 };
  }
  if (type === 'media') {
    return { width: 220, height: 220 };
  }

  const ar = ASPECT_RATIOS.find(r => r.label === aspectRatio);
  const ratio = ar ? ar.ratio : 1.778;

  const baseSize = 210;
  let widthRatio, heightRatio;

  if (ratio >= 1) { widthRatio = ratio; heightRatio = 1; }
  else { widthRatio = 1; heightRatio = 1 / ratio; }

  return {
    width: Math.round(baseSize * widthRatio),
    height: Math.round(baseSize * heightRatio),
  };
}
