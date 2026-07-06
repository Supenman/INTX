import { describe, it, expect } from 'vitest';
import { getNodeSize } from './nodeSize';

describe('getNodeSize', () => {
  it('text nodes have fixed dimensions regardless of ratio', () => {
    expect(getNodeSize('16:9', 'text')).toEqual({ width: 260, height: 190 });
    expect(getNodeSize('1:1', 'text')).toEqual({ width: 260, height: 190 });
  });

  it('1:1 is square', () => {
    const s = getNodeSize('1:1', 'image');
    expect(s.width).toBe(s.height);
  });

  it('landscape aspect makes width > height', () => {
    const s = getNodeSize('16:9', 'image');
    expect(s.width).toBeGreaterThan(s.height);
  });

  it('portrait aspect makes height > width', () => {
    const s = getNodeSize('9:16', 'image');
    expect(s.height).toBeGreaterThan(s.width);
  });

  it('21:9 ultra-wide is the widest ratio', () => {
    const wide = getNodeSize('21:9', 'image').width;
    const standard = getNodeSize('16:9', 'image').width;
    expect(wide).toBeGreaterThan(standard);
  });

  it('unknown ratio falls back to 16:9 proportions', () => {
    const fallback = getNodeSize('99:99', 'image');
    const sixteen = getNodeSize('16:9', 'image');
    expect(fallback).toEqual(sixteen);
  });
});