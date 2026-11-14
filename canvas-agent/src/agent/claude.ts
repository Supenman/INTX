import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { query, type Query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import { AGENT_PROMPT, ensureSiteWorkspace, loadConfig } from "../config.js";
import { logger } from "../utils/logger.js";
import { errorMessage } from "../utils/value.js";
import { createClaudeMapperState, mapClaudeMessage } from "./claude-events.js";
import type { AgentEmit } from "./types.js";

/**
 * Claude Agent SDK Adapter。
 *
 * 取代原来的 `claude -p --output-format stream-json` 包装：会话由 SDK 的 resume 续用，
 * 事件经 claude-events 归一成侧边栏的 item / turn 词汇，工具调用带 id、入参和结果。
 * 同一时刻只跑一轮，避免两个窗口交叉写同一个会话。
 */
export type ClaudeRunOptions = { threadId?: string; cwd?: string };

let claudeQueue: Promise<void> = Promise.resolve();
let active: { query: Query; threadId: string } | null = null;
/** 网页线程 → SDK 会话 id；续用会话只认上一次 init 返回的 id。 */
const sessions = new Map<string, string>();

export function claudeSessionId(threadId: string) {
    return sessions.get(threadId) || "";
}

export async function runClaudeTurn(prompt: string, emit: AgentEmit, options: ClaudeRunOptions = {}) {
    if (!prompt.trim()) return;
    claudeQueue = claudeQueue.catch(() => undefined).then(() => runClaudeTurnNow(prompt, emit, options));
    await claudeQueue;
}

export async function interruptClaudeTurn() {
    if (!active) return false;
    try {
        await active.query.interrupt();
        return true;
    } catch (error) {
        logger.warn("Failed to interrupt Claude turn", { error });
        return false;
    }
}

async function runClaudeTurnNow(prompt: string, emit: AgentEmit, options: ClaudeRunOptions) {
    const threadId = options.threadId?.trim() || "";
    const sessionId = threadId ? sessions.get(threadId) : undefined;
    const turnId = `claude-turn-${Date.now().toString(36)}`;
    const state = createClaudeMapperState(turnId);
    const controller = new AbortController();
    const scope = () => ({ agent: "claude", threadId: state.sessionId || threadId, turnId });
    let code = 0;
    try {
        const q = query({
            prompt: withAgentPrompt(prompt),
            options: {
                cwd: options.cwd || ensureSiteWorkspace(loadConfig(true)).workspacePath,
                ...(sessionId ? { resume: sessionId } : {}),
                includePartialMessages: true,
                allowedTools: ["mcp__infinite-canvas__*"],
                ...(canvasMcpServers() ? { mcpServers: canvasMcpServers() } : {}),
                abortController: controller,
            },
        });
        active = { query: q, threadId };
        for await (const message of q as AsyncIterable<SDKMessage>) {
            for (const event of mapClaudeMessage(message, state)) emit("agent_event", { ...scope(), ...event });
        }
    } catch (error) {
        code = 1;
        emit("agent_error", { ...scope(), message: errorMessage(error) });
    } finally {
        active = null;
        if (threadId && state.sessionId) sessions.set(threadId, state.sessionId);
        emit("agent_done", { ...scope(), code });
    }
}

/** 为 Claude 请求拼接 Canvas Agent 指令。 */
function withAgentPrompt(prompt: string) {
    return prompt.trim() ? `${AGENT_PROMPT}\n\n用户请求：${prompt}` : "";
}

/** 让 Claude 连回本进程的 MCP；源码/未构建时返回 undefined，不阻断纯对话。 */
function canvasMcpServers() {
    const entry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "index.js");
    if (!fs.existsSync(entry)) return undefined;
    return { "infinite-canvas": { type: "stdio" as const, command: process.execPath, args: [entry, "mcp"] } };
}
