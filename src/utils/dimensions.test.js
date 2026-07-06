import { describe, it, expect } from 'vitest';
import { ASPECT_RATIOS, RESOLUTIONS, getAspectPixelSize } from './dimensions';

describe('ASPECT_RATIOS schema', () => {
  it('has unique labels', () => {
    const labels = ASPECT_RATIOS.map(r => r.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('every entry has positive ratio', () => {
    for (const r of ASPECT_RATIOS) {
      expect(r.ratio).toBeGreaterThan(0);
    }
  });
});

describe('RESOLUTIONS schema', () => {
  it('has unique labels', () => {
    const labels = RESOLUTIONS.map(r => r.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('sizes are increasing', () => {
    for (let i = 1; i < RESOLUTIONS.length; i++) {
      expect(RESOLUTIONS[i].size).toBeGreaterThan(RESOLUTIONS[i - 1].size);
    }
  });
});

describe('getAspectPixelSize', () => {
  it('1:1 returns equal width and height', () => {
    expect(getAspectPixelSize('1:1', 512)).toEqual({ width: 512, height: 512 });
  });

  it('landscape ratio keeps width at baseSize', () => {
    expect(getAspectPixelSize('16:9', 512)).toEqual({ width: 512, height: Math.round(512 / 1.778) });
  });

  it('portrait ratio keeps height at baseSize', () => {
    expect(getAspectPixelSize('9:16', 512)).toEqual({ width: Math.round(512 * 0.5625), height: 512 });
  });

  it('returns square fallback for unknown label', () => {
    expect(getAspectPixelSize('99:99', 512)).toEqual({ width: 512, height: 512 });
  });

  it('defaults baseSize to 512', () => {
    expect(getAspectPixelSize('1:1')).toEqual({ width: 512, height: 512 });
  });
});