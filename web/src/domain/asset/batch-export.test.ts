import { describe, expect, it } from "vitest";

import { batchExportExtension, collectBatchExportFiles, isBatchExportable, planBatchExport, type BatchExportNode } from "./batch-export";

function node(overrides: Partial<BatchExportNode> & Pick<BatchExportNode, "id">): BatchExportNode {
    return {
        type: "image",
        title: overrides.id,
        position: { x: 0, y: 0 },
        metadata: { content: "data:image/png;base64,AA==" },
        ...overrides,
    };
}

describe("planBatchExport", () => {
    it("按画布位置从左上到右下编号，而不是按数组顺序", () => {
        const items = planBatchExport([
            node({ id: "c", title: "第三张", position: { x: 100, y: 900 } }),
            node({ id: "a", title: "第一张", position: { x: 100, y: 100 } }),
            node({ id: "b", title: "第二张", position: { x: 900, y: 100 } }),
        ]);

        expect(items.map((item) => item.fileName)).toEqual(["01_第一张.png", "02_第二张.png", "03_第三张.png"]);
        expect(items.map((item) => item.id)).toEqual(["a", "b", "c"]);
    });

    it("跳过文本节点和没有内容的节点，序号仍然连续", () => {
        const items = planBatchExport([
            node({ id: "text", type: "text", metadata: {} }),
            node({ id: "empty", metadata: {} }),
            node({ id: "one", title: "封面", position: { x: 0, y: 0 } }),
            node({ id: "two", title: "内页", position: { x: 0, y: 400 } }),
        ]);

        expect(items.map((item) => item.fileName)).toEqual(["01_封面.png", "02_内页.png"]);
    });

    it("超过 9 张时补零宽度跟着总数走", () => {
        const nodes = Array.from({ length: 12 }, (_, index) => node({ id: `n${index}`, title: `图${index + 1}`, position: { x: index * 10, y: 0 } }));
        const items = planBatchExport(nodes);

        expect(items[0].fileName).toBe("01_图1.png");
        expect(items[9].fileName).toBe("10_图10.png");
        expect(items[11].fileName).toBe("12_图12.png");
    });

    it("标题里的非法字符与 Windows 保留名不会产出非法文件名", () => {
        const [slash] = planBatchExport([node({ id: "a", title: "封面/终稿" })]);
        expect(slash.fileName).toBe("01_封面 终稿.png");

        const [reserved] = planBatchExport([node({ id: "b", title: "CON" })]);
        expect(reserved.fileName).toBe("01_未命名_CON.png");
    });
});

describe("batchExportExtension", () => {
    it("优先用节点 mimeType，其次解析 data URL，最后按类型兜底", () => {
        expect(batchExportExtension(node({ id: "a", type: "video", metadata: { content: "https://x/v", mimeType: "video/webm" } }))).toBe("webm");
        expect(batchExportExtension(node({ id: "b", type: "audio", metadata: { content: "data:audio/wav;base64,AA==" } }))).toBe("wav");
        expect(batchExportExtension(node({ id: "c", metadata: { content: "data:image/jpeg;base64,AA==" } }))).toBe("jpg");
        // 远程地址既没有 mimeType 也解析不出 data 头，只能按节点类型兜底
        expect(batchExportExtension(node({ id: "d", metadata: { content: "https://x/a" } }))).toBe("png");
        expect(batchExportExtension(node({ id: "e", type: "video", metadata: { content: "blob:abc" } }))).toBe("mp4");
    });

    it("节点里写着 image/jpeg 但内容是 png 时，以 mimeType 为准并落成 jpg", () => {
        // 这条是刻意的：mimeType 是上传时记录的权威值，data 头可能被重编码过
        expect(batchExportExtension(node({ id: "a", metadata: { content: "data:image/png;base64,AA==", mimeType: "image/jpeg" } }))).toBe("jpg");
    });
});

describe("isBatchExportable", () => {
    it("只有图片/视频/音频且有内容才算可导出", () => {
        expect(isBatchExportable(node({ id: "a" }))).toBe(true);
        expect(isBatchExportable(node({ id: "b", type: "group" }))).toBe(false);
        expect(isBatchExportable(node({ id: "c", metadata: {} }))).toBe(false);
    });
});

describe("collectBatchExportFiles", () => {
    it("单个读取失败不影响整批，失败条目单独汇报", async () => {
        const items = planBatchExport([
            node({ id: "a", title: "A", position: { x: 0, y: 0 } }),
            node({ id: "b", title: "B", position: { x: 0, y: 100 } }),
            node({ id: "c", title: "C", position: { x: 0, y: 200 } }),
        ]);

        let calls = 0;
        const { files, failed } = await collectBatchExportFiles(items, async (_url) => {
            if (++calls === 2) throw new Error("CORS");
            return new Blob(["x"]);
        });

        expect(files.map((file) => file.name)).toEqual(["01_A.png", "03_C.png"]);
        expect(failed).toEqual([{ fileName: "02_B.png", reason: "CORS" }]);
    });
});
