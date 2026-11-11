import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildReproPackage, type GenerationParams, type ProviderConfig } from '@/domain';
import { useProviderStore } from '@/app/stores/providerStore';

/**
 * 复现链路的两组关键分支：
 *
 * 1) 厂商校验——它不碰画布、不碰 IndexedDB、不真的发请求。
 *    早期复现直接调 runGeneration，而 runGeneration 只按模型名挑厂商，
 *    换了机器照样能「成功」，只是悄悄用了别的厂商出图——最坏的静默错误。
 *
 * 2) 画布拓扑重建——生成节点的 `prompt` 口是 required，校验只看连线、
 *    不认 params.prompt。早期只建一个孤立生成节点，被自己的校验拦住：
 *    点了没反应，连任务都不建，台账里也不留痕。
 */

const mocks = vi.hoisted(() => ({
  addNode: vi.fn(),
  connectNodes: vi.fn(),
  setNodeAsset: vi.fn(),
  runGeneration: vi.fn(),
  blobsPut: vi.fn(),
}));

vi.mock('@/app/stores/graphStore', () => ({
  addNode: mocks.addNode,
  connectNodes: mocks.connectNodes,
  setNodeAsset: mocks.setNodeAsset,
}));

vi.mock('@/app/useCases/runGeneration', () => ({ runGeneration: mocks.runGeneration }));

vi.mock('@/infra/runtime', () => ({
  resolveRuntime: async () => ({ blobs: { put: mocks.blobsPut } }),
}));

const { runReproPackage } = await import('./reproRunner');

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

beforeEach(() => {
  mocks.addNode.mockReset();
  mocks.connectNodes.mockReset();
  mocks.runGeneration.mockReset();
  let n = 0;
  mocks.addNode.mockImplementation((input: { defKind: string }) => {
    n += 1;
    return `n_${input.defKind}_${n}`;
  });
  mocks.runGeneration.mockResolvedValue({ ok: true });
});

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
    expect(r.message).toContain('third-party');
    expect(r.message).toContain('避免用别的厂商误跑');
    // 被拒绝时绝不能已经动了画布
    expect(mocks.addNode).not.toHaveBeenCalled();
  });

  it('厂商存在但缺少所需的模型/能力时拒绝', async () => {
    setProviders([{ ...openai, models: [{ id: 'gpt-4o-mini', label: 'gpt-4o-mini', capabilities: ['text'] }] }]);
    const r = await runReproPackage(buildReproPackage({ taskId: 't3', params }));
    expect(r.ok).toBe(false);
    expect(r.message).toContain('gpt-image-1');
    expect(mocks.addNode).not.toHaveBeenCalled();
  });
});

describe('runReproPackage 画布拓扑重建', () => {
  beforeEach(() => setProviders([openai]));

  it('必须重建上游文字节点，否则 prompt 口的必填校验会拦住重跑', async () => {
    await runReproPackage(buildReproPackage({ taskId: 't4', params }));

    const kinds = mocks.addNode.mock.calls.map((c) => (c[0] as { defKind: string }).defKind);
    expect(kinds).toContain('text-input');
    expect(kinds).toContain('generate');
  });

  it('文字节点带上原始提示词，并连到生成节点的 prompt 口', async () => {
    await runReproPackage(buildReproPackage({ taskId: 't5', params }));

    const textCall = mocks.addNode.mock.calls
      .map((c) => c[0] as { defKind: string; params?: Record<string, unknown> })
      .find((a) => a.defKind === 'text-input');
    expect(textCall?.params?.content).toBe('a cat');

    expect(mocks.connectNodes).toHaveBeenCalledWith(
      expect.objectContaining({ sourcePortId: 'text', targetPortId: 'prompt' }),
    );
  });

  it('生成节点原样回填参数，并最终走原生执行链路', async () => {
    await runReproPackage(buildReproPackage({ taskId: 't6', params }));

    const genCall = mocks.addNode.mock.calls
      .map((c) => c[0] as { defKind: string; params?: Record<string, unknown> })
      .find((a) => a.defKind === 'generate');
    expect(genCall?.params?.prompt).toBe('a cat');
    expect(genCall?.params?.model).toBe('gpt-image-1');
    expect(genCall?.params?.outputKind).toBe('image');

    expect(mocks.runGeneration).toHaveBeenCalledTimes(1);
    expect(mocks.runGeneration).toHaveBeenCalledWith(expect.stringContaining('generate'));
  });
});
