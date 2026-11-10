import { describe, expect, it } from 'vitest';
import {
  createAsset,
  findByHash,
  isAlive,
  kindFromMime,
  restoreAsset,
  softDeleteAsset,
} from './model';

const base = {
  mime: 'image/png',
  path: 'assets/a.png',
  bytes: 1024,
  hash: 'h1',
  origin: { type: 'import' as const },
};

describe('kindFromMime', () => {
  it('按 mime 推导 kind', () => {
    expect(kindFromMime('image/png')).toBe('image');
    expect(kindFromMime('video/mp4')).toBe('video');
    expect(kindFromMime('audio/mpeg')).toBe('audio');
    expect(kindFromMime('text/markdown')).toBe('text');
  });

  it('容忍大小写与 charset 后缀', () => {
    expect(kindFromMime('IMAGE/PNG')).toBe('image');
    expect(kindFromMime('text/plain; charset=utf-8')).toBe('text');
  });

  it('不认识的类型返回 null', () => {
    expect(kindFromMime('application/x-shockwave-flash')).toBeNull();
  });
});

describe('createAsset', () => {
  it('创建成功时 kind 由 mime 决定', () => {
    const r = createAsset({ ...base, id: 'as1' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.kind).toBe('image');
      expect(r.value.id).toBe('as1');
    }
  });

  it('拒绝不支持的 mime', () => {
    const r = createAsset({ ...base, mime: 'application/zip' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('invalid_mime');
  });

  it('拒绝没有哈希的资产（无法去重）', () => {
    const r = createAsset({ ...base, hash: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('empty_content');
  });

  it('拒绝缺少 taskId 的任务来源', () => {
    const r = createAsset({ ...base, origin: { type: 'task', taskId: '' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('invalid_origin');
  });

  it('可选字段不写入 undefined', () => {
    const r = createAsset(base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect('width' in r.value).toBe(false);
      expect('deletedAt' in r.value).toBe(false);
    }
  });
});

describe('生命周期', () => {
  it('软删除后不再参与去重，恢复后重新参与', () => {
    const r = createAsset({ ...base, id: 'as1', now: 100 });
    if (!r.ok) throw new Error('setup failed');
    const asset = r.value;

    const deleted = softDeleteAsset(asset, 200);
    expect(isAlive(deleted)).toBe(false);
    expect(findByHash([deleted], 'h1')).toBeUndefined();

    const restored = restoreAsset(deleted);
    expect(isAlive(restored)).toBe(true);
    expect(restored.deletedAt).toBeUndefined();
    expect(findByHash([restored], 'h1')?.id).toBe('as1');
  });

  it('去重只命中未删除的资产', () => {
    const a = createAsset({ ...base, id: 'as1' });
    const b = createAsset({ ...base, id: 'as2' });
    if (!a.ok || !b.ok) throw new Error('setup failed');
    const list = [softDeleteAsset(a.value), b.value];
    expect(findByHash(list, 'h1')?.id).toBe('as2');
  });
});
