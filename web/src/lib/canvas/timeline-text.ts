import type { CanvasNodeData } from "@/types/canvas";
import { clipsAtSeconds, type ResolvedClip } from "@/domain/timeline/view";

/**
 * 文字节点主文本：优先整体 content，其次第一个文本块。空字符串不烧进画面。
 * 导出烧字与时间线预览共用此函数，保证「看到的字幕」与「导出的字幕」同源。
 */
export function textOf(node: CanvasNodeData): string {
    const content = node.metadata?.content?.trim();
    if (content) return content;
    return node.metadata?.texts?.map((item) => item.content?.trim()).find(Boolean) ?? "";
}

/**
 * 当前时刻命中的字幕文本列表（导出与预览共用的唯一判定入口）。
 * 只看文字轨 clip 的命中，与视频轨无关——空档处也照样烧字，和导出语义一致。
 */
export function activeTextOverlays(textShots: readonly ResolvedClip[], time: number): { text: string }[] {
    return clipsAtSeconds(textShots, time)
        .map((item) => item.node)
        .filter((node): node is CanvasNodeData => Boolean(node))
        .map((node) => ({ text: textOf(node) }))
        .filter((item) => Boolean(item.text));
}
