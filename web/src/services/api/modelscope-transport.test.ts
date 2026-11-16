/**
 * ModelScope 适配层：任务层只认 `ModelScopeTransport` 的返回壳，
 * 这里的 `request()` 一旦接错（比如把非 2xx 抛出去、或 json 不可用），
 * 四态判定就会走偏——401/429/5xx 都得原样带着状态码回到任务层。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, String(value)),
        removeItem: (key: string) => void store.delete(key),
        clear: () => store.clear(),
        key: (index: number) => [...store.keys()][index] ?? null,
        get length() {
            return store.size;
        },
    };
    return { store };
});

import { createModelScopeTransport } from './modelscope-transport';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    h.store.clear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

const URL_ = 'https://api-inference.modelscope.cn/v1/tasks/abc';

describe('ModelScope 适配层', () => {
    it('原样带上 method / headers / body 与 signal', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ task_status: 'PENDING' }), { status: 200 }));
        const controller = new AbortController();
        const res = await createModelScopeTransport('direct').request(URL_, {
            method: 'GET',
            headers: { Authorization: 'Bearer k', 'X-ModelScope-Task-Type': 'image_generation' },
            signal: controller.signal,
        });
        expect(res).toMatchObject({ ok: true, status: 200 });
        expect(await res.json()).toEqual({ task_status: 'PENDING' });
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(URL_);
        expect((init.headers as Record<string, string>)['X-ModelScope-Task-Type']).toBe('image_generation');
    });

    it('非 2xx 不抛，状态码交给任务层判定', async () => {
        fetchMock.mockResolvedValue(new Response('{"code":100101,"message":"服务繁忙"}', { status: 429 }));
        const res = await createModelScopeTransport('direct').request(URL_, { method: 'GET', headers: {} });
        expect(res.ok).toBe(false);
        expect(res.status).toBe(429);
        expect(await res.json()).toEqual({ code: 100101, message: '服务繁忙' });
    });

    it('system 出网方式经本地代理', async () => {
        const { useConfigStore } = await import('@/stores/use-config-store');
        useConfigStore.setState((state) => ({ config: { ...state.config, proxyEnabled: true, proxyUrl: 'http://127.0.0.1:23210' } }));
        fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
        await createModelScopeTransport('system').request(URL_, { method: 'GET', headers: {} });
        expect((fetchMock.mock.calls[0] as [string])[0]).toBe(`http://127.0.0.1:23210/${URL_}`);
    });
});
