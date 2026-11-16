import { describe, expect, it, vi } from "vitest";

/**
 * 权限偏好的持久化。
 *
 * 为什么单独测：这是「安全设置」，最怕的是**存了个我们不认的值，然后静默回落到最宽松那一档**。
 * 早期草稿用过 auto / manual / readonly，自己本机 localStorage 里可能还留着——
 * 那些值现在必须被当成脏值丢掉，回落到 automatic（花钱和删除仍要问），
 * 绝不能把它们解释成 full。
 */
function stubStorage(initial: Record<string, string> = {}) {
    const store = new Map(Object.entries(initial));
    vi.stubGlobal("localStorage", {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, String(value)),
        removeItem: (key: string) => void store.delete(key),
        clear: () => store.clear(),
    });
    return store;
}

/** store 在模块初始化时就读取偏好，所以每个用例都得拿到一份新的模块实例。 */
async function loadStore() {
    vi.resetModules();
    return import("./use-agent-store");
}

describe("Agent 权限偏好持久化", () => {
    it("没有任何记录时默认 automatic", async () => {
        stubStorage();
        const { useAgentStore } = await loadStore();
        expect(useAgentStore.getState().permission).toBe("automatic");
    });

    it("记住用户选过的档位", async () => {
        stubStorage({ "infinite-canvas:agent-permission": "request" });
        const { useAgentStore } = await loadStore();
        expect(useAgentStore.getState().permission).toBe("request");
    });

    it("旧版本遗留的 auto / manual / readonly 一律回落 automatic，不放宽成 full", async () => {
        for (const stale of ["auto", "manual", "readonly", "yolo", ""]) {
            stubStorage({ "infinite-canvas:agent-permission": stale });
            const { useAgentStore } = await loadStore();
            expect(useAgentStore.getState().permission, `stale=${stale || "(empty)"}`).toBe("automatic");
        }
    });

    it("setPermission 同时改内存状态和 localStorage", async () => {
        const store = stubStorage();
        const { AGENT_PERMISSION_KEY, useAgentStore } = await loadStore();
        useAgentStore.getState().setPermission("full");
        expect(useAgentStore.getState().permission).toBe("full");
        expect(store.get(AGENT_PERMISSION_KEY)).toBe("full");
    });

    it("写入失败时切换仍然生效，只是本次会话有效", async () => {
        vi.stubGlobal("localStorage", {
            getItem: () => null,
            setItem: () => {
                throw new Error("quota");
            },
            removeItem: () => undefined,
            clear: () => undefined,
        });
        const { useAgentStore } = await loadStore();
        expect(useAgentStore.getState().permission).toBe("automatic");
        expect(() => useAgentStore.getState().setPermission("request")).not.toThrow();
        expect(useAgentStore.getState().permission).toBe("request");
    });
});
