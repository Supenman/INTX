/**
 * 文件落盘的唯一出口（M2.5 第③项）。
 *
 * 桌面版是唯一对外产品：必须弹出系统「另存为」由用户选位置，并且只有真正
 * 写盘成功才返回 saved——用户在对话框点取消要能被区分出来，不能再无脑提示
 * 「已导出」。浏览器只作为开发与自动检查通道，退回 file-saver 的直落下载。
 *
 * 调用方拿到 `SaveFileOutcome` 后再决定提示什么；不要在调用前就报成功。
 */
import { isDesktopApp } from "./capabilities";

export type SaveFileOutcome =
    | { status: "saved"; path?: string }
    | { status: "canceled" }
    | { status: "failed"; error?: unknown };

/** 既能存二进制（图片/视频/zip），也能存文本（JSON）。 */
export type SaveFileInput = Blob | string;

/** 桌面写盘需要字节；浏览器分支不经过这里。 */
async function toBytes(data: SaveFileInput) {
    if (typeof data !== "string") return new Uint8Array(await data.arrayBuffer());

    const value = data.trim();
    if (value.startsWith("data:")) return decodeDataUrl(value);
    // 画布节点里存的是 data: / blob: / https: 三种地址，都按字节取。
    if (/^(blob:|https?:|file:)/i.test(value)) {
        const response = await fetch(value);
        if (!response.ok) throw new Error(`读取文件失败：HTTP ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
    }
    return new TextEncoder().encode(data);
}

function decodeDataUrl(value: string) {
    const comma = value.indexOf(",");
    if (comma < 0) throw new Error("无效的 data URL");
    const meta = value.slice(5, comma);
    const payload = value.slice(comma + 1);
    if (!/;base64/i.test(meta)) return new TextEncoder().encode(decodeURIComponent(payload));

    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
}

const KNOWN_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "mp4", "webm", "mp3", "wav", "ogg", "zip", "json", "txt"]);

/** 只给系统对话框一个默认筛选，用户仍可改成「所有文件」。标签用扩展名，避免锁死语言。 */
function filtersFor(fileName: string) {
    const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
    return KNOWN_EXTENSIONS.has(extension) ? [{ name: extension.toUpperCase(), extensions: [extension] }] : undefined;
}

function safeFileName(fileName: string) {
    const cleaned = fileName.replace(/[\\/:*?"<>|]/g, "_").trim();
    return cleaned || "download";
}

export async function saveFile(data: SaveFileInput, fileName: string): Promise<SaveFileOutcome> {
    const name = safeFileName(fileName);

    if (!isDesktopApp()) {
        try {
            const { saveAs } = await import("file-saver");
            saveAs(data, name);
            return { status: "saved" };
        } catch (error) {
            return { status: "failed", error };
        }
    }

    try {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const path = await save({ defaultPath: name, filters: filtersFor(name) });
        if (!path) return { status: "canceled" };

        const { writeFile } = await import("@tauri-apps/plugin-fs");
        await writeFile(path, await toBytes(data));
        return { status: "saved", path };
    } catch (error) {
        return { status: "failed", error };
    }
}
