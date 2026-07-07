import { ASPECT_RATIOS } from './dimensions';

export const GRID_SIZE = 20;

export function snapToGrid(value) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

export function getNodeSize(aspectRatio, type) {
  if (type === 'text') {
    return { width: 373, height: 210 };
  }
  if (type === 'media') {
    return { width: 373, height: 210 };
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
