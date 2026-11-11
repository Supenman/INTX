import { describe, expect, it } from 'vitest';
import { fallbackProviderStore } from './browserStores';
import type { ProviderStore } from '@/app/stores/providerStore';
import type { ProviderConfig } from '@/domain';

/**
 * 这层兜底的意义：全新安装（config.json 不存在）时底层 load() 返回空数组，
 * 若不兜底，应用会以「0 个厂商」启动，点生成直接报「没有可用的 image 模型」，
 * 而顶栏还写着"演示模式"。桌面端此前漏了这层包装，真机首次安装才暴露。
 */
function storeOf(list: ProviderConfig[]): ProviderStore {
  return { load: async () => list, save: async () => {} };
}

describe('fallbackProviderStore', () => {
  it('配置为空时兜底到演示厂商，而不是裸空数组', async () => {
    const list = await fallbackProviderStore(storeOf([])).load();
    expect(list.length).toBeGreaterThan(0);
    expect(list.some((c) => c.adapter === 'mock')).toBe(true);
    // 演示厂商必须真的能出图，否则兜底等于没兜
    expect(list.some((c) => c.models.some((m) => m.capabilities.includes('image')))).toBe(true);
  });

  it('已有配置时原样返回，不被演示厂商污染', async () => {
    const mine: ProviderConfig = {
      id: 'real',
      name: '真实厂商',
      adapter: 'openai-compatible',
      baseUrl: 'https://example.com',
      apiKey: 'k',
      scope: 'external',
      models: [{ id: 'm1', label: 'M1', capabilities: ['image'] }],
    };
    const list = await fallbackProviderStore(storeOf([mine])).load();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe('real');
  });

  it('读取抛错时也兜底，不让应用起不来', async () => {
    const broken: ProviderStore = {
      load: async () => {
        throw new Error('config.json 损坏');
      },
      save: async () => {},
    };
    expect((await fallbackProviderStore(broken).load()).length).toBeGreaterThan(0);
  });
});
