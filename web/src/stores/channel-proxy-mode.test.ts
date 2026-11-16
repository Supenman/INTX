import { describe, expect, it, beforeEach, vi } from "vitest";

// store 的持久化层和 i18n 都会读 localStorage；这些用例只验纯函数，给个内存桩就够。
vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
});

const { createModelChannel, resolveModelRequestConfig, useConfigStore, withLocalProxy } = await import("./use-config-store");

/** 渠道出网方式（行为参考 OpenDirector proxyMode）：system 跟随全局代理，direct 恒直连。 */
describe("channel proxyMode", () => {
    beforeEach(() => {
        useConfigStore.setState((state) => ({
            config: { ...state.config, proxyEnabled: true, proxyUrl: "http://127.0.0.1:23210" },
        }));
    });

    it("缺省归一化为 system，非法值也回落到 system", () => {
        expect(createModelChannel({ name: "a" }).proxyMode).toBe("system");
        expect(createModelChannel({ name: "a", proxyMode: undefined }).proxyMode).toBe("system");
        expect(createModelChannel({ name: "a", proxyMode: "bogus" as never }).proxyMode).toBe("system");
        expect(createModelChannel({ name: "a", proxyMode: "direct" }).proxyMode).toBe("direct");
    });

    it("system 在代理开关打开时改写到本地代理前缀", () => {
        expect(withLocalProxy("https://api.example.com/v1/x", "system")).toBe("http://127.0.0.1:23210/https://api.example.com/v1/x");
    });

    it("direct 即使代理开关打开也不改写", () => {
        expect(withLocalProxy("https://api.example.com/v1/x", "direct")).toBe("https://api.example.com/v1/x");
    });

    it("system 在代理开关关闭时保持原地址", () => {
        useConfigStore.setState((state) => ({ config: { ...state.config, proxyEnabled: false } }));
        expect(withLocalProxy("https://api.example.com/v1/x", "system")).toBe("https://api.example.com/v1/x");
    });

    it("不传 proxyMode 保持老行为（跟随全局开关）", () => {
        expect(withLocalProxy("https://api.example.com/v1/x")).toBe("http://127.0.0.1:23210/https://api.example.com/v1/x");
    });

    it("resolveModelRequestConfig 把渠道的出网方式带给请求配置", () => {
        const direct = createModelChannel({ id: "ch-direct", name: "direct", baseUrl: "https://api.example.com", proxyMode: "direct" });
        const config = { ...useConfigStore.getState().config, channels: [direct] };
        expect(resolveModelRequestConfig(config, "ch-direct::gpt-image-2").proxyMode).toBe("direct");
    });
});
