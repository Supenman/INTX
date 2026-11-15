import { describe, expect, it } from "vitest";

import type { AgentPendingToolCall } from "@/stores/use-agent-store";
import { dequeuePendingTool, enqueuePendingTool, findPendingTool, hasPendingTool } from "./pending-tool-queue";

function call(requestId: string, name = "canvas_apply_ops"): AgentPendingToolCall {
    return { requestId, name };
}

const ids = (queue: readonly AgentPendingToolCall[]) => queue.map((item) => item.requestId);

describe("待确认工具 FIFO 队列", () => {
    it("空队列入队后只产生一个待确认项，且不修改原数组", () => {
        const empty: AgentPendingToolCall[] = [];
        const next = enqueuePendingTool(empty, call("r1"));
        expect(ids(next)).toEqual(["r1"]);
        expect(empty).toEqual([]);
        expect(next).not.toBe(empty);
    });

    it("多个写工具按到达顺序全部保留，不再拒绝或覆盖后一个", () => {
        let queue: AgentPendingToolCall[] = [];
        for (const id of ["r1", "r2", "r3"]) queue = enqueuePendingTool(queue, call(id));
        expect(ids(queue)).toEqual(["r1", "r2", "r3"]);
    });

    it("同一 requestId 重放只入队一次，保留先到的请求内容", () => {
        const first = { requestId: "r1", name: "canvas_apply_ops", input: { ops: [{ type: "noop" }] } } as unknown as AgentPendingToolCall;
        const replay = call("r1", "canvas_create_attachment_nodes");
        const queue = enqueuePendingTool([first], replay);
        expect(queue).toHaveLength(1);
        expect(queue[0]).toBe(first);
        expect(hasPendingTool(queue, "r1")).toBe(true);
    });

    it("缺少 requestId 的请求不入队，避免留下无法回传结果的卡片", () => {
        const queue = [call("r1")];
        expect(enqueuePendingTool(queue, call(""))).toEqual(queue);
        expect(hasPendingTool(queue, "")).toBe(false);
        expect(findPendingTool(queue, "")).toBeUndefined();
    });

    it("按 requestId 查找能取回原始 payload", () => {
        const queue = [call("r1"), call("r2", "site_navigate")];
        expect(findPendingTool(queue, "r2")).toBe(queue[1]);
        expect(findPendingTool(queue, "missing")).toBeUndefined();
    });

    it("批准队首后只移除队首，其余保持原顺序", () => {
        const queue = [call("r1"), call("r2"), call("r3")];
        expect(ids(dequeuePendingTool(queue, "r1"))).toEqual(["r2", "r3"]);
    });

    it("可以精确移除非队首的失效请求，不连带丢掉其它待确认项", () => {
        const queue = [call("r1"), call("r2"), call("r3")];
        expect(ids(dequeuePendingTool(queue, "r2"))).toEqual(["r1", "r3"]);
        expect(ids(queue)).toEqual(["r1", "r2", "r3"]);
    });

    it("移除不存在的 id 或空 id 时队列保持不变，但仍返回新数组", () => {
        const queue = [call("r1")];
        const next = dequeuePendingTool(queue, "missing");
        expect(next).toEqual(queue);
        expect(next).not.toBe(queue);
        expect(dequeuePendingTool(queue, "")).toEqual(queue);
    });

    it("并发场景：逐个处理后队列清空，被清掉的 id 允许后续重新入队", () => {
        let queue: AgentPendingToolCall[] = [];
        for (const id of ["r1", "r2", "r3"]) queue = enqueuePendingTool(queue, call(id));
        queue = dequeuePendingTool(queue, "r2");
        queue = dequeuePendingTool(queue, "r1");
        expect(ids(queue)).toEqual(["r3"]);
        expect(findPendingTool(queue, "r3")).toBeDefined();
        queue = dequeuePendingTool(queue, "r3");
        expect(queue).toEqual([]);
        expect(ids(enqueuePendingTool(queue, call("r1")))).toEqual(["r1"]);
    });
});
