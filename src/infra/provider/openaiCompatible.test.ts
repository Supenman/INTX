import { describe, expect, it, vi, afterEach } from 'vitest';
import { sizeFromAspect } from './openaiCompatible';
import { ProviderResultPendingError } from './providerResultPending';

afterEach(() => vi.unstubAllGlobals());

describe('宽高比 → 尺寸', () => {
  it('已知比例映射到对应档位', () => {
    expect(sizeFromAspect('16:9')).toBe('1536x864');
    expect(sizeFromAspect('9:16')).toBe('864x1536');
    expect(sizeFromAspect('3:4')).toBe('960x1280');
  });

  it('未知或缺失时回落到方图，而不是报错', () => {
    expect(sizeFromAspect(undefined)).toBe('1024x1024');
    expect(sizeFromAspect('7:3')).toBe('1024x1024');
  });
});

describe('openai 兼容适配器的错误处理', () => {
  it('401 被归类为鉴权失败，且不可重试', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: { message: 'invalid api key' } }), { status: 401 })),
    );
    const { openAiCompatibleAdapter } = await import('./openaiCompatible');
    const { normalizeError } = await import('@/domain');

    const err = await openAiCompatibleAdapter
      .generate(
        { id: 'p', name: 'p', adapter: 'openai-compatible', baseUrl: 'https://x.test/v1', apiKey: 'k', models: [] },
        {
          capability: 'image',
          model: 'm',
          prompt: 'hi',
          referenceImages: [],
          count: 1,
        },
        {},
      )
      .catch((e: unknown) => e);

    const norm = normalizeError(err);
    expect(norm.code).toBe('auth_failed');
  });

  it('上游返回 429 时归类为限流且可重试', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('too many requests', { status: 429 })));
    const { openAiCompatibleAdapter } = await import('./openaiCompatible');
    const { normalizeError } = await import('@/domain');

    const err = await openAiCompatibleAdapter
      .generate(
        { id: 'p', name: 'p', adapter: 'openai-compatible', baseUrl: 'https://x.test/v1', apiKey: 'k', models: [] },
        { capability: 'image', model: 'm', prompt: 'hi', referenceImages: [], count: 1 },
        {},
      )
      .catch((e: unknown) => e);

    const norm = normalizeError(err);
    expect(norm.code).toBe('rate_limited');
  });

  it('未配 key 且不是本地地址时，请求根本不发出去', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const { openAiCompatibleAdapter } = await import('./openaiCompatible');

    await expect(
      openAiCompatibleAdapter.generate(
        { id: 'p', name: 'p', adapter: 'openai-compatible', baseUrl: 'https://x.test/v1', apiKey: '', models: [] },
        { capability: 'image', model: 'm', prompt: 'hi', referenceImages: [], count: 1 },
        {},
      ),
    ).rejects.toThrow(/API Key/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('本地地址允许无 key（本地推理服务常见）', async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal('fetch', spy);
    const { openAiCompatibleAdapter } = await import('./openaiCompatible');

    /**
     * 旧断言等的是「上游返回了空结果」。那是被真机缺陷推翻的错误行为：
     * POST 已经 2xx（上游收单、可能已计费），不能说「空结果」再让用户重试。
     * 现在必须抛「已收单待确认」，同时仍要证明本地地址确实发了请求。
     */
    const err = await openAiCompatibleAdapter
      .generate(
        { id: 'p', name: 'p', adapter: 'openai-compatible', baseUrl: 'http://127.0.0.1:8080/v1', apiKey: '', models: [] },
        { capability: 'image', model: 'm', prompt: 'hi', referenceImages: [], count: 1 },
        {},
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderResultPendingError);
    expect(spy).toHaveBeenCalled();
  });
});
