import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
    const storage = new Map<string, string>();
    Object.assign(globalThis, { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } });
    return { request: vi.fn() };
});
vi.mock("./provider-transport", async (original) => ({
    ...await original<typeof import("./provider-transport")>(),
    createProviderTransport: () => ({ request: h.request }),
}));
vi.mock("@/services/generation", async (original) => ({
    ...await original<typeof import("@/services/generation")>(),
    runWithTask: ({ submit }: { submit: () => unknown }) => submit(),
    submitVideoTask: async ({ transport }: { transport: { submit: () => unknown } }) => ({ handle: await transport.submit() }),
}));
vi.mock("@/services/image-storage", () => ({ imageToDataUrl: async (image: { dataUrl: string }) => image.dataUrl }));

import { defaultConfig, createModelChannel, useConfigStore, type AiConfig } from "@/stores/use-config-store";
import { comfyWorkflowRequest } from "@/lib/comfy-workflow";
import { requestGeneration, requestEdit } from "./image";
import { createVideoGenerationTask } from "./video";

function configFor(capability: "image" | "video" = "image"): AiConfig {
    return {
        ...defaultConfig, model: "local-comfyui::custom", count: "3", size: "2048x2048", background: "transparent",
        channels: [createModelChannel({ id: "local-comfyui", baseUrl: "http://127.0.0.1:8190", apiKey: "local", proxyMode: "direct", models: [{
            name: "custom", capability, label: "用户工作流", workflow: { fields: [
                { key: "prompt", from: "prompt", type: "string" }, { key: "steps", from: "params.steps", type: "number" },
            ], outputNodes: ["4"] },
        }] })],
        workflowValues: { "local-comfyui::custom": { steps: 12, undeclared: "ignored" }, "other::custom": { steps: 99 } },
    };
}

beforeEach(() => {
    h.request.mockReset();
    h.request.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [{ b64_json: "AA==" }] }) });
});

describe("工作流到前端请求的接线", () => {
    it("生图不携带全局默认参数，只传当前模型声明过的显式值", async () => {
        await requestGeneration(configFor(), "new prompt");
        expect(h.request).toHaveBeenCalledTimes(1);
        const request = h.request.mock.calls[0][0];
        expect(request.url).toBe("http://127.0.0.1:8190/v1/images/generations");
        const body = JSON.parse(request.body);
        expect(body).toMatchObject({ n: 1, workflow_values: { steps: 12 } });
        for (const key of ["size", "quality", "background"]) expect(body).not.toHaveProperty(key);
    });

    it("图片编辑保留参考素材，去掉默认尺寸和背景", async () => {
        await requestEdit(configFor(), "edit", [{ id: "ref", name: "ref.png", dataUrl: "data:image/png;base64,AA==", type: "image/png" }]);
        const body = h.request.mock.calls[0][0].body as FormData;
        expect(body.get("workflow_values")).toBe('{"steps":12}');
        expect(body.get("image")).toBeInstanceOf(File);
        expect(body.get("n")).toBe("1");
        for (const key of ["size", "quality", "background"]) expect(body.has(key)).toBe(false);
    });

    it("视频请求不带默认时长与模式，参数按完整模型标识隔离", async () => {
        h.request.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: "task-1" }) });
        await createVideoGenerationTask(configFor("video"), "video");
        expect(h.request).toHaveBeenCalledTimes(1);
        const body = h.request.mock.calls[0][0].body as FormData;
        expect(body.get("workflow_values")).toBe('{"steps":12}');
        for (const key of ["size", "seconds", "mode", "resolution_name"]) expect(body.has(key)).toBe(false);
    });

    it("渠道重扫和归一化保留声明，参数变化能更新同名模型", () => {
        const config = configFor();
        useConfigStore.setState({ config });
        const models = config.channels[0].models;
        useConfigStore.getState().syncLocalComfyChannel(models);
        const updated = structuredClone(models);
        updated[0].workflow!.fields.push({ key: "seed", from: "params.seed", type: "number" });
        useConfigStore.getState().syncLocalComfyChannel(updated);
        expect(useConfigStore.getState().config.channels[0].models[0].workflow?.fields).toHaveLength(3);
        expect(comfyWorkflowRequest(config)).toEqual({ workflow_values: { steps: 12 } });
    });

    it("云端渠道保留原有请求参数", async () => {
        const config = configFor();
        delete config.channels[0].models[0].workflow;
        await requestGeneration(config, "cloud");
        expect(JSON.parse(h.request.mock.calls[0][0].body)).toMatchObject({ n: 3, size: "2048x2048", background: "transparent" });
    });
});
