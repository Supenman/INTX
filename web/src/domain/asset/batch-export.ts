/**
 * 画布框选批量导出的规划层。
 *
 * 只做三件事，全是纯函数：挑出「有东西可下」的节点、按画布位置排序、给每张起
 * 一个能交付的名字（`01_封面.png`）。取字节、打包、落盘放在
 * `hooks/use-batch-export.ts`——那几件事要碰 fetch 与系统对话框，不该进 domain。
 *
 * 结构类型而不是 import `CanvasNodeData`：domain 保持零依赖，单测不用构造整个
 * 节点对象；调用方传真实节点进来，多出来的字段天然被忽略。
 */

import { buildExportFileName, sortForExport } from "./export";

/** 只描述规划用得上的字段，`CanvasNodeData` 结构上兼容。 */
export type BatchExportNode = {
    id: string;
    type: string;
    title: string;
    position: { x: number; y: number };
    metadata?: {
        content?: string;
        mimeType?: string;
    };
};

export type BatchExportItem = {
    id: string;
    /** 交付时的文件名，含序号与扩展名 */
    fileName: string;
    /** `data:` / `blob:` / `https:` 三种地址之一 */
    url: string;
    /** 节点标题，失败清单里给用户认得出 */
    title: string;
};

export type BatchExportFailure = {
    fileName: string;
    reason: string;
};

const EXPORTABLE_TYPES = new Set(["image", "video", "audio"]);

/**
 * MIME → 扩展名。顺序有讲究：`image/jpeg` 必须排在 `image/*` 之类的宽匹配前面，
 * 所以这里只写具体类型，不写通配。
 */
const MIME_EXTENSIONS: ReadonlyArray<readonly [RegExp, string]> = [
    [/png/i, "png"],
    [/jpe?g/i, "jpg"],
    [/webp/i, "webp"],
    [/avif/i, "avif"],
    [/gif/i, "gif"],
    [/webm/i, "webm"],
    [/quicktime/i, "mov"],
    [/mp4/i, "mp4"],
    [/wav/i, "wav"],
    [/opus/i, "opus"],
    [/aac/i, "aac"],
    [/flac/i, "flac"],
    [/ogg/i, "ogg"],
    [/mpeg|mp3/i, "mp3"],
];

function matchExtension(mime: string) {
    if (!mime) return undefined;
    return MIME_EXTENSIONS.find(([pattern]) => pattern.test(mime))?.[1];
}

/**
 * 扩展名优先读 `metadata.mimeType`，没有再解析 data URL 头，最后按节点类型兜底。
 *
 * 不能直接用节点类型决定：视频节点里可能是 webm，音频节点里可能是 wav，
 * 一律发成 mp4/mp3 的话，拿到手的文件双击放不出来。
 */
export function batchExportExtension(node: BatchExportNode): string {
    const content = node.metadata?.content ?? "";
    const dataMime = /^data:([^;,]+)/.exec(content)?.[1] ?? "";
    const resolved = matchExtension(node.metadata?.mimeType ?? "") ?? matchExtension(dataMime);
    if (resolved) return resolved;
    if (node.type === "video") return "mp4";
    if (node.type === "audio") return "mp3";
    return "png";
}

/** 有内容、且类型属于可下载媒体的节点。文本节点、空壳生成节点都会被跳过。 */
export function isBatchExportable(node: BatchExportNode): boolean {
    return EXPORTABLE_TYPES.has(node.type) && Boolean(node.metadata?.content);
}

/**
 * 规划一次批量导出：跳过无内容的节点 → 按左上到右下排序 → 编号命名。
 *
 * 序号按**过滤后**的总数算，所以画布里混着文本节点时，导出的序号仍然连续
 * （不会出现 01、03、04 这种断号）。
 */
export function planBatchExport(nodes: readonly BatchExportNode[]): BatchExportItem[] {
    const media = nodes.filter(isBatchExportable);
    const ordered = sortForExport(media, (node) => node.position);
    return ordered.map((node, index) => ({
        id: node.id,
        title: node.title,
        url: node.metadata?.content ?? "",
        fileName: buildExportFileName({
            title: node.title,
            index: index + 1,
            total: ordered.length,
            ext: batchExportExtension(node),
        }),
    }));
}

/**
 * 逐个取字节，单个失败不影响整批。
 *
 * 跨域图片直接 `fetch` 会因 CORS 失败，这里不绕过——绕过意味着把用户的图先代理
 * 到第三方，代价比失败大。失败的条目进 `failed` 由调用方如实汇报。
 */
export async function collectBatchExportFiles(items: readonly BatchExportItem[], read: (url: string) => Promise<Blob>) {
    const settled = await Promise.all(
        items.map(async (item) => {
            try {
                return { ok: true as const, file: { name: item.fileName, data: await read(item.url) } };
            } catch (error) {
                return { ok: false as const, failure: { fileName: item.fileName, reason: error instanceof Error ? error.message : String(error) } };
            }
        }),
    );

    return {
        files: settled.flatMap((item) => (item.ok ? [item.file] : [])),
        failed: settled.flatMap((item): BatchExportFailure[] => (item.ok ? [] : [item.failure])),
    };
}
