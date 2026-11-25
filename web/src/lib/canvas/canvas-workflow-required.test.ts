/**
 * 工作流必填项：浮层里只声明 required、又没给 default 的字段，用户不填就会
 * 一路提交到网关，最后只得到一句看不懂的错误。这里钉住「算不算缺」的边界，
 * 免得把有默认值、布尔 false、以及由节点连线和面板负责的字段误判成缺失。
 */
import { describe, expect, it, vi } from "vitest";

import type { ComfyWorkflowContract } from "@/types/comfy-workflow";

// canvas-workflow 会连带载入配置 store（读 localStorage）；本用例只验判定，给个内存桩。
vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined, removeItem: () => undefined, clear: () => undefined });
const { missingWorkflowFields } = await import("./canvas-workflow");

const workflow = (fields: ComfyWorkflowContract["fields"]) => ({ fields, outputNodes: ["9"] }) satisfies ComfyWorkflowContract;

describe("missingWorkflowFields", () => {
    it("没有工作流就没有必填项", () => {
        expect(missingWorkflowFields(undefined, {})).toEqual([]);
    });

    it("必填且没填的字段会被点名", () => {
        expect(missingWorkflowFields(workflow([{ key: "sampler", from: "value", type: "string", required: true }]), {})).toEqual(["sampler"]);
    });

    it("空串按没填写算，布尔 false 不算缺", () => {
        const fields: ComfyWorkflowContract["fields"] = [
            { key: "negative", from: "value", type: "string", required: true },
            { key: "denoise", from: "value", type: "boolean", required: true },
        ];
        expect(missingWorkflowFields(workflow(fields), { negative: "   ", denoise: false })).toEqual(["negative"]);
    });

    it("声明了默认值时留空可以提交", () => {
        expect(missingWorkflowFields(workflow([{ key: "steps", from: "value", type: "number", required: true, default: 20 }]), {})).toEqual([]);
    });

    it("媒体、提示词与张数由节点负责，不算浮层缺项", () => {
        const fields: ComfyWorkflowContract["fields"] = [
            { key: "image1", from: "image", type: "string", required: true, media: "image" },
            { key: "prompt", from: "prompt", type: "string", required: true },
            { key: "count", from: "count", type: "number", required: true },
        ];
        expect(missingWorkflowFields(workflow(fields), {})).toEqual([]);
    });
});
