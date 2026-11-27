import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
    if (typeof globalThis.localStorage === "undefined") {
        Object.defineProperty(globalThis, "localStorage", {
            value: { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} },
            configurable: true,
        });
    }
});

import { diagnoseCapabilityCoverage, diagnoseChannel } from "./channel-diagnostics";
import type { AiConfig, ModelChannel } from "@/stores/use-config-store";

function makeChannel(overrides: Partial<ModelChannel> = {}): ModelChannel {
    return {
        id: "ch-1",
        name: "Primary",
        apiFormat: "openai",
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-test",
        proxyMode: "system",
        models: [
            { name: "gpt-image-1", capability: "image" },
            { name: "sora-2", capability: "video" },
            { name: "gpt-5", capability: "text" },
        ],
        ...overrides,
    };
}

describe("diagnoseChannel", () => {
    it("reports missing url, key, and models in priority order", () => {
        expect(diagnoseChannel(makeChannel({ baseUrl: "  " })).status).toBe("missing-url");
        expect(diagnoseChannel(makeChannel({ apiKey: "" })).status).toBe("missing-key");
        expect(diagnoseChannel(makeChannel({ models: [] })).status).toBe("missing-models");
    });

    it("reports ready and counts models per capability", () => {
        const result = diagnoseChannel(makeChannel());
        expect(result.ready).toBe(true);
        expect(result.status).toBe("ready");
        expect(result.counts).toEqual({ image: 1, video: 1, text: 1, audio: 0 });
    });
});

describe("diagnoseCapabilityCoverage", () => {
    it("summarizes readiness across image, video, text, and audio capabilities", () => {
        const channel = makeChannel();
        const config = {
            channels: [channel],
            imageModel: "ch-1::gpt-image-1",
            videoModel: "ch-1::sora-2",
            textModel: "ch-1::gpt-5",
            audioModel: "",
        } as unknown as AiConfig;

        const coverage = diagnoseCapabilityCoverage(config);
        expect(coverage.find((item) => item.capability === "image")?.ready).toBe(true);
        expect(coverage.find((item) => item.capability === "video")?.ready).toBe(true);
        expect(coverage.find((item) => item.capability === "text")?.ready).toBe(true);
        expect(coverage.find((item) => item.capability === "audio")).toMatchObject({ ready: false, availableCount: 0 });
    });
});
