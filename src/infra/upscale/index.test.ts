import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpscaleAdapter, UpscaleUnavailable } from '@/domain';
import {
  listUpscalers,
  probeUpscalers,
  registerUpscaler,
  resetUpscalers,
  selectUpscaler,
  tauriOnnxAdapter,
  referenceResampleAdapter,
} from './index';

/** node 环境没有 Image / Canvas，给参考实现一套最小替身。 */
function stubDom(naturalWidth = 700, naturalHeight = 500) {
  const ctx = {
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low',
    drawImage: () => {},
  };
  vi.stubGlobal('Image', class {
    naturalWidth = naturalWidth;
    naturalHeight = naturalHeight;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  });
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ctx,
      toBlob: (cb: (b: Blob | null) => void) => {
        cb(new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }));
      },
    }),
  });
}

beforeEach(() => resetUpscalers());
afterEach(() => vi.unstubAllGlobals());

describe('后端选择', () => {
  it('内置顺序：本地 ONNX 优先，参考重采样兜底', () => {
    expect(listUpscalers().map((a) => a.id)).toEqual(['tauri-onnx', 'reference-resample']);
  });

  it('浏览器里 ONNX 探测不通过，自动回退到参考实现', async () => {
    const selection = await selectUpscaler();
    expect(selection.adapter?.id).toBe('reference-resample');
    expect(selection.fallback).toBe(true);
    expect(selection.adapter?.ai).toBe(false);
  });

  it('探测结果带上缺失原因和补齐方式，不是一句「不可用」', async () => {
    const probes = await probeUpscalers();
    const onnx = probes.find((p) => p.adapter.id === 'tauri-onnx');
    expect(onnx).toBeDefined();
    expect(onnx?.availability.ok).toBe(false);
    if (onnx && !onnx.availability.ok) {
      expect(onnx.availability.missing.code).toBe('no_runtime');
      expect(onnx.availability.missing.hint).toBeTruthy();
    }
  });

  it('注册一个可用后端后不再回退', async () => {
    const fake: UpscaleAdapter = {
      id: 'fake',
      label: '测试后端',
      ai: true,
      available: async () => ({ ok: true }),
      upscale: async () => ({ ok: false, error: { code: 'failed', message: 'x' } }),
    };
    registerUpscaler(fake, 'first');
    const selection = await selectUpscaler();
    expect(selection.adapter?.id).toBe('fake');
    expect(selection.fallback).toBe(false);
  });

  it('同 id 重复注册是覆盖，不是累积', () => {
    const a: UpscaleAdapter = { ...referenceResampleAdapter, label: 'A' };
    const b: UpscaleAdapter = { ...referenceResampleAdapter, label: 'B' };
    registerUpscaler(a);
    registerUpscaler(b);
    expect(listUpscalers().filter((x) => x.id === 'reference-resample')).toHaveLength(1);
    expect(listUpscalers().find((x) => x.id === 'reference-resample')?.label).toBe('B');
  });

  it('没有任何可用实现时返回 null，而不是硬选一个', async () => {
    const never: UpscaleAdapter = {
      id: 'never',
      label: '永不就绪',
      ai: false,
      available: async () => ({ ok: false, missing: { code: 'failed', message: 'x' } }),
      upscale: async () => ({ ok: false, error: { code: 'failed', message: 'x' } }),
    };
    // 把内置两个都换成不可用，验证 null 分支
    registerUpscaler({ ...tauriOnnxAdapter, id: 'tauri-onnx', available: never.available });
    registerUpscaler({ ...referenceResampleAdapter, id: 'reference-resample', available: never.available });
    const selection = await selectUpscaler();
    expect(selection.adapter).toBeNull();
  });
});

describe('本地 ONNX 后端', () => {
  it('浏览器里直接返回 no_runtime，不会去 invoke 一个不存在的命令', async () => {
    const r = await tauriOnnxAdapter.upscale({ bytes: new ArrayBuffer(8), mime: 'image/png', scale: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect((r.error as UpscaleUnavailable).code).toBe('no_runtime');
  });

  it('ai = true，如实声明它是 AI 后端', () => {
    expect(tauriOnnxAdapter.ai).toBe(true);
  });
});

describe('参考重采样实现', () => {
  it('永远可用，且如实声明不是 AI 超分', async () => {
    expect(referenceResampleAdapter.ai).toBe(false);
    await expect(referenceResampleAdapter.available()).resolves.toEqual({ ok: true });
  });

  it('输出尺寸严格等于原图 × 倍率', async () => {
    stubDom(700, 500);
    const r = await referenceResampleAdapter.upscale({
      bytes: new ArrayBuffer(8),
      mime: 'image/png',
      scale: 2,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.width).toBe(1400);
      expect(r.value.height).toBe(1000);
      expect(r.value.mime).toBe('image/png');
      expect(r.value.bytes.byteLength).toBeGreaterThan(0);
    }
  });

  it('取消后不再产出，返回 aborted 而不是失败', async () => {
    stubDom();
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await referenceResampleAdapter.upscale({
      bytes: new ArrayBuffer(8),
      mime: 'image/png',
      scale: 4,
      signal: ctrl.signal,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect((r.error as UpscaleUnavailable).code).toBe('aborted');
  });
});
