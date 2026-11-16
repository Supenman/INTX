/**
 * 提示词源拉取的接线回归。
 *
 * 源地址由用户自己填，之前是裸 `fetch`：桌面端遇到不返回 CORS 头的源就直接失败。
 * 迁到 ProviderTransport 后要保住原来的三条语义——每次绕过缓存、非 2xx 报状态码、
 * 取消原样抛出（不要被包成「拉取失败」写进来源的错误里）。
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

import { createPromptSource } from './prompt-source-presets';
import { runPromptSource } from './prompt-source-runtime';

const SOURCE = createPromptSource({ id: 's1', name: '测试源', url: 'https://prompts.example.com/dist/sources/a.json', builtIn: true });

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

describe('提示词源拉取', () => {
    it('按源地址 GET，并绕过缓存', async () => {
        fetchMock.mockResolvedValue(json(200, [{ id: 'p1', title: '标题', prompt: '画面' }]));
        const items = await runPromptSource(SOURCE);
        expect(items[0]).toMatchObject({ id: 'p1', title: '标题', prompt: '画面' });
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(SOURCE.url);
        expect(init.method).toBe('GET');
        expect(init.cache).toBe('no-store');
    });

    it('非 2xx 报出状态码', async () => {
        fetchMock.mockResolvedValue(json(404, {}));
        await expect(runPromptSource(SOURCE)).rejects.toThrow('404');
    });

    it('根不是数组时报错，不会静默当空列表', async () => {
        fetchMock.mockResolvedValue(json(200, { items: [] }));
        await expect(runPromptSource(SOURCE)).rejects.toThrow();
    });

    it('取消原样抛出，不被包成拉取失败', async () => {
        fetchMock.mockImplementation(
            (_url: string, init: RequestInit) =>
                new Promise((_resolve, reject) => {
                    if (init.signal?.aborted) return reject(new Error('aborted'));
                    init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
                }),
        );
        const controller = new AbortController();
        controller.abort();
        await expect(runPromptSource(SOURCE, { signal: controller.signal })).rejects.toMatchObject({
            name: 'ProviderTransportError',
            kind: 'aborted',
        });
    });

    it('跟随全局本地代理开关出网', async () => {
        const { useConfigStore } = await import('@/stores/use-config-store');
        useConfigStore.setState((state) => ({ config: { ...state.config, proxyEnabled: true, proxyUrl: 'http://127.0.0.1:23210' } }));
        fetchMock.mockResolvedValue(json(200, []));
        await runPromptSource(SOURCE).catch(() => undefined);
        expect((fetchMock.mock.calls[0] as [string])[0]).toBe(`http://127.0.0.1:23210/${SOURCE.url}`);
    });
});
