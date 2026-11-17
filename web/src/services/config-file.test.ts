/**
 * 导出文件会离开本机：API Key 与 WebDAV 密码一律不写进去。
 * 旧实现把整个 config / webdav 原样序列化，等于把 Key 复制了一份到磁盘。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, String(value)),
        removeItem: (key: string) => void store.delete(key),
        clear: () => store.clear(),
    };
    return { saveAs: vi.fn() };
});

vi.mock("file-saver", () => ({ saveAs: h.saveAs }));

import { createModelChannel, useConfigStore } from "@/stores/use-config-store";
import { exportAppConfig } from "./config-file";

const API_KEY = "sk-must-not-leak";
const WEBDAV_PASSWORD = "webdav-must-not-leak";

beforeEach(() => {
    h.saveAs.mockReset();
    useConfigStore.setState((state) => ({
        config: {
            ...state.config,
            apiKey: API_KEY,
            channels: [createModelChannel({ name: "a", baseUrl: "https://api.example.com", apiKey: API_KEY })],
        },
        webdav: { ...state.webdav, password: WEBDAV_PASSWORD },
    }));
});

describe("导出配置不含凭据", () => {
    it("API Key 与 WebDAV 密码不写进导出文件", async () => {
        await exportAppConfig();

        const blob = h.saveAs.mock.calls[0][0] as Blob;
        const text = await blob.text();
        expect(text).not.toContain(API_KEY);
        expect(text).not.toContain(WEBDAV_PASSWORD);

        const data = JSON.parse(text);
        expect(data.config.apiKey).toBe("");
        expect(data.config.channels[0].apiKey).toBe("");
        expect(data.webdav.password).toBe("");
        // 非凭据字段仍然保留，导出才还能用来迁移配置。
        expect(data.config.channels[0].baseUrl).toBe("https://api.example.com");
    });
});
