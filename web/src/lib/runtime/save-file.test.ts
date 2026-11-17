/**
 * M2.5-③ 原生另存为。
 *
 * 桌面端必须走系统保存对话框，并且把「取消」和「写盘失败」分开返回——
 * 上层才不会再无脑提示「已导出」。浏览器端只作为开发通道退回直落下载。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
    desktop: false,
    saveAs: vi.fn(),
    saveDialog: vi.fn(),
    writeFile: vi.fn(),
}));

vi.mock("./capabilities", () => ({ isDesktopApp: () => h.desktop }));
vi.mock("file-saver", () => ({ saveAs: h.saveAs }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: h.saveDialog }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeFile: h.writeFile }));

import { saveFile } from "./save-file";

beforeEach(() => {
    h.desktop = false;
    h.saveAs.mockReset();
    h.saveDialog.mockReset();
    h.writeFile.mockReset();
    h.saveDialog.mockResolvedValue("C:\\Users\\me\\Desktop\\out.png");
    h.writeFile.mockResolvedValue(undefined);
});

describe("浏览器通道", () => {
    it("退回 file-saver 直落下载，并报 saved", async () => {
        const outcome = await saveFile(new Blob(["hi"], { type: "text/plain" }), "a.txt");

        expect(outcome).toEqual({ status: "saved" });
        expect(h.saveAs).toHaveBeenCalledTimes(1);
        expect(h.saveDialog).not.toHaveBeenCalled();
    });
});

describe("桌面通道", () => {
    beforeEach(() => {
        h.desktop = true;
    });

    it("用户取消保存对话框：返回 canceled，不写盘", async () => {
        h.saveDialog.mockResolvedValue(null);

        const outcome = await saveFile(new Blob(["hi"]), "a.txt");

        expect(outcome).toEqual({ status: "canceled" });
        expect(h.writeFile).not.toHaveBeenCalled();
        expect(h.saveAs).not.toHaveBeenCalled();
    });

    it("写盘成功才报 saved，并带回落盘路径", async () => {
        const outcome = await saveFile(new Blob([new Uint8Array([1, 2, 3])]), "a.bin");

        expect(outcome).toEqual({ status: "saved", path: "C:\\Users\\me\\Desktop\\out.png" });
        expect(h.writeFile).toHaveBeenCalledTimes(1);
        const [path, bytes] = h.writeFile.mock.calls[0];
        expect(path).toBe("C:\\Users\\me\\Desktop\\out.png");
        expect(Array.from(bytes as Uint8Array)).toEqual([1, 2, 3]);
    });

    it("把 data URL 解成原始字节再写盘", async () => {
        await saveFile("data:image/png;base64,AQID", "a.png");

        const [, bytes] = h.writeFile.mock.calls[0];
        expect(Array.from(bytes as Uint8Array)).toEqual([1, 2, 3]);
    });

    it("写盘失败返回 failed，交给上层提示", async () => {
        h.writeFile.mockRejectedValue(new Error("forbidden path"));

        const outcome = await saveFile("hello", "a.txt");

        expect(outcome.status).toBe("failed");
    });

    it("文件名里的路径分隔符被压平，不能借文件名改目录", async () => {
        await saveFile("hello", "../../etc/a.txt");

        expect(h.saveDialog.mock.calls[0][0].defaultPath).toBe(".._.._etc_a.txt");
        expect(h.saveDialog.mock.calls[0][0].filters).toEqual([{ name: "TXT", extensions: ["txt"] }]);
    });
});
