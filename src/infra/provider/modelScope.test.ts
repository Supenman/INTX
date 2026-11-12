import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderConfig } from '@/domain';
import { modelScopeAdapter } from './modelScope';
import { ProviderResultPendingError } from './providerResultPending';
import { openAiCompatibleAdapter } from './openaiCompatible';
import { normalizeProviders } from '@/app/stores/providerStore';
import { normalizeError, readTaskOutcome } from '@/domain';

/**
 * 用假上游跑完整异步链，不碰真实 Key、不花真钱。
 * 真机踩到的缺陷是「POST 2xx 但没拿到图却判成可重试」，所以断言重点
 * 不只是「能出图」，更是「任何已经收单的失败都必须留住任务号」。
 */

const config: ProviderConfig = {
  id: 'ms',
  name: 'ModelScope 假上游',
  adapter: 'modelscope',
  baseUrl: 'https://api-inference.modelscope.cn/v1',
  apiKey: 'ms-fake-key-for-test',
  models: [],
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

describe('ModelScope 异步出图（官方协议）', () => {
  it('POST 只回 task_id → 轮询 SUCCEED → 下载 output_images，且请求头/请求体正确', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.endsWith('/images/generations')) return json({ task_id: 'task-abc' });
        if (url.includes('/tasks/task-abc')) {
          return json({ task_status: 'SUCCEED', output_images: ['https://img.test/a.png'] });
        }
        if (url === 'https://img.test/a.png') {
          return new Response(PNG, { headers: { 'content-type': 'image/png' } });
        }
        throw new Error(`意外请求 ${url}`);
      }),
    );

    const phases: string[] = [];
    const items = await modelScopeAdapter.generate(config, req, {
      onPhase: (p) => phases.push(p),
      onProgress: () => {},
    });

    const post = calls.find((c) => c.url.endsWith('/images/generations'))!;
    const headers = post.init?.headers as Record<string, string>;
    expect(headers['X-ModelScope-Async-Mode']).toBe('true');
    // 官方示例只有 model + prompt；塞 n/size/response_format 可能被上游判参数错
    expect(JSON.parse(String(post.init?.body))).toEqual({ model: req.model, prompt: req.prompt });

    const poll = calls.find((c) => c.url.includes('/tasks/task-abc'))!;
    expect((poll.init?.headers as Record<string, string>)['X-ModelScope-Task-Type']).toBe('image_generation');

    expect(items).toHaveLength(1);
    expect(items[0]!.mime).toBe('image/png');
    expect(items[0]!.bytes.byteLength).toBe(PNG.byteLength);
    expect(phases).toEqual(['submitting', 'generating', 'downloading']);
  });

  it('先 PENDING 再 SUCCEED：真的会轮询，不编进度', async () => {
    vi.useFakeTimers();
    let polls = 0;
    const progress: (number | null)[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/images/generations')) return json({ task_id: 'task-poll' });
        if (url.includes('/tasks/task-poll')) {
          polls += 1;
          return polls === 1
            ? json({ task_status: 'PENDING' })
            : json({ task_status: 'SUCCEED', output_images: ['https://img.test/b.png'] });
        }
        return new Response(PNG, { headers: { 'content-type': 'image/png' } });
      }),
    );

    const pending = modelScopeAdapter.generate(config, req, {
      onPhase: () => {},
      onProgress: (p) => progress.push(p),
    });
    await vi.advanceTimersByTimeAsync(5_000);
    const items = await pending;

    expect(polls).toBe(2);
    expect(items).toHaveLength(1);
    expect(progress.every((p) => p === null)).toBe(true);
  });
});

describe('已收单但没拿到图：一律 pending，不许退化成可重试', () => {
  const cases: { name: string; stub: () => Promise<Response>; detail?: string }[] = [
    {
      name: '上游 FAILED',
      stub: async () => json({ task_status: 'FAILED', error: { message: 'nsfw' } }),
      detail: 'nsfw',
    },
    {
      name: '上游说成功但没给图片地址',
      stub: async () => json({ task_status: 'SUCCEED' }),
      detail: '没给图片地址',
    },
    {
      name: '轮询 HTTP 500',
      stub: async () => json({ error: { message: 'oops' } }, 500),
    },
  ];

  for (const c of cases) {
    it(`${c.name} → ProviderResultPendingError 且带 task_id`, async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (url.endsWith('/images/generations')) return json({ task_id: 'task-paid' });
          return c.stub();
        }),
      );

      const err = await modelScopeAdapter.generate(config, req, {}).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ProviderResultPendingError);
      const pending = err as ProviderResultPendingError;
      expect(pending.taskId).toBe('task-paid');
      expect(pending.code).toBe('provider_result_pending');
      if (c.detail) expect(pending.message).toContain(c.detail);
      // 这条会被写进 Task.upstreamRef，用户才能拿去后台查单
      expect(readTaskOutcome({ status: 'failed', error: pending })).toMatchObject({
        regenerate: 'confirm',
        reason: 'provider_result_pending',
      });
    });
  }

  it('提交 2xx 但没有 task_id：也不能说「空结果」', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ request_id: 'r1' })));
    const err = await modelScopeAdapter.generate(config, req, {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderResultPendingError);
    expect((err as ProviderResultPendingError).taskId).toBeNull();
  });

  it('轮询超时：留住任务号，不退化成 timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/images/generations')) return json({ task_id: 'task-slow' });
        return json({ task_status: 'PENDING' });
      }),
    );
    const pending = modelScopeAdapter.generate(config, req, {}).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(190_000);
    const err = await pending;
    expect(err).toBeInstanceOf(ProviderResultPendingError);
    expect((err as ProviderResultPendingError).taskId).toBe('task-slow');
  });

  it('用户取消轮询：不能写成「未扣费可直接重发」', async () => {
    vi.useFakeTimers();
    const ctrl = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/images/generations')) return json({ task_id: 'task-cancel' });
        return json({ task_status: 'PENDING' });
      }),
    );
    const pending = modelScopeAdapter.generate(config, { ...req, signal: ctrl.signal }, {}).catch((e: unknown) => e);
    ctrl.abort();
    await vi.advanceTimersByTimeAsync(5_000);
    const err = await pending;
    expect(err).toBeInstanceOf(ProviderResultPendingError);
    expect((err as ProviderResultPendingError).taskId).toBe('task-cancel');
  });

  it('留证会抹掉响应里回显的 Token', async () => {
    const e = new ProviderResultPendingError({
      taskId: 't1',
      rawResponse: '{"api_key":"ms-abcdefgh-1234-5678-9012-abcdefghijkl"}',
    });
    expect(e.rawResponse).not.toContain('ms-abcdefgh');
    expect(e.rawResponse).toContain('***');
  });
});

describe('旧 openai-compatible 配置不再把异步响应当空结果', () => {
  it('响应只有 task_id：抛 pending 并带任务号', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ task_id: 'task-legacy' })));
    const err = await openAiCompatibleAdapter
      .generate(
        { ...config, adapter: 'openai-compatible' },
        { ...req, capability: 'image' },
        {},
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderResultPendingError);
    expect((err as ProviderResultPendingError).taskId).toBe('task-legacy');
  });

  it('同步响应有 data：照常出图，不受影响', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: [{ b64_json: 'AQID' }] })));
    const items = await openAiCompatibleAdapter.generate(
      { ...config, adapter: 'openai-compatible' },
      req,
      {},
    );
    expect(items).toHaveLength(1);
  });
});

describe('错误码与配置迁移', () => {
  it('provider_result_pending 归一到 confirm，不是 allowed', () => {
    const e = new ProviderResultPendingError({ taskId: 't' });
    expect(normalizeError(e).code).toBe('provider_result_pending'); // 文案兜底也认得
    expect(readTaskOutcome({ status: 'failed', error: { code: 'provider_result_pending' } })).toMatchObject({
      regenerate: 'confirm',
      reason: 'provider_result_pending',
    });
  });

  it('本地显式参数错误归 invalid_params，不按裸 400 猜', () => {
    expect(normalizeError(new Error('invalid_params：该模型不支持参考图')).code).toBe('invalid_params');
    expect(normalizeError(new Error('HTTP 400 Bad Request')).code).not.toBe('invalid_params');
  });

  it('ModelScope baseUrl 的旧配置自动升级，其他厂商不动', () => {
    const cn = normalizeProviders([{ ...config, adapter: 'openai-compatible' }])[0]!;
    expect(cn.adapter).toBe('modelscope');
    const ai = normalizeProviders([
      { ...config, adapter: 'openai-compatible', baseUrl: 'https://api-inference.modelscope.ai/v1' },
    ])[0]!;
    expect(ai.adapter).toBe('modelscope');
    const other = normalizeProviders([
      { ...config, adapter: 'openai-compatible', baseUrl: 'https://api.openai.com/v1' },
    ])[0]!;
    expect(other.adapter).toBe('openai-compatible');
  });
});
