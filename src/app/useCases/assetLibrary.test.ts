import { describe, expect, it } from 'vitest';
import { createAsset, type Asset } from '@/domain';
import type { Runtime } from '@/infra/runtime';
import { hydrateAssetList, isHydratingAssets } from './assetLibrary';

function sampleAsset(): Asset {
  const r = createAsset({
    id: 'as-1',
    mime: 'image/png',
    hash: 'h1',
    bytes: 10,
    path: 'assets/h1.png',
    origin: { type: 'import' },
  });
  if (!r.ok) throw new Error('setup failed');
  return r.value;
}

function fakeRuntime(has: (key: string) => Promise<boolean>): Runtime {
  return { blobs: { has } } as unknown as Runtime;
}

describe('启动装载门控', () => {
  it('装载期间 isHydratingAssets 为真，结束后归零', async () => {
    let release: ((v: boolean) => void) | undefined;
    const pending = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    const runtime = fakeRuntime(() => pending);

    const task = hydrateAssetList(runtime, [sampleAsset()]);
    expect(isHydratingAssets()).toBe(true);

    release?.(true);
    await task;
    expect(isHydratingAssets()).toBe(false);
  });

  it('装载抛错时也不会把门控永久卡住', async () => {
    const runtime = fakeRuntime(async () => {
      throw new Error('blob 读失败');
    });
    await expect(hydrateAssetList(runtime, [sampleAsset()])).rejects.toThrow('blob 读失败');
    expect(isHydratingAssets()).toBe(false);
  });

  it('字节缺失的资产记进 missing，不写进索引', async () => {
    const runtime = fakeRuntime(async () => false);
    const report = await hydrateAssetList(runtime, [sampleAsset()]);
    expect(report.missing).toEqual(['as-1']);
  });
});
