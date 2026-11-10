import { beforeEach, describe, expect, it } from 'vitest';
import { createAsset, type CropRect } from '@/domain';
import { putAsset, useAssetStore } from '@/app/stores/assetStore';
import { saveCrop, saveMask } from './materialEdit';

/**
 * 只测不需要 Canvas / IndexedDB 的前置校验分支。
 * 真实绘制与「产物随项目文件刷新恢复」由 e2e/specs/material-edit.mjs 验证。
 */

const FULL: CropRect = { x: 0, y: 0, width: 1, height: 1 };

function resetAssets() {
  useAssetStore.setState({ assets: {}, byHash: {}, ready: false });
}

function putVideoAsset() {
  const r = createAsset({
    id: 'as-video',
    mime: 'video/mp4',
    hash: 'video-hash',
    bytes: 10,
    path: 'assets/video-hash.mp4',
    origin: { type: 'import' },
  });
  if (!r.ok) throw new Error('setup failed');
  putAsset({ asset: r.value, blobKey: r.value.hash });
}

describe('materialEdit 前置校验', () => {
  beforeEach(resetAssets);

  it('资产不存在时给出可读原因，不抛异常', async () => {
    await expect(saveCrop('missing', FULL)).resolves.toEqual({
      ok: false,
      message: '资产索引里找不到这张图',
    });
  });

  it('没涂抹就导出蒙版会被拦住', async () => {
    await expect(saveMask('missing', [])).resolves.toEqual({ ok: false, message: '还没涂抹遮罩' });
  });

  it('有笔迹但资产不存在时，报的是资产缺失', async () => {
    const r = await saveMask('missing', [{ points: [{ x: 0.3, y: 0.4 }], radius: 0.03 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('资产索引');
  });

  it('非图片资产不能裁切', async () => {
    putVideoAsset();
    await expect(saveCrop('as-video', FULL)).resolves.toEqual({ ok: false, message: '只能编辑图片资产' });
  });

  it('非图片资产也不能导出蒙版', async () => {
    putVideoAsset();
    const r = await saveMask('as-video', [{ points: [{ x: 0.5, y: 0.5 }], radius: 0.03 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe('只能编辑图片资产');
  });
});
