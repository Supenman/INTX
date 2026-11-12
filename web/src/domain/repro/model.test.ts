import { describe, expect, it } from 'vitest';
import type { GenerationParams } from '../task/model';
import { buildReproPackage, parseRepro, serializeRepro, validateRepro } from './model';

const params: GenerationParams = {
  kind: 'image',
  prompt: 'a cat on a chair',
  model: 'demo/image',
  providerId: 'demo',
  inputAssetIds: ['ref1'],
  aspectRatio: '1:1',
};

const base = {
  taskId: 'tk1',
  params,
  references: [{ hash: 'h1', mime: 'image/png', bytesB64: 'AAA' }],
  results: [{ hash: 'h2', mime: 'image/png', bytesB64: 'BBB' }],
};

describe('buildReproPackage', () => {
  it('组装带版本与时间的复现包', () => {
    const pkg = buildReproPackage({ ...base, now: 1700000000000 });
    expect(pkg.version).toBe(1);
    expect(pkg.exportedAt).toBe(1700000000000);
    expect(pkg.params).toBe(params);
    expect(pkg.references).toHaveLength(1);
  });

  it('缺省 references/results 时为空数组', () => {
    const pkg = buildReproPackage({ taskId: 'x', params, now: 1 });
    expect(pkg.references).toEqual([]);
    expect(pkg.results).toEqual([]);
  });
});

describe('serialize / parse 往返', () => {
  it('序列化后解析回来结构一致', () => {
    const pkg = buildReproPackage({ ...base, now: 1 });
    const parsed = parseRepro(serializeRepro(pkg));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.taskId).toBe('tk1');
      expect(parsed.value.results[0]!.hash).toBe('h2');
    }
  });

  it('坏 JSON 返回 bad_json', () => {
    const r = parseRepro('{not json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('bad_json');
  });

  it('版本不符返回 unsupported_version', () => {
    const r = parseRepro(JSON.stringify({ ...base, version: 99 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('unsupported_version');
  });
});

describe('validateRepro', () => {
  it('缺参数返回 missing_params', () => {
    const bad = buildReproPackage({ taskId: 'x', params: { ...params, model: '' } as GenerationParams, now: 1 });
    const errors = validateRepro(bad);
    expect(errors.some((e) => e.code === 'missing_params')).toBe(true);
  });

  it('资产缺字段返回 missing_asset_field', () => {
    const bad = buildReproPackage({
      taskId: 'x',
      params,
      references: [{ mime: 'image/png' } as never],
      now: 1,
    });
    const errors = validateRepro(bad);
    expect(errors.some((e) => e.code === 'missing_asset_field')).toBe(true);
  });

  it('合法包返回空错误数组', () => {
    expect(validateRepro(buildReproPackage({ ...base, now: 1 }))).toEqual([]);
  });
});
