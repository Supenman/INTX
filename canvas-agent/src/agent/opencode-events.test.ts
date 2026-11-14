import assert from "node:assert/strict";
import test from "node:test";

import { createOpencodeMapperState, finishOpencodeTurn, mapOpencodeEvent, markOpencodeInterrupted } from "./opencode-events.js";

const SESSION = "ses_1";

function createState(turnId = "turn-1") {
    return createOpencodeMapperState(turnId, SESSION);
}

/** 按真实 /event 推送的形状构造事件：part 每次带完整快照。 */
function part(type: string, fields: Record<string, unknown>, id = "prt_1", messageID = "msg_assistant") {
    return { type: "message.part.updated", properties: { sessionID: SESSION, part: { id, messageID, sessionID: SESSION, type, ...fields }, time: 1 } };
}

const userMessage = { type: "message.updated", properties: { sessionID: SESSION, info: { id: "msg_user", role: "user", sessionID: SESSION } } };

function run(events: unknown[], state = createState()) {
    return { events: events.flatMap((event) => mapOpencodeEvent(event, state)), state };
}

test("助手文本按 part 快照转成增量，idle 时收尾并带用量", () => {
    const state = createState();
    const first = run([userMessage, part("text", { text: "你好" })], state);
    assert.deepEqual(first.events[0], { type: "turn.started", turn_id: "msg_user" });
    assert.deepEqual(first.events.slice(1), [
        { type: "item.started", item: { id: "opencode-prt_1", type: "agent_message", text: "" } },
        { type: "item.updated", item: { id: "opencode-prt_1", type: "agent_message", delta: "你好" } },
    ]);

    const second = run([part("text", { text: "你好，世界" })], state);
    assert.deepEqual(second.events, [{ type: "item.updated", item: { id: "opencode-prt_1", type: "agent_message", delta: "，世界" } }]);

    const done = run([
        { type: "message.updated", properties: { sessionID: SESSION, info: { id: "msg_assistant", role: "assistant", cost: 0, tokens: { input: 12, output: 7, cache: { read: 30, write: 0 } }, time: { created: 1, completed: 2 } } } },
        { type: "session.idle", properties: { sessionID: SESSION } },
    ], state);
    assert.deepEqual(done.events[0], { type: "usage.updated", usage: { input_tokens: 12, cached_input_tokens: 30, output_tokens: 7 } });
    assert.deepEqual(done.events[1], { type: "item.completed", item: { id: "opencode-prt_1", type: "agent_message", text: "你好，世界" } });
    assert.equal(done.events[2].type, "turn.completed");
    assert.equal(done.events[2].turn_id, "msg_user");
    assert.equal(done.events[2].status, "completed");
    assert.deepEqual(done.events[2].usage, { input_tokens: 12, cached_input_tokens: 30, output_tokens: 7 });
});

test("用户消息只开一轮，part 不回显到助手侧", () => {
    const { events } = run([userMessage, part("text", { text: "调用 echo" }, "prt_user", "msg_user"), userMessage]);
    assert.deepEqual(events, [{ type: "turn.started", turn_id: "msg_user" }]);
});

test("工具调用带 id、入参和结果", () => {
    const { events } = run([
        part("tool", { tool: "infinite-canvas_list_nodes", callID: "call-1", state: { status: "running", input: { limit: 3 }, time: { start: 1 } } }, "prt_tool"),
        part("tool", { tool: "infinite-canvas_list_nodes", callID: "call-1", state: { status: "completed", input: { limit: 3 }, output: "3 个节点", title: "", metadata: {}, time: { start: 1, end: 2 } } }, "prt_tool"),
    ]);
    assert.deepEqual(events, [
        { type: "item.started", item: { id: "opencode-prt_tool", type: "mcp_tool_call", tool: "infinite-canvas_list_nodes", arguments: { limit: 3 } } },
        { type: "item.completed", item: { id: "opencode-prt_tool", type: "mcp_tool_call", tool: "infinite-canvas_list_nodes", result: "3 个节点" } },
    ]);
});

test("工具失败把 error 原文交给侧边栏", () => {
    const { events } = run([part("tool", { tool: "infinite-canvas_add_node", callID: "call-2", state: { status: "error", input: {}, error: "画布连接已断开", time: { start: 1, end: 2 } } }, "prt_bad")]);
    assert.deepEqual(events, [{ type: "item.completed", item: { id: "opencode-prt_bad", type: "mcp_tool_call", tool: "infinite-canvas_add_node", error: { message: "画布连接已断开" } } }]);
});

test("session.error 收成 turn.completed failed，并保留错误原文", () => {
    const { events } = run([
        part("text", { text: "半句" }),
        { type: "session.error", properties: { sessionID: SESSION, error: { name: "ProviderAuthError", data: { providerID: "opencode", message: "免费额度已用完" } } } },
    ]);
    assert.deepEqual(events.at(-2), { type: "item.completed", item: { id: "opencode-prt_1", type: "agent_message", text: "半句" } });
    assert.deepEqual(events.at(-1), { type: "turn.completed", turn_id: "turn-1", status: "failed", error: { message: "免费额度已用完" } });
});

test("用户停止后按已停止收尾，不报失败", () => {
    const state = createState();
    run([part("text", { text: "写到一半" })], state);
    markOpencodeInterrupted(state);
    const events = finishOpencodeTurn(state);
    assert.deepEqual(events.at(-1), { type: "turn.completed", turn_id: "turn-1", status: "interrupted" });
});

test("别的会话和其它事件不影响本轮", () => {
    const { events, state } = run([
        { type: "message.part.updated", properties: { sessionID: "ses_other", part: { id: "prt_x", messageID: "msg_x", type: "text", text: "别人的" } } },
        { type: "server.heartbeat", properties: {} },
        { type: "message.part.delta", properties: { sessionID: SESSION, messageID: "msg_assistant", partID: "prt_1", field: "text", delta: "重复" } },
    ]);
    assert.deepEqual(events, []);
    assert.equal(state.items.size, 0);
});
