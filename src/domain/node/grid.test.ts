import { describe, expect, it } from 'vitest';
import { MAX_GRID_CELLS, gridLayout, parseGrid } from './grid';

describe('parseGrid', () => {
  it('按 行x列 解析常规宫格', () => {
    expect(parseGrid('2x2')).toEqual({ rows: 2, cols: 2, total: 4 });
    expect(parseGrid('3x3')).toEqual({ rows: 3, cols: 3, total: 9 });
    expect(parseGrid('4x4')).toEqual({ rows: 4, cols: 4, total: 16 });
  });

  it('1x4 是 1 行 4 列的条漫，不是 4 行 1 列', () => {
    expect(parseGrid('1x4')).toEqual({ rows: 1, cols: 4, total: 4 });
  });

  it('非法或残缺规格退回单格，不抛错', () => {
    for (const bad of ['', 'abc', '2', 'x2', '2x', '  ']) {
      expect(parseGrid(bad)).toEqual({ rows: 1, cols: 1, total: 1 });
    }
  });

  it('大小写与首尾空格不敏感', () => {
    expect(parseGrid(' 2X2 ')).toEqual({ rows: 2, cols: 2, total: 4 });
  });

  it('0 或负数维度收敛到 1', () => {
    expect(parseGrid('0x3')).toEqual({ rows: 1, cols: 3, total: 3 });
    expect(parseGrid('2x0')).toEqual({ rows: 2, cols: 1, total: 2 });
  });

  it('超过 16 格时裁到上限，且 total 与 rows*cols 一致', () => {
    const shape = parseGrid('9x9');
    expect(shape.total).toBeLessThanOrEqual(MAX_GRID_CELLS);
    expect(shape.total).toBe(shape.rows * shape.cols);
  });
});

describe('gridLayout', () => {
  it('2x2 按行优先排布，间距计入总尺寸', () => {
    const l = gridLayout('2x2', 100, 80, 10);
    expect(l.width).toBe(210);
    expect(l.height).toBe(170);
    expect(l.cells).toHaveLength(4);
    expect(l.cells[0]).toMatchObject({ row: 0, col: 0, x: 0, y: 0 });
    expect(l.cells[1]).toMatchObject({ row: 0, col: 1, x: 110, y: 0 });
    expect(l.cells[2]).toMatchObject({ row: 1, col: 0, x: 0, y: 90 });
    expect(l.cells[3]).toMatchObject({ row: 1, col: 1, x: 110, y: 90 });
  });

  it('1x4 条漫是一行四格，所有格 y 都是 0', () => {
    const l = gridLayout('1x4', 100, 80, 10);
    expect(l.width).toBe(430);
    expect(l.height).toBe(80);
    expect(l.cells.map((c) => c.y)).toEqual([0, 0, 0, 0]);
    expect(l.cells.map((c) => c.x)).toEqual([0, 110, 220, 330]);
  });

  it('格数不足时只给实际格数，不生成空位', () => {
    expect(gridLayout('3x3', 10, 10).cells).toHaveLength(9);
  });

  it('异常尺寸与负间距不会算出负数画布', () => {
    const l = gridLayout('2x2', 0, -5, -10);
    expect(l.width).toBeGreaterThan(0);
    expect(l.height).toBeGreaterThan(0);
    expect(l.cells[1]!.x).toBeGreaterThan(0);
  });
});
