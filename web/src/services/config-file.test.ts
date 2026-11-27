import { describe, expect, it, vi } from "vitest";

const { savedBlobs } = vi.hoisted(() => {
    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, String(value)),
        removeItem: (key: string) => void store.delete(key),
        clear: () => store.clear(),
    };
    return { savedBlobs: [] as Blob[] };
});

vi.mock("file-saver", () => ({
    saveAs: (blob: Blob) => {
        savedBlobs.push(blob);
    },
}));

import { useConfigStore } from "@/stores/use-config-store";
import { exportAppConfig } from "./config-file";

const SECRET_TOP = "sk-top-level-secret-must-not-leak";
const SECRET_CHANNEL = "sk-channel-secret-must-not-leak";

describe("exportAppConfig", () => {
    it("抹空顶层和各渠道的 API Key，同时不改动内存里的真实值", async () => {
        savedBlobs.length = 0;
        const state = useConfigStore.getState();
        useConfigStore.setState({
            config: {
                ...state.config,
                apiKey: SECRET_TOP,
                channels: state.config.channels.map((channel) => ({ ...channel, apiKey: SECRET_CHANNEL })),
            },
        });

        await exportAppConfig();

        expect(savedBlobs).toHaveLength(1);
        const text = await savedBlobs[0].text();
        expect(text).not.toContain(SECRET_TOP);
        expect(text).not.toContain(SECRET_CHANNEL);

        const data = JSON.parse(text);
        expect(data.app).toBe("intx");
        expect(data.config.apiKey).toBe("");
        expect(data.config.channels.every((channel: { apiKey: string }) => channel.apiKey === "")).toBe(true);

        const after = useConfigStore.getState();
        expect(after.config.apiKey).toBe(SECRET_TOP);
        expect(after.config.channels[0].apiKey).toBe(SECRET_CHANNEL);
    });
});
