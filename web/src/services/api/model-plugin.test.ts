/**
 * 脚本插件 HTTP 助手的接线回归。
 *
 * 用户脚本直接调 `http` / `request`，它们的语义（相对地址怎么拼、JSON 怎么序列化、
 * FormData 要不要自己写 Content-Type、`responseType` 返回什么、失败怎么抛）
 * 是对外的 API。迁到 ProviderTransport 后必须和原来的 axios 行为一致，
 * 否则脚本会静默拿到错误对象当数据用。
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

import { defaultConfig, type AiConfig } from '@/stores/use-config-store';
import { runModelPlugin } from './model-plugin';

const BASE = 'https://api.example.com';

function config(): AiConfig {
    const models = [{ name: 'm', capability: 'text' as const }];
    return {
        ...defaultConfig,
        baseUrl: BASE,
        apiKey: 'k',
        apiFormat: 'openai',
        proxyMode: 'direct',
        channels: [{ ...defaultConfig.channels[0], baseUrl: BASE, apiKey: 'k', apiFormat: 'openai', proxyMode: 'direct', models }],
        model: 'm',
        textModel: 'm',
    };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    h.store.clear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

function json(status: number, body: unknown) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function run(script: string, overrides?: Partial<AiConfig>, signal?: AbortSignal) {
    return runModelPlugin({ capability: 'text', script, config: { ...config(), ...overrides }, signal });
}

describe('脚本插件 http / request', () => {
    it('http.post 拼相对地址、序列化 JSON，并带上 Key', async () => {
        fetchMock.mockResolvedValue(json(200, { ok: true }));
        const result = await run("return await http.post('/echo', { a: 1 });");
        expect(result).toEqual({ ok: true });
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('https://api.example.com/v1/echo');
        expect(init.method).toBe('POST');
        expect(init.body).toBe('{"a":1}');
        const headers = init.headers as Record<string, string>;
        expect(headers.Authorization).toBe('Bearer k');
        expect(headers['Content-Type']).toBe('application/json');
    });

    it('http.get 的 params 变成查询串', async () => {
        fetchMock.mockResolvedValue(json(200, {}));
        await run("return await http.get('/models', { params: { page: 2 } });");
        expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://api.example.com/v1/models?page=2');
    });

    it('http.url 返回未加代理的完整地址', async () => {
        expect(await run("return http.url('/x');")).toBe('https://api.example.com/v1/x');
    });

    it('request 传 FormData 时原样发出，不自己写 Content-Type', async () => {
        fetchMock.mockResolvedValue(json(200, { id: 'v1' }));
        await run(
            "const form = new FormData(); form.set('model', 'm'); return await request({ url: baseUrl + '/v1/videos', method: 'post', data: form, headers: { Authorization: 'Bearer ' + apiKey } });",
        );
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(init.body).toBeInstanceOf(FormData);
        expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    });

    it('http.post 传 FormData 时也不写 Content-Type', async () => {
        fetchMock.mockResolvedValue(json(200, { id: 'v1' }));
        await run("const form = new FormData(); form.set('prompt', 'x'); return await http.post('/videos', form);");
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(init.body).toBeInstanceOf(FormData);
        expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k');
    });

    it('responseType "blob" 返回 Blob', async () => {
        fetchMock.mockResolvedValue(new Response(new Blob(['audio'], { type: 'audio/mpeg' }), { status: 200 }));
        const size = await run(
            "const blob = await request({ url: baseUrl + '/v1/audio/speech', method: 'post', data: { input: 'hi' }, responseType: 'blob' }); return blob.size;",
        );
        expect(size).toBe(5);
    });

    it('非 2xx 直接失败，不把错误体当结果交给脚本', async () => {
        fetchMock.mockResolvedValue(json(400, { error: { message: '音色不存在' } }));
        await expect(run("return await http.get('/broken');")).rejects.toThrow('音色不存在');
    });

    it('取消原样抛出，不被包成执行失败', async () => {
        fetchMock.mockImplementation(
            (_url: string, init: RequestInit) =>
                new Promise((_resolve, reject) => {
                    if (init.signal?.aborted) return reject(new Error('aborted'));
                    init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
                }),
        );
        const controller = new AbortController();
        controller.abort();
        await expect(run("return await http.get('/slow');", undefined, controller.signal)).rejects.toMatchObject({
            name: 'ProviderTransportError',
            kind: 'aborted',
        });
    });
});
