import { afterEach, describe, expect, it, vi } from 'vitest';
import { readTaskOutcome, type ProviderConfig } from '@/domain';
import { adapterFor, isModelScopeEndpoint } from './index';
import { modelScopeAdapter } from './modelScope';
import { openAiCompatibleAdapter } from './openaiCompatible';
import { ProviderResultPendingError } from './providerResultPending';

/**
 * 真机第二次反馈的回归测试。
 *
 * 缺陷不是「异步适配器写错了」，而是请求压根没走到它：设置页「协议」
 * 默认 OpenAI 兼容，用户填完 ModelScope 地址直接保存，读配置时的那次
 * 自动升级被 upsert 绕过。于是 POST 2xx 只回 task_id，卡片停在
 * 「已收单但没拿到图」，钱花了图没出来。
 *
 * 这里验三层：分发、store 写入、以及同步适配器收到 task_id 时不再只报错
 * 而是就地查单把图取回来。全程假上游，不用真实 Key、不花真钱。
 */

const base: ProviderConfig = {
  id: 'ms',
  name: 'ModelScope',
  adapter: 'openai-compatible',
  baseUrl: 'https://api-inference.modelscope.cn/v1',
  apiKey: 'ms-fake-key-for-test',
  models: [{ id: 'openmoss/MOSS-Image-SFT', label: 'MOSS', capabilities: ['image'] }],
};

const req = {
  capability: 'image' as const,
  model: 'openmoss/MOSS-Image-SFT',
  prompt: '一只金色的猫',
  referenceImages: [],
  count: 1,
};

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]).buffer;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('分发层：端点说了算，配置字段说了不算', () => {
  it('配置写 openai-compatible、baseUrl 是 ModelScope → 仍走异步适配器', () => {
    expect(adapterFor(base)).toBe(modelScopeAdapter);
  });

  it('.cn 和 .ai 都认，社区网页域名与别的厂商不认', () => {
    expect(isModelScopeEndpoint('https://api-inference.modelscope.cn/v1')).toBe(true);
    expect(isModelScopeEndpoint('https://api-inference.modelscope.ai/v1/')).toBe(true);
    expect(isModelScopeEndpoint('https://www.modelscope.cn')).toBe(false);
    expect(isModelScopeEndpoint('https://api.openai.com/v1')).toBe(false);
  });

  it('本地演示 mock 不被硬路由抢走，普通 OpenAI 端点也不受影响', () => {
    expect(adapterFor({ ...base, adapter: 'mock', baseUrl: '' }).kind).toBe('mock');
    expect(adapterFor({ ...base, baseUrl: 'https://api.openai.com/v1' }).kind).toBe(
      'openai-compatible',
    );
  });
});

describe('store 写入也归一：设置页保存后立刻生效', () => {
  it('upsert 会把 ModelScope 端点的 openai-compatible 配置改成 modelscope', async () => {
    const { useProviderStore } = await import('@/app/stores/providerStore');
    const store = useProviderStore;
    store.setState({ configs: [], loaded: true, store: null, adapterFor: null });
    store.getState().upsert({ ...base, id: 'from-settings' });
    expect(store.getState().configs[0]!.adapter).toBe('modelscope');
    store.setState({ configs: [], loaded: true, store: null, adapterFor: null });
  });
});

describe('同步适配器收到 task_id：就地查单出图，不重发', () => {
  it('POST 只回 task_id → 查这一单 → 出图，且提交只有一次', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url.endsWith('/images/generations')) return json({ task_id: 'task-legacy' });
        if (url.includes('/tasks/task-legacy')) {
          return json({ task_status: 'SUCCEED', output_images: ['https://img.test/c.png'] });
        }
        return new Response(PNG, { headers: { 'content-type': 'image/png' } });
      }),
    );

    const items = await openAiCompatibleAdapter.generate(base, req, {
      onPhase: () => {},
      onProgress: () => {},
    });

    expect(items).toHaveLength(1);
    expect(items[0]!.bytes.byteLength).toBe(PNG.byteLength);
    expect(calls.filter((u) => u.endsWith('/images/generations'))).toHaveLength(1);
    expect(calls.some((u) => u.includes('/tasks/task-legacy'))).toBe(true);
  });

  it('查单 FAILED → 抛 pending 并留住任务号，三态 confirm 而不是 allowed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/images/generations')) return json({ task_id: 'task-paid' });
        return json({ task_status: 'FAILED', message: '模型侧失败' });
      }),
    );

    const err = await openAiCompatibleAdapter
      .generate(base, req, { onPhase: () => {}, onProgress: () => {} })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ProviderResultPendingError);
    expect((err as ProviderResultPendingError).taskId).toBe('task-paid');
    expect(readTaskOutcome({ status: 'failed', error: err as ProviderResultPendingError })).toMatchObject({
      regenerate: 'confirm',
      reason: 'provider_result_pending',
    });
  });
});
