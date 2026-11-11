import { beforeEach, describe, expect, it } from 'vitest';
import { buildReproPackage, type GenerationParams, type ProviderConfig } from '@/domain';
import { useProviderStore } from '@/app/stores/providerStore';
import { runReproPackage } from './reproRunner';

/**
 * 只测「厂商校验」这条前置分支：它不碰画布、不碰 IndexedDB、不真的发请求。
 *
 * 这条分支的存在本身就是修复来的：早期复现直接调 runGeneration，
 * 而 runGeneration 只按模型名挑厂商，于是换了机器照样能「成功」，
 * 只是悄悄用了别的厂商出图——最坏的静默错误。
 */

const params: GenerationParams = {
  kind: 'image',
  prompt: 'a cat',
  model: 'gpt-image-1',
  providerId: 'openai',
  inputAssetIds: [],
};

function setProviders(configs: ProviderConfig[]) {
  useProviderStore.setState({ configs, loaded: true });
}

const openai: ProviderConfig = {
  id: 'openai',
  name: 'OpenAI',
  adapter: 'openai-compatible',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-x',
  scope: 'external',
  models: [{ id: 'gpt-image-1', label: 'gpt-image-1', capabilities: ['image'] }],
};

describe('runReproPackage 厂商校验', () => {
  beforeEach(() => {
    setProviders([]);
  });

  it('原厂商不存在时拒绝，并说明现有厂商', async () => {
    setProviders([{ ...openai, id: 'other', name: '别人的中转' }]);
    const r = await runReproPackage(buildReproPackage({ taskId: 't1', params }));
    expect(r.ok).toBe(false);
    expect(r.message).toContain('openai');
    expect(r.message).toContain('other');
  });

  it('绝不因为别家有同名模型就悄悄替换厂商', async () => {
    // 关键：本机没有 openai，但别的厂商也有 gpt-image-1
    setProviders([
      {
        id: 'third-party',
        name: '第三方中转',
        adapter: 'openai-compatible',
        baseUrl: 'https://relay.example.com/v1',
        apiKey: 'sk-y',
        models: [{ id: 'gpt-image-1', label: 'gpt-image-1', capabilities: ['image'] }],
      },
    ]);
    const r = await runReproPackage(buildReproPackage({ taskId: 't2', params }));
    expect(r.ok).toBe(false);
    // 报错里列出的是本机现有厂商 id，用户据此知道该补哪个
    expect(r.message).toContain('third-party');
    // 而且必须明确说「避免用别的厂商误跑」，不能让人以为它已经成功
    expect(r.message).toContain('避免用别的厂商误跑');
  });

  it('厂商存在但缺少所需的模型/能力时拒绝', async () => {
    setProviders([{ ...openai, models: [{ id: 'gpt-4o-mini', label: 'gpt-4o-mini', capabilities: ['text'] }] }]);
    const r = await runReproPackage(buildReproPackage({ taskId: 't3', params }));
    expect(r.ok).toBe(false);
    expect(r.message).toContain('gpt-image-1');
  });
});
