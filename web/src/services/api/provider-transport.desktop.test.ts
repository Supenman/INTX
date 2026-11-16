/**
 * 桌面端的出口约束：请求由 Rust 侧发，即使全局代理开着也不套本地代理前缀。
 *
 * 浏览器路径在 provider-transport.test.ts 里测；这里单独一个文件，是因为
 * `runtime` 在模块加载时求值，node 环境默认是 browser，必须整文件替换掉。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, String(value)),
        removeItem: (key: string) => void store.delete(key),
        clear: () => store.clear(),
    };
    return { tauriFetch: vi.fn(), originFetch: vi.fn() };
});

vi.mock('@/lib/runtime/capabilities', () => ({ runtime: 'desktop', isDesktopApp: () => true }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: h.tauriFetch }));

import { useConfigStore } from '@/stores/use-config-store';
import { createProviderTransport } from './provider-transport';

const URL = 'https://api.example.com/v1/images/generations';

beforeEach(() => {
    h.tauriFetch.mockReset();
    h.tauriFetch.mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    h.originFetch.mockReset();
    vi.stubGlobal('fetch', h.originFetch);
    useConfigStore.setState((state) => ({
        config: { ...state.config, proxyEnabled: true, proxyUrl: 'http://127.0.0.1:23210' },
    }));
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('桌面端传输出口', () => {
    it('全局代理开着也走 Rust 侧，地址不被改写', async () => {
        const response = await createProviderTransport('system').request({ method: 'POST', url: URL, body: '{}' });
        expect(h.originFetch).not.toHaveBeenCalled();
        expect(h.tauriFetch).toHaveBeenCalledTimes(1);
        expect(h.tauriFetch.mock.calls[0][0]).toBe(URL);
        expect(response.ok).toBe(true);
    });

    it('流式请求同样不经浏览器 fetch', async () => {
        await createProviderTransport('system').stream({ method: 'POST', url: URL, body: '{}' });
        expect(h.originFetch).not.toHaveBeenCalled();
        expect(h.tauriFetch).toHaveBeenCalledTimes(1);
        expect(h.tauriFetch.mock.calls[0][0]).toBe(URL);
    });
});
