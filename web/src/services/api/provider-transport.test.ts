/**
 * 传输层重试语义的接线回归。
 *
 * 这里守的是一条红线：重试只对 GET 生效。POST 一旦重发，就可能是第二张已计费的单，
 * 所以成功路径要能重试，提交路径一次都不能多。
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

import { createProviderTransport, ProviderTransportError } from './provider-transport';

function reply(status: number, body: unknown = {}) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const GET = { method: 'GET' as const, url: 'https://api.example.com/v1/models' };
const POST = { method: 'POST' as const, url: 'https://api.example.com/v1/images/generations', body: '{}' };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    h.store.clear();
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('ProviderTransport 重试', () => {
    it('GET 遇到 502 会重试，最多两次，第三次成功', async () => {
        fetchMock.mockResolvedValueOnce(reply(502)).mockResolvedValueOnce(reply(503)).mockResolvedValueOnce(reply(200, { data: [] }));
        const pending = createProviderTransport('direct').request(GET);
        await vi.advanceTimersByTimeAsync(1_000);
        await vi.advanceTimersByTimeAsync(2_000);
        const response = await pending;
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(response.ok).toBe(true);
        expect(response.status).toBe(200);
    });

    it('GET 重试两次后仍失败，返回最后一次响应而不是抛错', async () => {
        fetchMock.mockImplementation(async () => reply(504));
        const pending = createProviderTransport('direct').request(GET);
        await vi.advanceTimersByTimeAsync(1_000);
        await vi.advanceTimersByTimeAsync(2_000);
        const response = await pending;
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(response.ok).toBe(false);
        expect(response.status).toBe(504);
    });

    it('POST 遇到 5xx 不重试（可能已收单）', async () => {
        fetchMock.mockResolvedValue(reply(502));
        const response = await createProviderTransport('direct').request(POST);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(response.ok).toBe(false);
    });

    it('GET 的连接类失败会重试', async () => {
        fetchMock
            .mockRejectedValueOnce(new TypeError('Failed to fetch'))
            .mockRejectedValueOnce(new TypeError('Failed to fetch'))
            .mockResolvedValueOnce(reply(200));
        const pending = createProviderTransport('direct').request(GET);
        await vi.advanceTimersByTimeAsync(1_000);
        await vi.advanceTimersByTimeAsync(2_000);
        const response = await pending;
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(response.ok).toBe(true);
    });

    it('POST 的连接类失败不重试，并保留失败类型', async () => {
        fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
        await expect(createProviderTransport('direct').request(POST)).rejects.toMatchObject({
            name: 'ProviderTransportError',
            kind: 'network',
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('不在重试清单里的状态码（如 501）不重试', async () => {
        fetchMock.mockResolvedValue(reply(501));
        await createProviderTransport('direct').request(GET);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('调用方取消时抛 aborted，不重试', async () => {
        const controller = new AbortController();
        fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
            controller.abort();
            throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        });
        await expect(createProviderTransport('direct').request({ ...GET, signal: controller.signal })).rejects.toMatchObject({
            name: 'ProviderTransportError',
            kind: 'aborted',
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('blob() 成功时返回 Blob', async () => {
        fetchMock.mockResolvedValue(new Response(new Blob(['video'], { type: 'video/mp4' }), { status: 200 }));
        const blob = await createProviderTransport('direct').blob({ method: 'GET', url: 'https://api.example.com/v1/videos/1/content' });
        expect(blob.type).toBe('video/mp4');
        expect(await blob.text()).toBe('video');
    });

    it('blob() 非 2xx 抛 http 类型并带状态码与正文片段', async () => {
        fetchMock.mockResolvedValue(new Response('{"error":{"message":"没权限"}}', { status: 403 }));
        await expect(createProviderTransport('direct').blob({ method: 'GET', url: 'https://api.example.com/v1/videos/1/content' })).rejects.toMatchObject({
            name: 'ProviderTransportError',
            kind: 'http',
            status: 403,
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('blob() 的 POST 遇到 502 不重试', async () => {
        fetchMock.mockResolvedValue(new Response('busy', { status: 502 }));
        await expect(createProviderTransport('direct').blob({ ...POST, url: 'https://api.example.com/v1/audio/speech' })).rejects.toMatchObject({ kind: 'http', status: 502 });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('blob() 的 GET 遇到 503 会重试', async () => {
        fetchMock
            .mockImplementationOnce(async () => new Response('busy', { status: 503 }))
            .mockImplementationOnce(async () => new Response(new Blob(['ok'], { type: 'video/mp4' }), { status: 200 }));
        const pending = createProviderTransport('direct').blob({ method: 'GET', url: 'https://api.example.com/v1/videos/1/content' });
        await vi.advanceTimersByTimeAsync(1_000);
        const blob = await pending;
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(await blob.text()).toBe('ok');
    });

    it('超时归类为 timeout，错误类型可被上层区分', async () => {
        fetchMock.mockImplementation(
            (_url: string, init: RequestInit) =>
                new Promise((_resolve, reject) => {
                    init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
                }),
        );
        const pending = createProviderTransport('direct').request({ ...POST, timeoutMs: 500 });
        const assertion = expect(pending).rejects.toBeInstanceOf(ProviderTransportError);
        await vi.advanceTimersByTimeAsync(500);
        await assertion;
        await expect(pending).rejects.toMatchObject({ kind: 'timeout' });
    });
});
