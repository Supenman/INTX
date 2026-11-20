import type { CanvasNodeData } from "../../types/canvas";
import type { Timeline } from "./model";
import { fromLegacyNodes } from "./model";

export const DEFAULT_TIMELINE_FPS = 24;

/**
 * 取项目时间线：已有则直接用；旧项目没有则从节点的 timeline* 字段派生。
 *
 * 派生是只读的——不在加载时写回存储，避免迁移失败覆盖用户原数据。
 * 只有用户真正编辑时间线时才由调用方写回 project.timeline。
 */
export function resolveTimeline(
  nodes: readonly CanvasNodeData[],
  stored: Timeline | undefined,
  fps: number = DEFAULT_TIMELINE_FPS,
): Timeline {
  return stored ?? fromLegacyNodes(nodes, fps);
}

/** 按 nodeId 建索引，供时间线从 clip 反查画布素材。 */
export function nodesById(nodes: readonly CanvasNodeData[]): Map<string, CanvasNodeData> {
  return new Map(nodes.map((node) => [node.id, node]));
}
