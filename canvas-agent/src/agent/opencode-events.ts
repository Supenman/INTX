/**
 * opencode 服务端事件 → 侧边栏统一事件。
 *
 * opencode `GET /event` 推的是整份快照（part 每次带完整文本），
 * 这里按 part 自身累计差分，归一成侧边栏认的 item / turn 词汇。
 * 本文件不 import 任何依赖，入参按结构读取，便于单测。
 */

export type OpencodeAgentEvent = { type: string } & Record<string, unknown>;

type ItemKind = "agent_message" | "reasoning" | "mcp_tool_call";
type Item = { id: string; type: ItemKind; text: string; tool: string; completed: boolean };

export type OpencodeMapperState = {
    turnId: string;
    sessionId: string;
    startedAt: number;
    userMessages: Set<string>;
    items: Map<string, Item>;
    usage: { input_tokens: number; cached_input_tokens: number; output_tokens: number } | null;
    cost: number;
    interrupted: boolean;
    finished: boolean;
};

export function createOpencodeMapperState(turnId: string, sessionId: string): OpencodeMapperState {
    return { turnId, sessionId, startedAt: Date.now(), userMessages: new Set(), items: new Map(), usage: null, cost: 0, interrupted: false, finished: false };
}

/** 用户点了停止：abort 触发的错误按「已停止」收尾，不报失败。 */
export function markOpencodeInterrupted(state: OpencodeMapperState) {
    state.interrupted = true;
}

type Block = Record<string, unknown>;

const record = (value: unknown): value is Block => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" ? value : "");
const numberField = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/** 把一条 opencode 事件转换成零到多条统一事件。 */
export function mapOpencodeEvent(event: unknown, state: OpencodeMapperState): OpencodeAgentEvent[] {
    if (!record(event)) return [];
    const properties = record(event.properties) ? event.properties : {};
    if (text(properties.sessionID) !== state.sessionId) return [];
    if (event.type === "message.updated") return mapMessage(properties, state);
    if (event.type === "message.part.updated") return mapPart(properties, state);
    if (event.type === "session.error") return mapError(properties, state);
    if (event.type === "session.idle") return finishOpencodeTurn(state);
    return [];
}

function mapMessage(properties: Block, state: OpencodeMapperState): OpencodeAgentEvent[] {
    const info = record(properties.info) ? properties.info : {};
    const id = text(info.id);
    if (info.role === "user") {
        if (!id || state.userMessages.has(id)) return [];
        state.userMessages.add(id);
        // 用用户消息 id 当 turn id：历史快照也用同一个 id，刷新后不会重复。
        state.turnId = id;
        return [{ type: "turn.started", turn_id: id }];
    }
    // 助手消息的 time.completed 出现时才是这一轮的用量，重复推送只取第一次。
    if (info.role !== "assistant" || state.usage) return [];
    const time = record(info.time) ? info.time : {};
    if (!numberField(time.completed)) return [];
    const tokens = record(info.tokens) ? info.tokens : {};
    const cache = record(tokens.cache) ? tokens.cache : {};
    state.usage = { input_tokens: numberField(tokens.input), cached_input_tokens: numberField(cache.read), output_tokens: numberField(tokens.output) };
    state.cost = numberField(info.cost);
    return [{ type: "usage.updated", usage: state.usage }];
}

function mapPart(properties: Block, state: OpencodeMapperState): OpencodeAgentEvent[] {
    const part = record(properties.part) ? properties.part : {};
    const partId = text(part.id);
    const messageId = text(part.messageID);
    if (!partId || !messageId || state.userMessages.has(messageId)) return [];
    if (part.type === "text") return appendText(state, partId, "agent_message", part.synthetic === true || part.ignored === true ? "" : text(part.text));
    if (part.type === "reasoning") return appendText(state, partId, "reasoning", text(part.text));
    if (part.type === "tool") return mapTool(state, partId, part);
    return [];
}

function appendText(state: OpencodeMapperState, partId: string, type: ItemKind, full: string): OpencodeAgentEvent[] {
    const itemId = `opencode-${partId}`;
    const current = state.items.get(partId);
    if (!current) {
        if (!full) return [];
        state.items.set(partId, { id: itemId, type, text: full, tool: "", completed: false });
        const out: OpencodeAgentEvent[] = [];
        if (type === "agent_message") out.push({ type: "item.started", item: { id: itemId, type, text: "" } });
        out.push({ type: "item.updated", item: { id: itemId, type, delta: full } });
        return out;
    }
    if (current.completed || !full.startsWith(current.text)) return [];
    const delta = full.slice(current.text.length);
    if (!delta) return [];
    current.text = full;
    return [{ type: "item.updated", item: { id: itemId, type, delta } }];
}

function mapTool(state: OpencodeMapperState, partId: string, part: Block): OpencodeAgentEvent[] {
    const tool = text(part.tool);
    const toolState = record(part.state) ? part.state : {};
    const status = text(toolState.status);
    const itemId = `opencode-${partId}`;
    const current = state.items.get(partId);
    if (status === "completed" || status === "error") {
        if (current?.completed) return [];
        state.items.set(partId, { id: itemId, type: "mcp_tool_call", text: "", tool, completed: true });
        const item = status === "error"
            ? { id: itemId, type: "mcp_tool_call", tool, error: { message: text(toolState.error) || "工具调用失败" } }
            : { id: itemId, type: "mcp_tool_call", tool, result: text(toolState.output) };
        return [{ type: "item.completed", item }];
    }
    if (current) return [];
    state.items.set(partId, { id: itemId, type: "mcp_tool_call", text: "", tool, completed: false });
    return [{ type: "item.started", item: { id: itemId, type: "mcp_tool_call", tool, arguments: record(toolState.input) ? toolState.input : {} } }];
}

function mapError(properties: Block, state: OpencodeMapperState): OpencodeAgentEvent[] {
    const error = record(properties.error) ? properties.error : {};
    const data = record(error.data) ? error.data : {};
    return failOpencodeTurn(state, text(data.message) || text(error.name) || "opencode 执行失败");
}

/** 失败收尾：补齐还开着的 item，再用 turn.completed 的 failed 状态交给侧边栏收尾。 */
export function failOpencodeTurn(state: OpencodeMapperState, message: string): OpencodeAgentEvent[] {
    if (state.finished) return [];
    state.finished = true;
    const items = finishItems(state);
    if (state.interrupted) return [...items, { type: "turn.completed", turn_id: state.turnId, status: "interrupted" }];
    return [...items, { type: "turn.completed", turn_id: state.turnId, status: "failed", error: { message } }];
}

/** 一轮结束：补齐还开着的 item，再发 turn.completed；重复调用只生效一次。 */
export function finishOpencodeTurn(state: OpencodeMapperState): OpencodeAgentEvent[] {
    if (state.finished) return [];
    state.finished = true;
    const items = finishItems(state);
    if (state.interrupted) return [...items, { type: "turn.completed", turn_id: state.turnId, status: "interrupted" }];
    const usage = state.usage || { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 };
    return [...items, { type: "turn.completed", turn_id: state.turnId, status: "completed", usage, total_cost_usd: state.cost, duration_ms: Date.now() - state.startedAt }];
}

function finishItems(state: OpencodeMapperState): OpencodeAgentEvent[] {
    const out: OpencodeAgentEvent[] = [];
    for (const item of state.items.values()) {
        if (item.completed || !item.text) continue;
        item.completed = true;
        if (item.type === "mcp_tool_call") continue;
        out.push({ type: "item.completed", item: { id: item.id, type: item.type, text: item.text } });
    }
    return out;
}
