import { describe, expect, it, vi, afterEach } from 'vitest';
import { adapterFor } from './index';
import { defaultProviders, pickModel } from '@/app/stores/providerStore';
import type { ProviderConfig } from '@/domain';

/**
 * 这个适配器用 canvas 真画图，所以依赖浏览器环境。
 * 在 node 环境里给它一个假的 canvas：只记录被调用的次数与尺寸，
 * 返回固定字节。测的是"出了几张、进度怎么报"，不是画得好不好看。
 */
function stubCanvas() {
  const blobs: number[] = [];
  vi.stubGlobal('document', {
    createElement: () => {
      const ctx = {
        createLinearGradient: () => ({ addColorStop: () => {} }),
        fillRect: () => {},
        measureText: () => ({ width: 10 }),
        beginPath: () => {},
        arc: () => {},
        stroke: () => {},
        fillText: () => {},
        set fillStyle(_v: string) {},
        set strokeStyle(_v: string) {},
        set lineWidth(_v: number) {},
        set globalAlpha(_v: number) {},
        set font(_v: string) {},
        set textAlign(_v: string) {},
        set textBaseline(_v: string) {},
      };
      return {
        width: 0,
        height: 0,
        getContext: () => ctx,
        toBlob: (cb: (b: Blob | null) => void) => {
          blobs.push(1);
          cb(new Blob([new Uint8Array([137, 80, 78, 71, blobs.length])], { type: 'image/png' }));
        },
      };
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('演示适配器', () => {
  it('按 count 出图，且每张都有真实字节', async () => {
    stubCanvas();
    const config = defaultProviders()[0] as ProviderConfig;
    const adapter = adapterFor(config);

    const items = await adapter.generate(
      config,
      {
        capability: 'image',
        model: 'demo/image',
        prompt: '测试',
        referenceImages: [],
        count: 3,
      },
      {},
    );

    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.mime).toBe('image/png');
      expect(item.bytes.byteLength).toBeGreaterThan(0);
    }
  });

  it('先报"不确定"，再报真实进度——不允许一上来就给百分比', async () => {
    stubCanvas();
    const config = defaultProviders()[0] as ProviderConfig;
    const adapter = adapterFor(config);
    const seen: (number | null)[] = [];

    await adapter.generate(
      config,
      { capability: 'image', model: 'demo/image', prompt: 'x', referenceImages: [], count: 1 },
      { onProgress: (v) => seen.push(v) },
    );

    expect(seen[0]).toBeNull();
    expect(seen.at(-1)).toBe(1);
    // 进度必须单调不减，否则进度条会出现倒退
    const numeric = seen.filter((v): v is number => v !== null);
    expect([...numeric].sort((a, b) => a - b)).toEqual(numeric);
  });

  it('支持取消：abort 之后不再继续出图', async () => {
    const config = defaultProviders()[0] as ProviderConfig;
    const adapter = adapterFor(config);
    const ctrl = new AbortController();
    ctrl.abort(new Error('用户取消'));

    await expect(
      adapter.generate(
        config,
        { capability: 'image', model: 'demo/image', prompt: 'x', referenceImages: [], count: 2, signal: ctrl.signal },
        {},
      ),
    ).rejects.toThrow();
  });
});

describe('模型选择（能力自述，不猜名字）', () => {
  it('按能力挑第一个可用模型', () => {
    const picked = pickModel(defaultProviders(), 'image');
    expect(picked?.modelId).toBe('demo/image');
  });

  it('用户上次选的模型优先', () => {
    const config: ProviderConfig = {
      ...(defaultProviders()[0] as ProviderConfig),
      models: [
        { id: 'a', label: 'a', capabilities: ['image'] },
        { id: 'b', label: 'b', capabilities: ['image'] },
      ],
    };
    expect(pickModel([config], 'image', 'b')?.modelId).toBe('b');
  });

  it('首选模型不支持该能力时回退，而不是硬用', () => {
    const config: ProviderConfig = {
      ...(defaultProviders()[0] as ProviderConfig),
      models: [
        { id: 'text-only', label: 't', capabilities: ['text'] },
        { id: 'img', label: 'i', capabilities: ['image'] },
      ],
    };
    expect(pickModel([config], 'image', 'text-only')?.modelId).toBe('img');
  });

  it('没有任何可用模型时返回 null，让 UI 提示去配置', () => {
    expect(pickModel([], 'video')).toBeNull();
  });
});
