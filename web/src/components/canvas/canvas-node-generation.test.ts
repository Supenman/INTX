/**
 * 生成输入的编号顺序：参考栏按连线顺序列出素材，提示词也按同一顺序编号
 * （图片「参考图片编号：图片1、图片2」、文本「【文本1】」）。两边一旦分叉，
 * 用户就无法把提示词里的名字对上具体哪一张缩略图，所以顺序在这里钉死。
 */
import { describe, expect, it, vi } from "vitest";

// i18n 初始化会读 localStorage；这些用例只验顺序与编号，给个内存桩就够。
vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
});

const { buildNodeGenerationContext } = await import("./canvas-node-generation");
const { CanvasNodeType } = await import("@/types/canvas");

const node = (id: string, type: string, metadata: Record<string, unknown>) => ({
    id,
    type,
    title: id,
    position: { x: 0, y: 0 },
    width: 100,
    height: 100,
    metadata,
});

const connect = (fromNodeId: string, toNodeId: string) => ({ id: `${fromNodeId}->${toNodeId}`, fromNodeId, toNodeId });

describe("生成输入的编号顺序", () => {
    it("多条文本按连线顺序编号，与参考栏的展示顺序一致", () => {
        const nodes = [node("text-a", CanvasNodeType.Text, { content: "第一段" }), node("text-b", CanvasNodeType.Text, { content: "第二段" }), node("text-target", CanvasNodeType.Text, { content: "目标节点" })];
        const connections = [connect("text-b", "text-target"), connect("text-a", "text-target")];
        const context = buildNodeGenerationContext("text-target", nodes, connections, "请合并");
        expect(context.textCount).toBe(2);
        // 连在前面的 text-b 才是「文本1」，不能按节点数组顺序编号。
        expect(context.prompt).toBe("请合并\n\n【文本 1】\n第二段\n\n【文本 2】\n第一段");
    });

    it("参考图片按连线顺序进入请求，第一条连线就是图片1", () => {
        const nodes = [node("image-a", CanvasNodeType.Image, { content: "https://example.test/a.png" }), node("image-b", CanvasNodeType.Image, { content: "https://example.test/b.png" }), node("text-target", CanvasNodeType.Text, {})];
        const connections = [connect("image-b", "text-target"), connect("image-a", "text-target")];
        const context = buildNodeGenerationContext("text-target", nodes, connections, "改图");
        expect(context.referenceImages.map((image) => image.id)).toEqual(["image-b", "image-a"]);
    });
});
