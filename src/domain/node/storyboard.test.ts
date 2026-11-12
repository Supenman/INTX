import { describe, expect, it } from 'vitest';
import {
  analyzeStoryboardScript,
  planStoryboardResume,
  replaceCell,
  storyboardLines,
} from './storyboard';

describe('storyboardLines', () => {
  it('按行拆、trim、滤空行，CRLF 与 LF 一致', () => {
    expect(storyboardLines(' a \r\n\r\n b \nc')).toEqual(['a', 'b', 'c']);
    expect(storyboardLines('  \n\t\n')).toEqual([]);
  });
});

describe('analyzeStoryboardScript', () => {
  it('空剧本 → empty（模型自行均分）', () => {
    expect(analyzeStoryboardScript('', '2x2')).toEqual({ kind: 'empty' });
    expect(analyzeStoryboardScript(' \n ', '2x2')).toEqual({ kind: 'empty' });
  });

  it('行数=格数 → exact', () => {
    expect(analyzeStoryboardScript('a\nb\nc\nd', '2x2')).toEqual({ kind: 'exact', lines: 4 });
  });

  it('行<格 → reuse，repeated=格-行', () => {
    expect(analyzeStoryboardScript('a\nb\nc', '2x2')).toEqual({ kind: 'reuse', lines: 3, cells: 4, repeated: 1 });
  });

  it('行>格 → drop，dropped=行-格', () => {
    expect(analyzeStoryboardScript('a\nb\nc\nd\ne', '2x2')).toEqual({ kind: 'drop', lines: 5, cells: 4, dropped: 1 });
  });
});

describe('planStoryboardResume', () => {
  const base = { grid: '3x2', aspectRatio: '1:1', style: '' };

  it('无已有产物 → fill startCell=0', () => {
    const plan = planStoryboardResume({ ...base, existingIds: [], snapshot: null });
    expect(plan).toEqual({ action: 'fill', startCell: 0, keepIds: [] });
  });

  it('已有 2 < 6 且参数一致 → fill startCell=2', () => {
    const plan = planStoryboardResume({
      ...base,
      existingIds: ['a', 'b'],
      snapshot: { grid: '3x2', aspectRatio: '1:1', style: '' },
    });
    expect(plan).toEqual({ action: 'fill', startCell: 2, keepIds: ['a', 'b'] });
  });

  it('已有 6 > 当前 4 → truncate 保留前 4，不发请求', () => {
    const plan = planStoryboardResume({
      ...base,
      grid: '2x2',
      existingIds: ['a', 'b', 'c', 'd', 'e', 'f'],
      snapshot: { grid: '3x2', aspectRatio: '1:1', style: '' },
    });
    expect(plan.action).toBe('truncate');
    if (plan.action === 'truncate') {
      expect(plan.keepIds).toEqual(['a', 'b', 'c', 'd']);
      expect(plan.dropped).toBe(2);
      expect(plan.message).toContain('资产库');
    }
  });

  it('已有 4 == 当前 4 → truncate 无操作提示', () => {
    const plan = planStoryboardResume({
      ...base,
      grid: '2x2',
      existingIds: ['a', 'b', 'c', 'd'],
      snapshot: { grid: '2x2', aspectRatio: '1:1', style: '' },
    });
    expect(plan.action).toBe('truncate');
    if (plan.action === 'truncate') {
      expect(plan.dropped).toBe(0);
      expect(plan.message).toContain('无需补格');
    }
  });

  it('参数漂移（grid）→ reject', () => {
    const plan = planStoryboardResume({
      ...base,
      existingIds: ['a', 'b'],
      snapshot: { grid: '2x2', aspectRatio: '1:1', style: '' },
    });
    expect(plan.action).toBe('reject');
    if (plan.action === 'reject') expect(plan.message).toContain('参数已变');
  });

  it('参数漂移（aspectRatio/style）→ reject', () => {
    const ratio = planStoryboardResume({
      ...base,
      existingIds: ['a'],
      snapshot: { grid: '3x2', aspectRatio: '16:9', style: '' },
    });
    expect(ratio.action).toBe('reject');
    const style = planStoryboardResume({
      ...base,
      style: '水彩',
      existingIds: ['a'],
      snapshot: { grid: '3x2', aspectRatio: '1:1', style: '' },
    });
    expect(style.action).toBe('reject');
  });

  it('旧快照缺字段 → 跳过该项比较，不判漂移', () => {
    const plan = planStoryboardResume({
      ...base,
      style: '新画风',
      existingIds: ['a', 'b'],
      snapshot: { grid: '3x2' }, // 旧快照没记 aspectRatio/style
    });
    expect(plan.action).toBe('fill');
  });

  it('snapshot=null（直接 API 调用）→ fill', () => {
    const plan = planStoryboardResume({ ...base, existingIds: ['a'], snapshot: null });
    expect(plan.action).toBe('fill');
  });
});

describe('replaceCell', () => {
  it('替换第 N 格，不追加、不动其余', () => {
    expect(replaceCell(['a', 'b', 'c', 'd'], 2, 'X')).toEqual(['a', 'b', 'X', 'd']);
  });

  it('替换第 0 格（主图位）', () => {
    expect(replaceCell(['a', 'b'], 0, 'X')).toEqual(['X', 'b']);
  });

  it('越界/非整数 → 原样返回', () => {
    expect(replaceCell(['a', 'b'], 5, 'X')).toEqual(['a', 'b']);
    expect(replaceCell(['a', 'b'], -1, 'X')).toEqual(['a', 'b']);
    expect(replaceCell(['a', 'b'], 1.5, 'X')).toEqual(['a', 'b']);
  });
});
