import { describe, expect, it } from 'vitest';
import {
  ASPECT_PRESETS,
  MIN_CROP_SIZE,
  aspectValue,
  cropFromDrag,
  cropToPixels,
  fitAspect,
  normalizeCrop,
  normalizedRatio,
  type CropRect,
} from './crop';

/** 输出像素宽高比，用来验证「比例」到底是不是落在最终图上。 */
function pixelRatio(r: CropRect, imageW: number, imageH: number): number {
  return (r.width * imageW) / (r.height * imageH);
}

function inside(r: CropRect): boolean {
  return r.x >= 0 && r.y >= 0 && r.x + r.width <= 1.000001 && r.y + r.height <= 1.000001 && r.width > 0 && r.height > 0;
}

describe('normalizeCrop', () => {
  it('从右下往左上拖也能翻正', () => {
    const r = normalizeCrop({ x: 0.8, y: 0.8, width: -0.5, height: -0.5 });
    expect(r.x).toBeCloseTo(0.3);
    expect(r.y).toBeCloseTo(0.3);
    expect(r.width).toBeCloseTo(0.5);
    expect(r.height).toBeCloseTo(0.5);
  });

  it('超出图像四边一律钳回去', () => {
    const r = normalizeCrop({ x: -0.2, y: 0.9, width: 2, height: 0.5 });
    expect(inside(r)).toBe(true);
    expect(r.x).toBe(0);
    expect(r.x + r.width).toBeCloseTo(1);
  });

  it('误触般的小框兜到最小尺寸，不导出 1px 图', () => {
    const r = normalizeCrop({ x: 0.5, y: 0.5, width: 0.001, height: 0.001 });
    expect(r.width).toBe(MIN_CROP_SIZE);
    expect(r.height).toBe(MIN_CROP_SIZE);
    expect(inside(r)).toBe(true);
  });

  it('NaN 与 Infinity 不会产生脏矩形', () => {
    const r = normalizeCrop({ x: Number.NaN, y: 0, width: Number.POSITIVE_INFINITY, height: 0.5 });
    expect(inside(r)).toBe(true);
  });
});

describe('比例换算', () => {
  it('free 没有约束，其余预设都能解析', () => {
    expect(aspectValue('free')).toBeNull();
    expect(aspectValue('16:9')).toBeCloseTo(16 / 9);
    expect(aspectValue('9:16')).toBeCloseTo(9 / 16);
    expect(ASPECT_PRESETS.length).toBeGreaterThan(3);
  });

  it('1:1 在 1600x900 上的归一化宽高比是 900:1600，不是 1:1', () => {
    expect(normalizedRatio(1, 1600, 900)).toBeCloseTo(0.5625);
    expect(normalizedRatio(16 / 9, 1600, 900)).toBeCloseTo(1);
  });

  it('宽图上选 1:1，输出像素确实是正方形', () => {
    const r = fitAspect({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, 1, 1600, 900);
    expect(pixelRatio(r, 1600, 900)).toBeCloseTo(1);
    expect(inside(r)).toBe(true);
  });

  it('宽图上选 16:9，归一化框还是 1:1（换算不能忘）', () => {
    const r = fitAspect({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, 16 / 9, 1600, 900);
    expect(pixelRatio(r, 1600, 900)).toBeCloseTo(16 / 9);
    expect(r.width).toBeCloseTo(r.height);
  });

  it('竖图上选 9:16 同样落在输出像素上', () => {
    const r = fitAspect({ x: 0.2, y: 0.2, width: 0.4, height: 0.4 }, 9 / 16, 900, 1600);
    expect(pixelRatio(r, 900, 1600)).toBeCloseTo(9 / 16);
    expect(inside(r)).toBe(true);
  });

  it('free 与非法比例都退回自由矩形', () => {
    const base = { x: 0.1, y: 0.3, width: 0.4, height: 0.2 };
    expect(fitAspect(base, null, 1000, 500)).toEqual(normalizeCrop(base));
    expect(fitAspect(base, 0, 1000, 500)).toEqual(normalizeCrop(base));
  });

  it('贴边的框切比例后仍不越界', () => {
    const r = fitAspect({ x: 0.9, y: 0.9, width: 0.1, height: 0.1 }, 9 / 16, 1600, 900);
    expect(inside(r)).toBe(true);
  });
});

describe('cropFromDrag', () => {
  it('自由拖拽得到起点到终点的矩形', () => {
    const r = cropFromDrag({ x: 0.2, y: 0.2 }, { x: 0.7, y: 0.6 }, null, 1600, 900);
    expect(r.x).toBeCloseTo(0.2);
    expect(r.y).toBeCloseTo(0.2);
    expect(r.width).toBeCloseTo(0.5);
    expect(r.height).toBeCloseTo(0.4);
  });

  it('反向拖拽框朝左上长，不会往反方向跑', () => {
    const r = cropFromDrag({ x: 0.8, y: 0.8 }, { x: 0.3, y: 0.3 }, null, 1600, 900);
    expect(r.x).toBeCloseTo(0.3);
    expect(r.y).toBeCloseTo(0.3);
    expect(inside(r)).toBe(true);
  });

  it('带比例拖拽时输出像素比仍然正确', () => {
    const r = cropFromDrag({ x: 0.2, y: 0.2 }, { x: 0.7, y: 0.6 }, 1, 1600, 900);
    expect(pixelRatio(r, 1600, 900)).toBeCloseTo(1);
    expect(inside(r)).toBe(true);
  });

  it('从右下角往左上拖大框也不越界', () => {
    const r = cropFromDrag({ x: 0.95, y: 0.9 }, { x: 0.4, y: 0.2 }, 16 / 9, 1600, 900);
    expect(inside(r)).toBe(true);
    expect(pixelRatio(r, 1600, 900)).toBeCloseTo(16 / 9);
  });
});

describe('cropToPixels', () => {
  it('满图裁切得到原尺寸', () => {
    expect(cropToPixels({ x: 0, y: 0, width: 1, height: 1 }, 1600, 900)).toEqual({
      x: 0,
      y: 0,
      width: 1600,
      height: 900,
    });
  });

  it('越界矩形钳到图像内，且至少 1px', () => {
    const px = cropToPixels({ x: 0.5, y: 0.5, width: 2, height: 2 }, 100, 80);
    expect(px.x + px.width).toBeLessThanOrEqual(100);
    expect(px.y + px.height).toBeLessThanOrEqual(80);
    expect(px.width).toBeGreaterThanOrEqual(1);
    expect(px.height).toBeGreaterThanOrEqual(1);
  });

  it('非整数原图尺寸也能整除落点', () => {
    const px = cropToPixels({ x: 0.25, y: 0.5, width: 0.5, height: 0.5 }, 701, 453);
    expect(Number.isInteger(px.x) && Number.isInteger(px.width)).toBe(true);
    expect(px.x + px.width).toBeLessThanOrEqual(701);
    expect(px.y + px.height).toBeLessThanOrEqual(453);
  });
});
