import { describe, expect, it } from 'vitest';

import { readTaskOutcome } from '@/domain/task/outcome';
import type { GenerationParams, Task } from '@/domain/task/model';
import {
  MODELSCOPE_MAX_WAIT_MS,
  MODELSCOPE_POLL_INTERVAL_MS,
  generateModelScopeImages,
  isModelScopeEndpoint,
  modelScopeApiBase,
  pollModelScopeTask,
  type ModelScopeTransport,
  type TransportResponse,
} from './modelScope';
import { ProviderResultPendingError } from './pendingResult';
import { createMemoryTaskLog } from './taskLog';
import { GenerationTaskError, inspectRunWithTask } from './withTask';

const BASE = 'https://api-inference.modelscope.cn/v1';

function res(status: number, body: unknown): TransportResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

/** 按队列回放响应；记录每次请求；假时钟让轮询瞬间跑完。 */
function fakeTransport(responses: TransportResponse[], opts: { clockStep?: number } = {}) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  let clock = 0;
  const transport: ModelScopeTransport = {
    async request(url, init) {
      calls.push({ method: init.method, url, headers: init.headers, body: init.body });
      const next = responses.shift();
      if (!next) throw new Error('意外的额外请求');
      return next;
    },
    async fetchImage(url) {
      return `data:image/png;base64,${Buffer.from(url).toString('base64')}`;
    },
    async sleep(ms, signal) {
      sleeps.push(ms);
      clock += opts.clockStep ?? ms;
      if (signal?.aborted) throw new Error('aborted');
    },
    now: () => clock,
  };
  return { transport, calls, sleeps };
}

const req = { baseUrl: BASE, apiKey: 'test-token-not-real', model: 'openmoss/MOSS-Image-SFT', prompt: '一只猫', referenceCount: 0 };
const posts = (calls: Call[]) => calls.filter((c) => c.method === 'POST');

describe('ModelScope 端点识别', () => {
  it('只认官方 api-inference 域名（cn / ai）', () => {
    expect(isModelScopeEndpoint('https://api-inference.modelscope.cn/v1')).toBe(true);
    expect(isModelScopeEndpoint('https://api-inference.modelscope.ai/v1/')).toBe(true);
    expect(isModelScopeEndpoint(' https://API-INFERENCE.modelscope.cn/v1 ')).toBe(true);
  });

  it('社区网页域名、仿冒域名、其他厂商、非法地址都不算', () => {
    expect(isModelScopeEndpoint('https://www.modelscope.cn/v1')).toBe(false);
    expect(isModelScopeEndpoint('https://api-inference.modelscope.cn.evil.com/v1')).toBe(false);
    expect(isModelScopeEndpoint('https://api.openai.com/v1')).toBe(false);
    expect(isModelScopeEndpoint('not a url')).toBe(false);
  });
});

describe('baseUrl 归一化（官方示例不带 /v1）', () => {
  it('带不带 /v1、带不带尾斜杠，都补成只出现一次 /v1', () => {
    expect(modelScopeApiBase('https://api-inference.modelscope.cn')).toBe('https://api-inference.modelscope.cn/v1');
    expect(modelScopeApiBase('https://api-inference.modelscope.cn/')).toBe('https://api-inference.modelscope.cn/v1');
    expect(modelScopeApiBase('https://api-inference.modelscope.cn/v1')).toBe('https://api-inference.modelscope.cn/v1');
    expect(modelScopeApiBase(' https://api-inference.modelscope.cn/v1/ ')).toBe('https://api-inference.modelscope.cn/v1');
  });

  it('官方示例那种不带 /v1 的地址，请求落在正确的 v1 路径上', async () => {
    const { transport, calls } = fakeTransport([
      res(200, { task_id: 'tk-nov1' }),
      res(200, { task_status: 'SUCCEED', output_images: ['https://cdn/x.png'] }),
    ]);
    await generateModelScopeImages(transport, { ...req, baseUrl: 'https://api-inference.modelscope.cn/' });
    expect(calls[0]!.url).toBe('https://api-inference.modelscope.cn/v1/images/generations');
    expect(calls[1]!.url).toBe('https://api-inference.modelscope.cn/v1/tasks/tk-nov1');
  });
});

describe('ModelScope 提交与查单', () => {
  it('协议正确：只发 model+prompt，带异步头；查单带任务类型头', async () => {
    const { transport, calls } = fakeTransport([
      res(200, { task_id: 'tk-1' }),
      res(200, { task_status: 'SUCCEED', output_images: ['https://cdn/a.png'] }),
    ]);
    const images = await generateModelScopeImages(transport, req);

    expect(images).toHaveLength(1);
    expect(images[0]!.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    const [post, get] = calls;
    expect(post!.url).toBe(`${BASE}/images/generations`);
    expect(post!.headers['X-ModelScope-Async-Mode']).toBe('true');
    expect(JSON.parse(post!.body!)).toEqual({ model: 'openmoss/MOSS-Image-SFT', prompt: '一只猫' });
    expect(get!.method).toBe('GET');
    expect(get!.url).toBe(`${BASE}/tasks/tk-1`);
    expect(get!.headers['X-ModelScope-Task-Type']).toBe('image_generation');
  });

  it('拿到任务号立刻回调（先落号，再查单）', async () => {
    const order: string[] = [];
    const { transport } = fakeTransport([
      res(200, { task_id: 'tk-2' }),
      res(200, { task_status: 'SUCCEED', output_images: ['https://cdn/b.png'] }),
    ]);
    const wrapped: ModelScopeTransport = {
      ...transport,
      request: async (url, init) => {
        order.push(init.method);
        return transport.request(url, init);
      },
    };
    await generateModelScopeImages(wrapped, { ...req, onSubmitted: (id) => order.push(`submitted:${id}`) });
    expect(order).toEqual(['POST', 'submitted:tk-2', 'GET']);
  });

  it('PENDING/RUNNING 按 5 秒间隔继续查，不重新 POST', async () => {
    const { transport, calls, sleeps } = fakeTransport([
      res(200, { task_id: 'tk-3' }),
      res(200, { task_status: 'PENDING' }),
      res(200, { task_status: 'RUNNING' }),
      res(200, { task_status: 'SUCCEED', output_images: 'https://cdn/c.png' }),
    ]);
    const images = await generateModelScopeImages(transport, req);
    expect(images).toHaveLength(1);
    expect(posts(calls)).toHaveLength(1);
    expect(sleeps).toEqual([MODELSCOPE_POLL_INTERVAL_MS, MODELSCOPE_POLL_INTERVAL_MS]);
  });

  it('上游给几张收几张（只提交一次，不按张数多次 POST）', async () => {
    const { transport, calls } = fakeTransport([
      res(200, { task_id: 'tk-4' }),
      res(200, { task_status: 'SUCCEED', output_images: ['https://cdn/1.png', 'https://cdn/2.png'] }),
    ]);
    const images = await generateModelScopeImages(transport, req);
    expect(images).toHaveLength(2);
    expect(posts(calls)).toHaveLength(1);
  });

  it('查单 FAILED → 已收单错误，保留任务号', async () => {
    const { transport, calls } = fakeTransport([
      res(200, { task_id: 'tk-5' }),
      res(200, { task_status: 'FAILED', message: '内容审核未通过' }),
    ]);
    const error = await generateModelScopeImages(transport, req).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderResultPendingError);
    expect((error as ProviderResultPendingError).taskId).toBe('tk-5');
    expect(posts(calls)).toHaveLength(1);
  });

  it('SUCCEED 却没给图片地址 → 已收单错误，不当成空结果', async () => {
    const { transport } = fakeTransport([res(200, { task_id: 'tk-6' }), res(200, { task_status: 'SUCCEED', output_images: [] })]);
    const error = await generateModelScopeImages(transport, req).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderResultPendingError);
    expect((error as ProviderResultPendingError).taskId).toBe('tk-6');
  });

  it('超过 3 分钟仍未完成 → 超时也保留任务号，不重新提交', async () => {
    const pending = Array.from({ length: 60 }, () => res(200, { task_status: 'PENDING' }));
    const { transport, calls } = fakeTransport([res(200, { task_id: 'tk-7' }), ...pending]);
    const error = await generateModelScopeImages(transport, req).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderResultPendingError);
    expect((error as ProviderResultPendingError).message).toContain('tk-7');
    expect((error as ProviderResultPendingError).message).toContain('轮询超时');
    expect(posts(calls)).toHaveLength(1);
    // 3 分钟 / 5 秒 = 36 次等待后越过截止时间
    expect(calls.filter((c) => c.method === 'GET').length).toBe(MODELSCOPE_MAX_WAIT_MS / MODELSCOPE_POLL_INTERVAL_MS + 1);
  });

  it('查单网络中断 → 包成已收单错误，保留任务号', async () => {
    const { transport } = fakeTransport([res(200, { task_id: 'tk-8' })]);
    const broken: ModelScopeTransport = {
      ...transport,
      request: async (url, init) => {
        if (init.method === 'GET') throw new Error('Network Error');
        return transport.request(url, init);
      },
    };
    const error = await generateModelScopeImages(broken, req).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderResultPendingError);
    expect((error as ProviderResultPendingError).taskId).toBe('tk-8');
  });

  it('查单期间用户取消 → 仍按已收单处理（上游还在跑、可能计费）', async () => {
    const controller = new AbortController();
    const { transport } = fakeTransport([res(200, { task_id: 'tk-9' }), res(200, { task_status: 'PENDING' })]);
    const abortOnSleep: ModelScopeTransport = {
      ...transport,
      sleep: async () => {
        controller.abort();
        throw new Error('aborted');
      },
    };
    const error = await generateModelScopeImages(abortOnSleep, { ...req, signal: controller.signal }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderResultPendingError);
    expect((error as ProviderResultPendingError).taskId).toBe('tk-9');
  });

  it('提交 2xx 但没有 task_id → 已收单错误（钱可能已扣）', async () => {
    const { transport } = fakeTransport([res(200, { status: 'accepted' })]);
    const error = await generateModelScopeImages(transport, req).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderResultPendingError);
    expect((error as ProviderResultPendingError).taskId).toBeNull();
  });

  it('提交非 2xx → 普通错误，带 HTTP 状态码供错误分类', async () => {
    const { transport } = fakeTransport([res(401, { error: { message: 'invalid token' } })]);
    const error = await generateModelScopeImages(transport, req).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(ProviderResultPendingError);
    expect((error as Error).message).toContain('HTTP 401');
  });

  it('带参考图 → 提交前拒绝，零请求', async () => {
    const { transport, calls } = fakeTransport([]);
    const error = await generateModelScopeImages(transport, { ...req, referenceCount: 1 }).catch((e: unknown) => e);
    expect((error as Error).message).toContain('invalid_params');
    expect(calls).toHaveLength(0);
  });

  it('没填 Token → 提交前拒绝，零请求', async () => {
    const { transport, calls } = fakeTransport([]);
    const error = await generateModelScopeImages(transport, { ...req, apiKey: '  ' }).catch((e: unknown) => e);
    expect((error as Error).message).toContain('401');
    expect(calls).toHaveLength(0);
  });

  it('pollModelScopeTask 可单独凭任务号续查（不重新提交）', async () => {
    const { transport, calls } = fakeTransport([res(200, { task_status: 'SUCCEED', output_images: ['https://cdn/r.png'] })]);
    const images = await pollModelScopeTask(transport, { baseUrl: BASE, apiKey: 'test-token-not-real' }, 'tk-resume');
    expect(images).toHaveLength(1);
    expect(posts(calls)).toHaveLength(0);
  });
});

describe('ModelScope 接入任务台账', () => {
  const params: GenerationParams = {
    kind: 'image',
    prompt: '一只猫',
    model: 'openmoss/MOSS-Image-SFT',
    providerId: 'openai',
    inputAssetIds: [],
  };

  function only(tasks: readonly Task[]): Task {
    expect(tasks).toHaveLength(1);
    return tasks[0]!;
  }

  it('查单期间任务号已在台账，处于 running/generating', async () => {
    const log = createMemoryTaskLog();
    let snapshot: Task | null = null;
    const { transport } = fakeTransport([res(200, { task_id: 'tk-live' })]);
    const probing: ModelScopeTransport = {
      ...transport,
      request: async (url, init) => {
        if (init.method === 'GET') {
          snapshot = only(log.list());
          return res(200, { task_status: 'SUCCEED', output_images: ['https://cdn/live.png'] });
        }
        return transport.request(url, init);
      },
    };
    await inspectRunWithTask({
      params,
      log,
      submit: (hooks) => generateModelScopeImages(probing, { ...req, onSubmitted: hooks.onSubmitted }),
    });
    expect(snapshot!.upstreamRef).toBe('tk-live');
    expect(snapshot!.status).toBe('running');
    expect(snapshot!.phase).toBe('generating');
    const done = only(log.list());
    expect(done.status).toBe('succeeded');
    expect(done.upstreamRef).toBe('tk-live');
  });

  it('查单 FAILED → 台账 failed/provider_result_pending，判 confirm', async () => {
    const log = createMemoryTaskLog();
    const { transport } = fakeTransport([res(200, { task_id: 'tk-f' }), res(200, { task_status: 'FAILED' })]);
    const error = await inspectRunWithTask({
      params,
      log,
      submit: (hooks) => generateModelScopeImages(transport, { ...req, onSubmitted: hooks.onSubmitted }),
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GenerationTaskError);
    const task = only(log.list());
    expect(task.status).toBe('failed');
    expect(task.error?.code).toBe('provider_result_pending');
    expect(task.upstreamRef).toBe('tk-f');
    expect(readTaskOutcome(task)?.regenerate).toBe('confirm');
  });

  it('已拿到任务号后用户取消 → 不标 canceled，判 confirm（防止再买一张）', async () => {
    const log = createMemoryTaskLog();
    const controller = new AbortController();
    const { transport } = fakeTransport([res(200, { task_id: 'tk-c' })]);
    const abortOnPoll: ModelScopeTransport = {
      ...transport,
      request: async (url, init) => {
        if (init.method === 'GET') {
          controller.abort();
          const abortError = new Error('canceled');
          abortError.name = 'CanceledError';
          throw abortError;
        }
        return transport.request(url, init);
      },
    };
    const error = await inspectRunWithTask({
      params,
      log,
      signal: controller.signal,
      submit: (hooks) => generateModelScopeImages(abortOnPoll, { ...req, signal: controller.signal, onSubmitted: hooks.onSubmitted }),
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GenerationTaskError);
    const task = only(log.list());
    expect(task.status).toBe('failed');
    expect(task.error?.code).toBe('provider_result_pending');
    expect(task.upstreamRef).toBe('tk-c');
    expect(readTaskOutcome(task)?.regenerate).toBe('confirm');
  });

  it('提交前就取消（还没拿到任务号）→ 仍是 canceled，可直接重发', async () => {
    const log = createMemoryTaskLog();
    const controller = new AbortController();
    controller.abort();
    const abortError = new Error('canceled');
    abortError.name = 'CanceledError';
    await inspectRunWithTask({
      params,
      log,
      signal: controller.signal,
      submit: () => Promise.reject(abortError),
    }).catch(() => undefined);
    const task = only(log.list());
    expect(task.status).toBe('canceled');
    expect(task.upstreamRef).toBeNull();
    expect(readTaskOutcome(task)?.regenerate).toBe('allowed');
  });

  it('台账不含 Token / baseUrl', async () => {
    const log = createMemoryTaskLog();
    const { transport } = fakeTransport([
      res(200, { task_id: 'tk-s' }),
      res(200, { task_status: 'SUCCEED', output_images: ['https://cdn/s.png'] }),
    ]);
    await inspectRunWithTask({
      params,
      log,
      submit: (hooks) => generateModelScopeImages(transport, { ...req, onSubmitted: hooks.onSubmitted }),
    });
    const serialized = JSON.stringify(log.list());
    expect(serialized).not.toContain('test-token-not-real');
    expect(serialized).not.toContain('api-inference.modelscope.cn');
  });
});
