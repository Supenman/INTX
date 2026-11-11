import { describe, expect, it } from 'vitest';
import type { ProjectEdge, ProjectNode } from '../schema/project';
import {
  LAYOUT_STEP_X,
  LAYOUT_STEP_Y,
  alignNodes,
  autoLayout,
  distributeNodes,
  freeBatchOffset,
} from './layout';

function node(id: string, x: number, y: number, defKind = 'text-input', w = 260, h = 180): ProjectNode {
  return { id, defKind, position: { x, y }, size: { width: w, height: h }, params: {} };
}

function edge(source: string, target: string): ProjectEdge {
  return { id: `${source}-${target}`, source, sourcePort: 'out', target, targetPort: 'in' };
}

const ids = (...list: string[]) => list;

describe('alignNodes', () => {
  const a = node('a', 10, 20, 'text-input', 200, 100);
  const b = node('b', 130, 90, 'generate', 300, 160);

  it('少于两个节点时不动手', () => {
    expect(alignNodes([a], ids('a'), 'left')).toEqual({});
    expect(alignNodes([], ids(), 'left')).toEqual({});
  });

  it('左对齐取包围盒最小 x', () => {
    expect(alignNodes([a, b], ids('a', 'b'), 'left')).toEqual({
      a: { x: 10, y: 20 },
      b: { x: 10, y: 90 },
    });
  });

  it('右对齐按各自宽度贴齐同一右边界', () => {
    // 包围盒右边界 = max(10+200, 130+300) = 430
    expect(alignNodes([a, b], ids('a', 'b'), 'right')).toEqual({
      a: { x: 230, y: 20 },
      b: { x: 130, y: 90 },
    });
  });

  it('顶对齐与底对齐分别取最小 y / 最大底边', () => {
    expect(alignNodes([a, b], ids('a', 'b'), 'top')).toEqual({
      a: { x: 10, y: 20 },
      b: { x: 130, y: 20 },
    });
    expect(alignNodes([a, b], ids('a', 'b'), 'bottom')).toEqual({
      a: { x: 10, y: 150 },
      b: { x: 130, y: 90 },
    });
  });

  it('水平居中按包围盒中心线、按各自宽度反算 x', () => {
    // centerX = (10 + 430) / 2 = 220
    expect(alignNodes([a, b], ids('a', 'b'), 'center-x')).toEqual({
      a: { x: 120, y: 20 },
      b: { x: 70, y: 90 },
    });
  });

  it('返回所有选中节点的目标位置，而不是只返回改动项', () => {
    const same = node('c', 10, 20, 'text-input', 200, 100);
    expect(alignNodes([a, same], ids('a', 'c'), 'left')).toEqual({
      a: { x: 10, y: 20 },
      c: { x: 10, y: 20 },
    });
  });
});

describe('distributeNodes', () => {
  it('少于三个节点时不动手', () => {
    const a = node('a', 0, 0);
    const b = node('b', 500, 0);
    expect(distributeNodes([a, b], ids('a', 'b'), 'horizontal')).toEqual({});
  });

  it('水平等距按中心点均分，首尾保持不动', () => {
    const a = node('a', 0, 10, 'text-input', 100, 100);
    const b = node('b', 210, 10, 'text-input', 100, 100);
    const c = node('c', 900, 10, 'text-input', 100, 100);
    // 中心 50 / 260 / 950 → 步长 450 → b 中心应为 500 → x = 450
    expect(distributeNodes([a, b, c], ids('a', 'b', 'c'), 'horizontal')).toEqual({
      a: { x: 0, y: 10 },
      b: { x: 450, y: 10 },
      c: { x: 900, y: 10 },
    });
  });

  it('宽度不同时按中心等距，而不是按左边界', () => {
    const a = node('a', 0, 0, 'text-input', 100, 100);
    const b = node('b', 300, 0, 'generate', 300, 100);
    const c = node('c', 900, 0, 'text-input', 100, 100);
    // 中心 50 / 450 / 950 → 步长 450 → b 中心 500 → x = 500 - 150 = 350
    expect(distributeNodes([a, b, c], ids('a', 'b', 'c'), 'horizontal')).toEqual({
      a: { x: 0, y: 0 },
      b: { x: 350, y: 0 },
      c: { x: 900, y: 0 },
    });
  });
});

describe('autoLayout', () => {
  it('有连线时按最长路径分层，横向从左到右', () => {
    const a = node('a', 0, 0, 'text-input');
    const b = node('b', 700, 400, 'generate');
    const c = node('c', 1200, 800, 'asset');
    const out = autoLayout([a, b, c], [edge('a', 'b'), edge('b', 'c')]);
    expect(out.a?.x).toBe(0);
    expect(out.b?.x).toBe(LAYOUT_STEP_X);
    expect(out.c?.x).toBe(LAYOUT_STEP_X * 2);
  });

  it('A→B→C 与 A→C 并存时 C 落在 B 之后，连线不折回', () => {
    const a = node('a', 0, 0, 'text-input');
    const b = node('b', 500, 0, 'generate');
    const c = node('c', 900, 0, 'asset');
    const out = autoLayout([a, b, c], [edge('a', 'b'), edge('b', 'c'), edge('a', 'c')]);
    expect(out.c?.x).toBe(LAYOUT_STEP_X * 2);
  });

  it('没有连线时按类型泳道分列，不混排', () => {
    const text1 = node('t1', 0, 0, 'text-input');
    const text2 = node('t2', 50, 500, 'text-input');
    const gen = node('g1', 800, 10, 'generate');
    const out = autoLayout([text1, text2, gen], []);
    expect(out.t1?.x).toBe(0);
    expect(out.t2?.x).toBe(0);
    expect(out.g1?.x).toBe(LAYOUT_STEP_X);
    expect(out.t2?.y).toBe((out.t1?.y ?? 0) + LAYOUT_STEP_Y);
  });

  it('给了 scopeIds 就只整理选中的节点', () => {
    const a = node('a', 0, 0, 'text-input');
    const b = node('b', 900, 600, 'generate');
    const untouched = node('u', 2000, 2000, 'asset');
    const out = autoLayout([a, b, untouched], [edge('a', 'b')], { scopeIds: ids('a', 'b') });
    expect(out.u).toBeUndefined();
    expect(out.a).toBeDefined();
  });

  it('有环时不死循环，环内节点统一落到最后一层之后', () => {
    const a = node('a', 0, 0, 'text-input');
    const b = node('b', 10, 0, 'generate');
    const c = node('c', 20, 0, 'asset');
    const out = autoLayout([a, b, c], [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')]);
    expect(Object.keys(out)).toHaveLength(3);
    const xs = Object.values(out).map((p) => p.x);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(LAYOUT_STEP_X);
  });

  it('以选区包围盒左上角为锚点，整理后不整体漂移', () => {
    const a = node('a', 500, 300, 'text-input');
    const b = node('b', 1200, 900, 'generate');
    const out = autoLayout([a, b], [edge('a', 'b')]);
    expect(out.a?.x).toBe(500);
    expect(out.a?.y).toBe(300);
  });

  it('自连边不算依赖层级', () => {
    const a = node('a', 30, 40, 'text-input');
    const out = autoLayout([a], [edge('a', 'a')]);
    expect(out).toEqual({});
  });
});

/** 与 freeBatchOffset 内部同一套「算不算压住了」判据。 */
const apart = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs(a.x - b.x) >= LAYOUT_STEP_X - 20 || Math.abs(a.y - b.y) >= LAYOUT_STEP_Y - 20;

describe('freeBatchOffset', () => {
  it('首选偏移不冲突时原样保留，调用方给的自定义偏移仍然生效', () => {
    expect(freeBatchOffset([{ x: 0, y: 0 }], [{ x: 1000, y: 1000 }], { x: 60, y: 80 })).toEqual({ x: 60, y: 80 });
  });

  it('默认的 +40,+40 会压在原节点上，必须换成不重叠的落点', () => {
    const src = { x: 100, y: 200 };
    const shift = freeBatchOffset([src], [src]);
    expect(shift).not.toEqual({ x: 40, y: 40 });
    expect(apart({ x: src.x + shift.x, y: src.y + shift.y }, src)).toBe(true);
  });

  it('整批副本共用一个平移量，相对布局保持不变', () => {
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 400, y: 0 };
    const p2 = { x: 0, y: 320 };
    const positions = [p0, p1, p2];
    const shift = freeBatchOffset(positions, positions);
    const c0 = { x: p0.x + shift.x, y: p0.y + shift.y };
    const c1 = { x: p1.x + shift.x, y: p1.y + shift.y };
    const c2 = { x: p2.x + shift.x, y: p2.y + shift.y };
    expect(c1.x - c0.x).toBe(400);
    expect(c2.y - c0.y).toBe(320);
    for (const c of [c0, c1, c2]) for (const o of positions) expect(apart(c, o)).toBe(true);
  });

  it('已有节点很密时也绝不退回重叠', () => {
    const occupied: { x: number; y: number }[] = [];
    for (let i = 0; i < 60; i += 1) occupied.push({ x: (i % 8) * 400, y: Math.floor(i / 8) * 340 });
    const p0 = { x: 0, y: 0 };
    const shift = freeBatchOffset([p0], occupied);
    const copy = { x: p0.x + shift.x, y: p0.y + shift.y };
    for (const o of occupied) expect(apart(copy, o)).toBe(true);
  });

  it('空批次不做无意义的扫描', () => {
    expect(freeBatchOffset([], [], { x: 7, y: 9 })).toEqual({ x: 7, y: 9 });
  });
});
