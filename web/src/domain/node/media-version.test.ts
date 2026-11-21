import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { clearVersionFields, listMediaVersions, nextVersionLabel, prepareMediaGenerationVersion, setPrimaryMediaVersion } from "./media-version";

function node(id: string, overrides: Partial<CanvasNodeData> = {}): CanvasNodeData {
    return { id, type: CanvasNodeType.Image, title: id, position: { x: 0, y: 0 }, width: 100, height: 100, metadata: {}, ...overrides };
}

describe("media version snapshots", () => {
    it("首次原地重生成保留旧媒体为 A，当前节点升到 B", () => {
        const source = node("n1", {
            title: "封面",
            metadata: { content: "data:image/png;base64,old", status: "success", prompt: "旧提示词", model: "model-x", errorDetails: "旧错误", retryBlocked: true },
        });
        const plan = prepareMediaGenerationVersion([source], "n1", "snap-1")!;
        expect(plan.versionRootId).toBe("n1");
        expect(plan.versionLabel).toBe("B");
        expect(plan.snapshotLabel).toBe("A");
        expect(plan.nodes).toHaveLength(2);

        const current = plan.nodes.find((item) => item.id === "n1")!;
        expect(current.metadata?.versionLabel).toBe("B");
        expect(current.metadata?.versionPrimary).toBe(true);

        const snap = plan.nodes.find((item) => item.id === "snap-1")!;
        expect(snap.title).toBe("封面 · A");
        expect(snap.metadata?.content).toBe("data:image/png;base64,old");
        expect(snap.metadata?.status).toBe("success");
        expect(snap.metadata?.prompt).toBe("旧提示词");
        expect(snap.metadata?.errorDetails).toBeUndefined();
        expect(snap.metadata?.retryBlocked).toBeUndefined();
    });

    it("再次重生成沿用同一版本族并分配下一个标签", () => {
        const nodes = [
            node("root", { metadata: { versionOfNodeId: "root", versionLabel: "A", versionPrimary: false, content: "old-a", status: "success" } }),
            node("current", { metadata: { versionOfNodeId: "root", versionLabel: "B", versionPrimary: true, content: "old-b", status: "success" } }),
        ];
        const plan = prepareMediaGenerationVersion(nodes, "current", "snap-2")!;
        expect(plan.versionRootId).toBe("root");
        expect(plan.versionLabel).toBe("C");
        expect(plan.snapshotLabel).toBe("B");
        expect(plan.nodes.find((item) => item.id === "root")?.metadata?.versionPrimary).toBe(false);
        expect(plan.nodes.find((item) => item.id === "current")?.metadata?.versionLabel).toBe("C");
        expect(plan.nodes.find((item) => item.id === "snap-2")?.metadata?.versionLabel).toBe("B");
    });

    it("批次图片快照剥掉运行中任务字段并归一化每张图状态", () => {
        const source = node("n1", {
            metadata: {
                content: "data:image/png;base64,primary",
                status: "loading",
                videoTaskId: "tk-running",
                videoTaskProvider: "openai",
                primaryImageId: "img-1",
                images: [
                    { id: "img-1", status: "loading", content: "data:image/png;base64,one", naturalWidth: 1, naturalHeight: 1, bytes: 1, mimeType: "image/png" },
                    { id: "img-2", status: "error", content: "", errorDetails: "失败", naturalWidth: 0, naturalHeight: 0, bytes: 0, mimeType: "image/png" },
                ],
            },
        });
        const plan = prepareMediaGenerationVersion([source], "n1", "snap-3")!;
        const snap = plan.nodes.find((item) => item.id === "snap-3")!;
        expect(snap.metadata?.videoTaskId).toBeUndefined();
        expect(snap.metadata?.videoTaskProvider).toBeUndefined();
        expect(snap.metadata?.primaryImageId).toBeUndefined();
        expect(snap.metadata?.images?.map((image) => image.status)).toEqual(["success", "idle"]);
        expect(snap.metadata?.images?.[1]?.errorDetails).toBeUndefined();
    });

    it("其他版本族的高标签不会影响当前版本族", () => {
        const source = node("n1", { metadata: { content: "old", status: "success" } });
        const unrelated = node("unrelated", { metadata: { versionOfNodeId: "other", versionLabel: "Z", versionPrimary: true, content: "z" } });
        const plan = prepareMediaGenerationVersion([source, unrelated], "n1", "snap-x")!;
        expect(plan.versionLabel).toBe("B");
    });

    it("空节点不生成快照，只建立版本族", () => {
        const source = node("empty", { metadata: { prompt: "第一张" } });
        const plan = prepareMediaGenerationVersion([source], "empty", "snap-4")!;
        expect(plan.snapshotId).toBeNull();
        expect(plan.versionLabel).toBe("A");
        expect(plan.nodes).toHaveLength(1);
        expect(plan.nodes[0]?.metadata?.versionPrimary).toBe(true);
    });

    it("列出版本并按标签排序，主版本切换只影响同一版本族", () => {
        const nodes = [
            node("a", { metadata: { versionOfNodeId: "root", versionLabel: "A", versionPrimary: true, content: "a" } }),
            node("b", { metadata: { versionOfNodeId: "root", versionLabel: "B", versionPrimary: false, content: "b" } }),
            node("other", { metadata: { versionLabel: "A", versionPrimary: true, content: "other" } }),
        ];
        expect(listMediaVersions(nodes, "root").map((item) => item.id)).toEqual(["a", "b"]);
        expect(listMediaVersions(nodes.filter((item) => item.id !== "a"), "root").map((item) => item.id)).toEqual(["b"]);
        const updated = setPrimaryMediaVersion(nodes, "b");
        expect(updated.find((item) => item.id === "a")?.metadata?.versionPrimary).toBe(false);
        expect(updated.find((item) => item.id === "b")?.metadata?.versionPrimary).toBe(true);
        expect(updated.find((item) => item.id === "other")?.metadata?.versionPrimary).toBe(true);
    });

    it("副本清除版本关系，避免同一版本族出现两个同标签节点", () => {
        const clean = clearVersionFields({ versionOfNodeId: "root", versionLabel: "B", versionPrimary: true, content: "x" });
        expect(clean).toEqual({ content: "x" });
        expect(nextVersionLabel([node("solo")], "solo")).toBe("A");
    });
});
