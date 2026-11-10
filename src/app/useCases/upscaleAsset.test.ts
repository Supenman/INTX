import { beforeEach, describe, expect, it } from 'vitest';
import { createAsset, type UpscaleScale } from '@/domain';
import { putAsset, useAssetStore } from '@/app/stores/assetStore';
import { registerUpscaler, resetUpscalers, referenceResampleAdapter, tauriOnnxAdapter } from '@/infra/upscale';
import { upscaleAsset } from './upscaleAsset';

/**
 * 只测不碰 Canvas / IndexedDB 的前置校验分支；
 * 真实放大、尺寸与「产物随项目文件刷新恢复」由 e2e/specs/material-edit.mjs 验证。
 */

function resetAssets() {
  useAssetStore.setState({ assets: {}, byHash: {}, ready: false });
}

function putImage(hash = 'img-hash') {
  const r = createAsset({
    id: 'as-img',
    mime: 'image/png',
    hash,
    bytes: 100,
    path: `assets/${hash}.png`,
    origin: { type: 'import' },
    width: 700,
    height: 500,
  });
  if (!r.ok) throw new Error('setup failed');
  putAsset({ asset: r.value, blobKey: r.value.hash });
}

function putVideo() {
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

beforeEach(() => {
  resetAssets();
  resetUpscalers();
});

describe('upscaleAsset 前置校验', () => {
  it('非法倍率直接拦住', async () => {
    await expect(upscaleAsset('as-img', 3 as UpscaleScale)).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining('不支持的放大倍率'),
    });
  });

  it('资产不存在时给出可读原因', async () => {
    await expect(upscaleAsset('missing', 2)).resolves.toEqual({
      ok: false,
      message: '资产索引里找不到这张图',
    });
  });

  it('非图片资产不能放大', async () => {
    putVideo();
    await expect(upscaleAsset('as-video', 2)).resolves.toEqual({
      ok: false,
      message: '只能放大图片资产',
    });
  });

  it('没有任何可用后端时返回失败，并把补齐方式带出来', async () => {
    putImage();
    const unavailable = async () => ({
      ok: false as const,
      missing: { code: 'no_runtime' as const, message: '桌面壳没就绪', hint: '用 Tauri 启动' },
    });
    registerUpscaler({ ...tauriOnnxAdapter, id: 'tauri-onnx', available: unavailable });
    registerUpscaler({ ...referenceResampleAdapter, id: 'reference-resample', available: unavailable });

    const r = await upscaleAsset('as-img', 2);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain('没有可用的放大后端');
      expect(r.hint).toContain('用 Tauri 启动');
    }
  });
});
