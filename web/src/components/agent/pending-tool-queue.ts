import type { AgentPendingToolCall } from "@/stores/use-agent-store";

/**
 * 待确认画布工具的 FIFO 队列。纯函数：不碰 store、网络或 React，方便单测覆盖并发顺序。
 *
 * 旧实现是单槽：第一个写工具等待确认时，后一个会被 `pendingCanvasTool` 直接拒绝。
 * 改成队列后，同一轮里的多个写工具按到达顺序全部保留，用户可逐个批准或拒绝；
 * 处理时按 requestId 精确出队，因此不必强制从队首开始，也不会误伤其它请求。
 */
export type PendingToolQueue = readonly AgentPendingToolCall[];

/** 同一 requestId 只入队一次：队列里仍挂着该请求时，重复事件不会堆出重复卡片。 */
export function hasPendingTool(queue: PendingToolQueue, requestId: string): boolean {
    return Boolean(requestId) && queue.some((item) => item.requestId === requestId);
}

export function findPendingTool(queue: PendingToolQueue, requestId: string): AgentPendingToolCall | undefined {
    return requestId ? queue.find((item) => item.requestId === requestId) : undefined;
}

/** 缺少 requestId 的请求无法回传结果，直接丢弃；调用方负责给后端回一个错误。 */
export function enqueuePendingTool(queue: PendingToolQueue, call: AgentPendingToolCall): AgentPendingToolCall[] {
    if (!call.requestId || hasPendingTool(queue, call.requestId)) return [...queue];
    return [...queue, call];
}

/** 按 requestId 精确移除，允许丢弃非队首的失效请求；不存在的 id 保持队列不变。 */
export function dequeuePendingTool(queue: PendingToolQueue, requestId: string): AgentPendingToolCall[] {
    return requestId ? queue.filter((item) => item.requestId !== requestId) : [...queue];
}
