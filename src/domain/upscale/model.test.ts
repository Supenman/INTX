import { describe, expect, it } from 'vitest';
import { UPSCALE_SCALES, isUpscaleScale, upscaledSize } from './model';

describe('超分倍率', () => {
  it('只认 2 和 4', () => {
    expect(UPSCALE_SCALES).toEqual([2, 4]);
    expect(isUpscaleScale(2)).toBe(true);
    expect(isUpscaleScale(4)).toBe(true);
    for (const bad of [1, 3, 8, '2', null, undefined, 2.5, NaN]) {
      expect(isUpscaleScale(bad)).toBe(false);
    }
  });
});

describe('输出尺寸', () => {
  it('严格等于原图尺寸乘以倍率', () => {
    expect(upscaledSize(700, 700, 2)).toEqual({ width: 1400, height: 1400 });
    expect(upscaledSize(595, 335, 4)).toEqual({ width: 2380, height: 1340 });
  });

  it('非整数源尺寸四舍五入，不产生小数像素', () => {
    const r = upscaledSize(333.4, 200.6, 2);
    expect(r).toEqual({ width: 667, height: 401 });
    expect(Number.isInteger(r.width) && Number.isInteger(r.height)).toBe(true);
  });

  it('退化输入也至少给出 1 像素，不返回 0 让 canvas 崩掉', () => {
    expect(upscaledSize(0, 0, 4)).toEqual({ width: 1, height: 1 });
    expect(upscaledSize(-5, -5, 2)).toEqual({ width: 1, height: 1 });
  });

  it('宽高各自独立放大，不改变宽高比', () => {
    const { width, height } = upscaledSize(1600, 900, 4);
    expect(width / height).toBeCloseTo(1600 / 900, 5);
  });
});
