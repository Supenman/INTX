import { describe, expect, it } from "vitest";

import { createZip, readZip } from "./zip";

function endRecord(count: number, centralSize = 0, centralOffset = 0) {
    const bytes = new Uint8Array(22);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, count, true);
    view.setUint16(10, count, true);
    view.setUint32(12, centralSize, true);
    view.setUint32(16, centralOffset, true);
    return bytes;
}

/** 一条只声明大小、不含任何压缩数据的中央目录项，用来模拟「小包声明巨量原始内容」。 */
function centralEntry(uncompressedSize: number) {
    const bytes = new Uint8Array(46);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint32(24, uncompressedSize, true);
    return bytes;
}

function join(...chunks: Uint8Array[]) {
    const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let cursor = 0;
    for (const chunk of chunks) {
        out.set(chunk, cursor);
        cursor += chunk.length;
    }
    return out;
}

describe("readZip 的导入上限", () => {
    it("自己导出的包仍能正常解开", async () => {
        const file = await createZip([{ name: "01_封面.png", data: "hello" }]);
        const map = await readZip(file);
        expect([...map.keys()]).toEqual(["01_封面.png"]);
        expect(await map.get("01_封面.png")!.text()).toBe("hello");
    });

    it("条目数超限在解压之前就拒绝", async () => {
        const file = new Blob([endRecord(513)]);
        await expect(readZip(file)).rejects.toThrow(/条目超过/);
    });

    it("中央目录宣称解压后超过上限时拒绝，不真的去解压", async () => {
        const entry = centralEntry(600 * 1024 * 1024);
        const file = new Blob([join(entry, endRecord(1, entry.length, 0))]);
        await expect(readZip(file)).rejects.toThrow(/超过 512 MB/);
    });

    it("ZIP64 明确拒绝，不按 0xffff 当数字算", async () => {
        await expect(readZip(new Blob([endRecord(0xffff)]))).rejects.toThrow(/ZIP64/);
    });

    it("没有结束目录的坏包给出格式错误", async () => {
        await expect(readZip(new Blob([new Uint8Array(64)]))).rejects.toThrow(/格式无效/);
    });
});
