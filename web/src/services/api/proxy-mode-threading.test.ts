/**
 * 渠道出网方式必须真的落到请求地址。
 *
 * `withLocalProxy` 早就支持 proxyMode，但各 provider 的调用点忘了把渠道值传下去，
 * 结果「直连上游」只对 ModelScope 生效。这里从 `fetchChannelModels` 打进去，
 * 断言渠道 `direct` 在全局代理开着时仍然直连——调用点漏传就会红。
 *
 * 收口后地址由 ProviderTransport 统一改写，所以桩打在 fetch 上而不是 axios 上。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
    // 这批代码按浏览器写（i18n 与 store 都读 localStorage），补个内存桩即可。
    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, String(value)),
        removeItem: (key: string) => void store.delete(key),
        clear: () => store.clear(),
    };
    return { fetch: vi.fn() };
});

import { createModelChannel, useConfigStore } from "@/stores/use-config-store";
import { fetchChannelModels } from "./image";

const requestedUrl = () => h.fetch.mock.calls[0][0] as string;

beforeEach(() => {
    h.fetch.mockReset();
    h.fetch.mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal("fetch", h.fetch);
    useConfigStore.setState((state) => ({
        config: { ...state.config, proxyEnabled: true, proxyUrl: "http://127.0.0.1:23210" },
    }));
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("渠道出网方式落到请求地址", () => {
    it("direct 的渠道即便全局代理开着也直连", async () => {
        await fetchChannelModels(createModelChannel({ name: "a", baseUrl: "https://api.example.com", apiKey: "k", proxyMode: "direct" }));
        expect(requestedUrl()).toBe("https://api.example.com/v1/models");
    });

    it("system 的渠道跟随全局代理开关", async () => {
        await fetchChannelModels(createModelChannel({ name: "a", baseUrl: "https://api.example.com", apiKey: "k", proxyMode: "system" }));
        expect(requestedUrl()).toBe("http://127.0.0.1:23210/https://api.example.com/v1/models");
    });
});
