import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createClaudeMapperState, mapClaudeMessage, type ClaudeAgentEvent } from "./claude-events.js";

const run = (messages: unknown[]) => {
    const state = createClaudeMapperState("turn-1");
    const events: ClaudeAgentEvent[] = [];
    for (const message of messages) events.push(...mapClaudeMessage(message, state));
    return { state, events };
};

const init = { type: "system", subtype: "init", session_id: "sess-1" };

describe("Claude 事件归一", () => {
    it("init 只产生一次 thread.started", () => {
        const { events } = run([init, { ...init }]);
        assert.deepEqual(events, [{ type: "thread.started", thread_id: "sess-1", agent: "claude" }]);
    });

    it("非流式 assistant 文本会补 started / updated / completed", () => {
        const { events } = run([
            init,
            { type: "assistant", uuid: "u1", message: { content: [{ type: "text", text: "先说一句" }], stop_reason: "end_turn" } },
        ]);
        assert.deepEqual(events.map((event) => event.type), ["thread.started", "turn.started", "item.started", "item.updated", "item.completed"]);
        const completed = events.at(-1) as { item: { type: string; text: string } };
        assert.equal(completed.item.type, "agent_message");
        assert.equal(completed.item.text, "先说一句");
    });

    it("流式增量只发一次，result 收尾不再重复正文", () => {
        const { events } = run([
            init,
            { type: "stream_event", uuid: "u1", event: { type: "content_block_delta", delta: { type: "text_delta", text: "你" } } },
            { type: "stream_event", uuid: "u1", event: { type: "content_block_delta", delta: { type: "text_delta", text: "好" } } },
            { type: "assistant", uuid: "u1", message: { content: [{ type: "text", text: "你好" }], stop_reason: null } },
            { type: "result", subtype: "success", is_error: false, usage: { input_tokens: 12, cache_read_input_tokens: 3, output_tokens: 4 }, total_cost_usd: 0.01, duration_ms: 900 },
        ]);
        const deltas = events.filter((event) => event.type === "item.updated").map((event) => (event.item as { delta: string }).delta);
        assert.deepEqual(deltas, ["你", "好"]);
        const completed = events.filter((event) => event.type === "item.completed");
        assert.equal(completed.length, 1);
        assert.equal((completed[0].item as { text: string }).text, "你好");
        const turn = events.at(-1) as { type: string; usage: Record<string, number>; status: string };
        assert.equal(turn.type, "turn.completed");
        assert.equal(turn.status, "completed");
        assert.deepEqual(turn.usage, { input_tokens: 12, cached_input_tokens: 3, output_tokens: 4 });
    });

    it("工具调用按 tool_use_id 配对成功结果", () => {
        const { events } = run([
            init,
            { type: "assistant", uuid: "u1", message: { content: [{ type: "tool_use", id: "tool-1", name: "mcp__infinite-canvas__canvas_get_state", input: { projectId: "p1" } }], stop_reason: "tool_use" } },
            { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tool-1", content: [{ type: "text", text: "{\"ok\":true}" }] }] } },
        ]);
        const started = events.find((event) => event.type === "item.started" && (event.item as { type: string }).type === "mcp_tool_call");
        assert.deepEqual((started?.item as Record<string, unknown>), { id: "claude-tool-tool-1", type: "mcp_tool_call", tool: "mcp__infinite-canvas__canvas_get_state", arguments: { projectId: "p1" } });
        const completed = events.at(-1) as { type: string; item: Record<string, unknown> };
        assert.equal(completed.type, "item.completed");
        assert.equal(completed.item.id, "claude-tool-tool-1");
        assert.equal(completed.item.result, "{\"ok\":true}");
        assert.equal(completed.item.error, undefined);
    });

    it("工具失败结果带 error，不混入 result", () => {
        const { events } = run([
            init,
            { type: "assistant", uuid: "u1", message: { content: [{ type: "tool_use", id: "tool-2", name: "mcp__infinite-canvas__canvas_apply_ops", input: {} }], stop_reason: "tool_use" } },
            { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tool-2", is_error: true, content: "画布未连接" }] } },
        ]);
        const completed = events.at(-1) as { item: Record<string, unknown> };
        assert.deepEqual(completed.item.error, { message: "画布未连接" });
        assert.equal(completed.item.result, undefined);
    });

    it("result 失败产生 turn.failed，并带上错误文本", () => {
        const { events } = run([init, { type: "result", subtype: "error_during_execution", is_error: true, errors: ["rate limited"] }]);
        assert.deepEqual(events.at(-1), { type: "turn.failed", turn_id: "turn-1", status: "failed", error: { message: "rate limited" } });
    });

    it("未配对的 tool_result 不凭空造事件", () => {
        const { events } = run([init, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "missing", content: "x" }] } }]);
        assert.equal(events.length, 1);
    });
});
