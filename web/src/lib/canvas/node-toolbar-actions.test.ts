import { beforeEach, describe, expect, it, vi } from "vitest";

import { installBuiltinTools, resetToolRegistry, resolveToolbarTools } from "@/domain";
import { nodeToolbarHandler } from "./node-toolbar-actions";
import type { CanvasNodeData } from "@/types/canvas";

const node = { id: "n1", type: "image" } as CanvasNodeData;

const actions = () => ({
    showInfo: vi.fn(),
    duplicate: vi.fn(),
    remove: vi.fn(),
});

const ctx = {
    toolMode: "select" as const,
    selectedCount: 1,
    nodeCount: 1,
    clipboardCount: 0,
    canUndo: false,
    canRedo: false,
    demoMode: false,
    node: { kind: "image", category: "source" as const, hasAsset: true, busy: false },
};

beforeEach(() => {
    resetToolRegistry();
    installBuiltinTools();
});

describe("节点悬浮栏 action 映射", () => {
    it("三个 action 各自调到对应 handler，且带的是当前节点", () => {
        const a = actions();
        nodeToolbarHandler("show-node-info", node, a)?.();
        nodeToolbarHandler("duplicate-node", node, a)?.();
        nodeToolbarHandler("delete-node", node, a)?.();
        expect(a.showInfo).toHaveBeenCalledWith(node);
        expect(a.duplicate).toHaveBeenCalledWith(node);
        expect(a.remove).toHaveBeenCalledWith(node);
    });

    it("没有映射的 action 返回 null，调用方据此不渲染", () => {
        // 宁可少一个按钮，也不渲染一个点了没反应的按钮。
        expect(nodeToolbarHandler("generate-node", node, actions())).toBeNull();
        expect(nodeToolbarHandler("", node, actions())).toBeNull();
    });
});

describe("悬浮栏接表后偏好生效", () => {
    it("默认渲染出 信息 / 复制 / 删除 三条", () => {
        expect(resolveToolbarTools("node-hover", ctx, null).map((t) => t.id)).toEqual([
            "node-info",
            "node-duplicate",
            "node-delete",
        ]);
    });

    it("用户隐藏某项后不再解析出来（接表前悬浮栏根本不读偏好）", () => {
        const prefs = { version: 1 as const, order: [], hidden: ["node-duplicate"] };
        const ids = resolveToolbarTools("node-hover", ctx, prefs).map((t) => t.id);
        expect(ids).toEqual(["node-info", "node-delete"]);
    });

    it("用户改顺序后解析顺序跟着变", () => {
        const prefs = { version: 1 as const, order: ["node-delete", "node-duplicate", "node-info"], hidden: [] };
        expect(resolveToolbarTools("node-hover", ctx, prefs).map((t) => t.id)).toEqual([
            "node-delete",
            "node-duplicate",
            "node-info",
        ]);
    });

    it("每条注册表条目都能落到 handler（否则会渲染成死按钮）", () => {
        const a = actions();
        for (const def of resolveToolbarTools("node-hover", ctx, null)) {
            expect(nodeToolbarHandler(def.action, node, a)).not.toBeNull();
        }
    });
});
