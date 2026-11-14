/**
 * Claude Agent SDK 消息 → 侧边栏统一事件。
 *
 * 侧边栏只认一套 item / turn 词汇（沿用 Codex app-server 的形状），
 * 所以这里把 SDK 的 assistant / stream_event / tool_result / result 归一过去。
 * 本文件不 import SDK，入参按结构读取，便于单测。
 */

export type ClaudeAgentEvent = { type: string } & Record<string, unknown>;

export type ClaudeMapperState = {
    sessionId: string;
    turnId: string;
    started: boolean;
    announced: boolean;
    messageItemId: string;
    messageText: string;
    messageCompleted: boolean;
    streamed: boolean;
    tools: Map<string, { itemId: string; tool: string }>;
};

export function createClaudeMapperState(turnId: string): ClaudeMapperState {
    return { sessionId: "", turnId, started: false, announced: false, messageItemId: "", messageText: "", messageCompleted: false, streamed: false, tools: new Map() };
}

type Block = Record<string, unknown>;

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" ? value : "");
const blocks = (value: unknown): Block[] => (Array.isArray(value) ? value.filter(record) : []);

/** 把一条 SDK 消息转换成零到多条统一事件。 */
export function mapClaudeMessage(message: unknown, state: ClaudeMapperState): ClaudeAgentEvent[] {
    if (!record(message)) return [];
    if (message.type === "system") return mapSystem(message, state);
    if (message.type === "assistant") return mapAssistant(message, state);
    if (message.type === "stream_event") return mapStreamEvent(message, state);
    if (message.type === "user") return mapToolResults(message, state);
    if (message.type === "result") return mapResult(message, state);
    return [];
}

function mapSystem(message: Record<string, unknown>, state: ClaudeMapperState): ClaudeAgentEvent[] {
    if (message.subtype !== "init") return [];
    state.sessionId = text(message.session_id) || state.sessionId;
    if (!state.sessionId || state.announced) return [];
    state.announced = true;
    return [{ type: "thread.started", thread_id: state.sessionId, agent: "claude" }];
}

function ensureTurn(state: ClaudeMapperState): ClaudeAgentEvent[] {
    if (state.started) return [];
    state.started = true;
    return [{ type: "turn.started", turn_id: state.turnId }];
}

function ensureMessageItem(state: ClaudeMapperState, message: Record<string, unknown>): ClaudeAgentEvent[] {
    if (!state.messageItemId) state.messageItemId = `claude-message-${text(message.uuid) || state.turnId}`;
    if (state.messageText || state.streamed) return [];
    return [{ type: "item.started", item: { id: state.messageItemId, type: "agent_message", text: "" } }];
}

function appendText(state: ClaudeMapperState, delta: string): ClaudeAgentEvent[] {
    if (!delta) return [];
    state.messageText += delta;
    state.streamed = true;
    return [{ type: "item.updated", item: { id: state.messageItemId, type: "agent_message", delta } }];
}

function mapAssistant(message: Record<string, unknown>, state: ClaudeMapperState): ClaudeAgentEvent[] {
    const inner = record(message.message) ? message.message : {};
    const content = blocks(inner.content);
    const out = [...ensureTurn(state)];
    for (const block of content) {
        if (block.type === "text") {
            out.push(...ensureMessageItem(state, message));
            // 流式增量已经发过时，这里只补最终文本，避免重复计数。
            const full = text(block.text);
            if (!state.streamed && full) {
                state.messageText = full;
                out.push({ type: "item.updated", item: { id: state.messageItemId, type: "agent_message", delta: full } });
            }
            if (inner.stop_reason !== null && inner.stop_reason !== undefined && !state.messageCompleted) {
                state.messageCompleted = true;
                out.push({ type: "item.completed", item: { id: state.messageItemId, type: "agent_message", text: state.messageText } });
            }
            continue;
        }
        if (block.type === "thinking") {
            out.push({ type: "item.completed", item: { id: `claude-thinking-${text(block.signature).slice(-8) || text(message.uuid)}`, type: "reasoning", text: text(block.thinking) } });
            continue;
        }
        if (block.type === "tool_use") {
            const toolUseId = text(block.id);
            const itemId = `claude-tool-${toolUseId || state.tools.size}`;
            const tool = text(block.name);
            state.tools.set(toolUseId, { itemId, tool });
            out.push({ type: "item.started", item: { id: itemId, type: "mcp_tool_call", tool, arguments: block.input ?? {} } });
        }
    }
    return out;
}

function mapStreamEvent(message: Record<string, unknown>, state: ClaudeMapperState): ClaudeAgentEvent[] {
    const event = record(message.event) ? message.event : null;
    if (!event || event.type !== "content_block_delta") return [];
    const delta = record(event.delta) ? event.delta : null;
    if (!delta || delta.type !== "text_delta") return [];
    const out = [...ensureTurn(state), ...ensureMessageItem(state, message)];
    out.push(...appendText(state, text(delta.text)));
    return out;
}

function mapToolResults(message: Record<string, unknown>, state: ClaudeMapperState): ClaudeAgentEvent[] {
    const content = record(message.message) ? blocks((message.message as Record<string, unknown>).content) : [];
    const out: ClaudeAgentEvent[] = [];
    for (const block of content) {
        if (block.type !== "tool_result") continue;
        const entry = state.tools.get(text(block.tool_use_id));
        if (!entry) continue;
        const failed = block.is_error === true;
        const output = toolResultText(block.content);
        out.push({
            type: "item.completed",
            item: { id: entry.itemId, type: "mcp_tool_call", tool: entry.tool, ...(failed ? { error: { message: output || "工具调用失败" } } : { result: output }) },
        });
    }
    return out;
}

function toolResultText(content: unknown) {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content.filter(record).map((block) => (block.type === "text" ? text(block.text) : "")).filter(Boolean).join("\n");
}

function mapResult(message: Record<string, unknown>, state: ClaudeMapperState): ClaudeAgentEvent[] {
    const out = [...ensureTurn(state)];
    if (state.messageItemId && !state.messageCompleted && state.messageText) {
        state.messageCompleted = true;
        out.push({ type: "item.completed", item: { id: state.messageItemId, type: "agent_message", text: state.messageText } });
    }
    if (message.subtype === "success" && message.is_error !== true) {
        const usage = record(message.usage) ? message.usage : {};
        const normalizedUsage = {
            input_tokens: numberField(usage.input_tokens),
            cached_input_tokens: numberField(usage.cache_read_input_tokens),
            output_tokens: numberField(usage.output_tokens),
        };
        out.push({ type: "usage.updated", usage: normalizedUsage });
        out.push({
            type: "turn.completed",
            turn_id: state.turnId,
            status: "completed",
            usage: normalizedUsage,
            total_cost_usd: numberField(message.total_cost_usd),
            duration_ms: numberField(message.duration_ms),
        });
        return out;
    }
    // 真实的错误 result 形如 { subtype: "success", is_error: true, result: "Not logged in · Please run /login" }，
    // 错误原因在 result 里，errors 数组只在少数场景出现。
    const errors = Array.isArray(message.errors) ? message.errors.filter((item): item is string => typeof item === "string") : [];
    out.push({ type: "turn.failed", turn_id: state.turnId, status: "failed", error: { message: text(message.result) || errors.join("；") || "Claude 执行失败" } });
    return out;
}

const numberField = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
