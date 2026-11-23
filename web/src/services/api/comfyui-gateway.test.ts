/** 网关客户端：导入/编辑/删除走对路径与 body，不依赖真实网关。 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
    Object.assign(globalThis, { localStorage: { getItem: () => null } });
    return { request: vi.fn() };
});

vi.mock("./provider-transport", () => ({
    createProviderTransport: () => ({ request: h.request }),
    ProviderTransportError: class ProviderTransportError extends Error {
        constructor(public kind: string, message: string, public status: number) {
            super(message);
        }
    },
}));

import { deleteGatewayWorkflow, importGatewayWorkflow, setGatewayWorkflowVisibility, updateGatewayWorkflow } from "./comfyui-gateway";

const ok = (body: unknown = {}) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
    h.request.mockReset();
    h.request.mockResolvedValue(ok());
});

describe("ComfyUI 网关工作流管理", () => {
    it("导入带 body（含 json/name/type）并打到 import 路径", async () => {
        await importGatewayWorkflow({ json: { "1": { class_type: "SaveImage", inputs: {} } }, name: "我的工作流", type: "image" });
        const call = h.request.mock.calls[0][0];
        expect(call.method).toBe("POST");
        expect(call.url).toBe("http://127.0.0.1:8190/api/workflows/import");
        expect(JSON.parse(call.body)).toMatchObject({ name: "我的工作流", type: "image" });
        expect(JSON.parse(call.body).json).toHaveProperty("1");
    });

    it("类型留空时不发 type 字段（交给网关自动识别）", async () => {
        await importGatewayWorkflow({ json: {}, name: "x", type: "" });
        expect(JSON.parse(h.request.mock.calls[0][0].body)).not.toHaveProperty("type");
    });

    it("编辑走 /update 别名并带 bindings", async () => {
        await updateGatewayWorkflow("image-abc", { bindings: { prompt: { node: "4", input: "text" } } });
        const call = h.request.mock.calls[0][0];
        expect(call.url).toBe("http://127.0.0.1:8190/api/workflows/image-abc/update");
        expect(JSON.parse(call.body).bindings.prompt).toEqual({ node: "4", input: "text" });
    });

    it("删除走 /delete 别名（transport 只发 POST）", async () => {
        await deleteGatewayWorkflow("image-abc");
        const call = h.request.mock.calls[0][0];
        expect(call.method).toBe("POST");
        expect(call.url).toBe("http://127.0.0.1:8190/api/workflows/image-abc/delete");
    });

    it("显隐走 visibility 路径", async () => {
        await setGatewayWorkflowVisibility("image-abc", false);
        const call = h.request.mock.calls[0][0];
        expect(call.url).toBe("http://127.0.0.1:8190/api/workflows/image-abc/visibility");
        expect(JSON.parse(call.body)).toEqual({ enabled: false });
    });

    it("id 中的特殊字符被 URL 编码", async () => {
        await deleteGatewayWorkflow("image/我的 工作流");
        expect(h.request.mock.calls[0][0].url).toContain(encodeURIComponent("image/我的 工作流"));
    });
});
