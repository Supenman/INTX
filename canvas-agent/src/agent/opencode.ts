import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AGENT_PROMPT } from "../config.js";
import { logger } from "../utils/logger.js";
import { errorMessage } from "../utils/value.js";
import { DEFAULT_OPENCODE_MODEL, parseOpencodeModelList, resolveOpencodeModel, type OpencodeModelList } from "./opencode-models.js";
import { createOpencodeMapperState, failOpencodeTurn, finishOpencodeTurn, mapOpencodeEvent, markOpencodeInterrupted, type OpencodeAgentEvent, type OpencodeMapperState } from "./opencode-events.js";
import type { AgentEmit } from "./types.js";

/** opencode 版本固定，避免每次拉 latest 导致行为漂移。 */
const OPENCODE_VERSION = "1.19.5";
export { DEFAULT_OPENCODE_MODEL } from "./opencode-models.js";

type OpencodeServer = { base: string; child: ChildProcess; cwd: string };

let server: OpencodeServer | null = null;
let serverStarting: Promise<OpencodeServer> | null = null;
let active: { base: string; sessionId: string; state: OpencodeMapperState; controller: AbortController } | null = null;
/** 同一时刻只跑一轮，避免两个网页交叉写同一个会话。 */
let queue: Promise<void> = Promise.resolve();

export function opencodeBusy() {
    return Boolean(active);
}

/** 新建 opencode 会话，返回的 session id 直接作为线程 id。 */
export async function createOpencodeThread(cwd: string) {
    const { base } = await ensureServer(cwd);
    const response = await fetch(`${base}/session`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const data = (await response.json().catch(() => ({}))) as { id?: string };
    if (!response.ok || !data.id) throw new Error(`创建 opencode 会话失败：${response.status}`);
    return data.id;
}

/** 列出 opencode 会话，按最近活动排序交给侧边栏。 */
export async function listOpencodeThreads(cwd: string) {
    const { base } = await ensureServer(cwd);
    const response = await fetch(`${base}/session`);
    const data = (await response.json().catch(() => [])) as Array<{ id?: string; title?: string; time?: { created?: number; updated?: number } }>;
    if (!Array.isArray(data)) return [];
    return data
        .filter((item) => item.id)
        .map((item) => ({
            id: String(item.id),
            preview: String(item.title || ""),
            name: String(item.title || ""),
            createdAt: item.time?.created || 0,
            updatedAt: item.time?.updated || item.time?.created || 0,
        }))
        .sort((left, right) => right.updatedAt - left.updatedAt);
}

/** 读取一个 opencode 会话的历史消息，归一成侧边栏的 chat item。 */
export async function readOpencodeThread(cwd: string, threadId: string) {
    const { base } = await ensureServer(cwd);
    const response = await fetch(`${base}/session/${encodeURIComponent(threadId)}/message`);
    if (!response.ok) throw new Error(`读取 opencode 会话失败：${response.status}`);
    const entries = (await response.json().catch(() => [])) as Array<{ info?: Record<string, unknown>; parts?: Array<Record<string, unknown>> }>;
    return Array.isArray(entries) ? historyItems(threadId, entries) : [];
}

/** 删除一个 opencode 会话。 */
export async function deleteOpencodeThread(cwd: string, threadId: string) {
    const { base } = await ensureServer(cwd);
    const response = await fetch(`${base}/session/${encodeURIComponent(threadId)}`, { method: "DELETE" });
    if (!response.ok) throw new Error(`删除 opencode 会话失败：${response.status}`);
}

/** 重命名 opencode 会话（opencode 的 PATCH /session/{id} 接受 title）。 */
export async function renameOpencodeThread(cwd: string, threadId: string, title: string) {
    const { base } = await ensureServer(cwd);
    const response = await fetch(`${base}/session/${encodeURIComponent(threadId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title }),
    });
    if (!response.ok) throw new Error(`重命名 opencode 会话失败：${response.status}`);
}

const value = (input: unknown) => (typeof input === "string" ? input : "");

/** 历史快照沿用实时事件的 item / turn 归属：turn = 用户消息 id。 */
function historyItems(threadId: string, entries: Array<{ info?: Record<string, unknown>; parts?: Array<Record<string, unknown>> }>) {
    const items: Array<Record<string, unknown>> = [];
    for (const entry of entries) {
        const info = entry.info || {};
        const parts = Array.isArray(entry.parts) ? entry.parts : [];
        if (info.role === "user") {
            const text = parts.filter((part) => part.type === "text" && part.synthetic !== true).map((part) => value(part.text)).filter(Boolean).join("\n");
            if (text) items.push({ itemId: "synthetic:user", threadId, turnId: value(info.id), role: "user", text });
            continue;
        }
        if (info.role !== "assistant") continue;
        const turnId = value(info.parentID);
        for (const part of parts) {
            const partId = value(part.id);
            if (!partId) continue;
            if (part.type === "text" && part.synthetic !== true && part.ignored !== true && value(part.text)) {
                items.push({ itemId: `opencode-${partId}`, threadId, turnId, role: "assistant", title: "opencode", text: value(part.text) });
            }
            if (part.type === "tool") {
                const state = (part.state || {}) as Record<string, unknown>;
                if (state.status !== "completed" && state.status !== "error") continue;
                items.push({ itemId: `opencode-${partId}`, threadId, turnId, role: "tool", title: value(part.tool), text: state.status === "error" ? value(state.error) : value(state.output) });
            }
        }
    }
    return items;
}

/** 读取 opencode 当前可用模型；服务或接口异常时返回空列表，由前端提示不可用并回退默认模型。 */
export async function listOpencodeModels(cwd: string): Promise<OpencodeModelList> {
    try {
        const { base } = await ensureServer(cwd);
        const response = await fetch(`${base}/config/providers`);
        if (!response.ok) throw new Error(`读取 opencode 模型列表失败：${response.status}`);
        return parseOpencodeModelList(await response.json().catch(() => ({})));
    } catch (error) {
        logger.warn("Failed to list opencode models", { error });
        return { models: [], defaultId: "" };
    }
}

/** 只接受当前列表里的模型 id；未选择或列表异常都回退固定免费模型，绝不把任意字符串交给 opencode。 */
async function turnModel(base: string, requested: string | undefined) {
    if (!requested) return { ...DEFAULT_OPENCODE_MODEL };
    try {
        const response = await fetch(`${base}/config/providers`);
        if (!response.ok) throw new Error(`读取 opencode 模型列表失败：${response.status}`);
        return resolveOpencodeModel(requested, parseOpencodeModelList(await response.json().catch(() => ({}))));
    } catch (error) {
        logger.warn("Failed to resolve opencode model, fallback to default", { requested, error });
        return { ...DEFAULT_OPENCODE_MODEL };
    }
}

/** 跑一轮对话；事件经 SSE 归一后由 emit 广播到侧边栏。 */
export async function runOpencodeTurn(prompt: string, emit: AgentEmit, options: { threadId: string; cwd: string; model?: string }) {
    if (!prompt.trim()) return;
    queue = queue.catch(() => undefined).then(() => runTurnNow(prompt, emit, options));
    await queue;
}

/** 停止当前轮；opencode 侧用 abort 接口收尾。 */
export async function interruptOpencodeTurn() {
    if (!active) return false;
    const { base, sessionId, state } = active;
    markOpencodeInterrupted(state);
    try {
        await fetch(`${base}/session/${sessionId}/abort`, { method: "POST" });
    } catch (error) {
        logger.warn("Failed to abort opencode session", { error });
    }
    active.controller.abort();
    return true;
}

async function runTurnNow(prompt: string, emit: AgentEmit, options: { threadId: string; cwd: string; model?: string }) {
    const turnId = `opencode-turn-${Date.now().toString(36)}`;
    const state = createOpencodeMapperState(turnId, options.threadId);
    const controller = new AbortController();
    const emitEvent = (event: OpencodeAgentEvent) => emit("agent_event", { ...event, agent: "opencode", threadId: options.threadId, turnId: state.turnId });
    let stream: Promise<void> | null = null;
    try {
        const { base } = await ensureServer(options.cwd);
        active = { base, sessionId: options.threadId, state, controller };
        emitEvent({ type: "thread.started", thread_id: options.threadId });
        let connected!: () => void;
        const ready = new Promise<void>((resolve) => { connected = resolve; });
        stream = readEvents(base, state, controller.signal, emitEvent, connected);
        stream.catch(() => undefined);
        // 连上 /event 再发消息；订阅先失败就按本轮失败收尾，不会悬在等连接上。
        await Promise.race([ready, stream]);
        const model = await turnModel(base, options.model);
        const response = await fetch(`${base}/session/${options.threadId}/message`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ model, system: AGENT_PROMPT, parts: [{ type: "text", text: prompt }] }),
            signal: controller.signal,
        });
        if (!response.ok) throw new Error(`opencode 请求失败：${response.status} ${(await response.text()).slice(0, 300)}`);
        await response.arrayBuffer();
        await stream;
    } catch (error) {
        if (!controller.signal.aborted) failOpencodeTurn(state, errorMessage(error)).forEach(emitEvent);
    } finally {
        for (const event of finishOpencodeTurn(state)) emitEvent(event);
        controller.abort();
        await stream?.catch(() => undefined);
        active = null;
    }
}

/** 订阅 /event，只把本会话的事件交给 mapper；turn 结束或出错时自行收流。 */
async function readEvents(base: string, state: OpencodeMapperState, signal: AbortSignal, forward: (event: OpencodeAgentEvent) => void, connected: () => void) {
    const response = await fetch(`${base}/event`, { signal, headers: { accept: "text/event-stream" } });
    if (!response.ok || !response.body) throw new Error(`订阅 opencode 事件失败：${response.status}`);
    connected();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) return;
            buffer += decoder.decode(value, { stream: true });
            let index: number;
            while ((index = buffer.indexOf("\n\n")) >= 0) {
                const chunk = buffer.slice(0, index);
                buffer = buffer.slice(index + 2);
                const data = chunk.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
                if (!data) continue;
                let event: unknown;
                try { event = JSON.parse(data); } catch { continue; }
                for (const mapped of mapOpencodeEvent(event, state)) forward(mapped);
                if (state.finished) return;
            }
        }
    } finally {
        void reader.cancel().catch(() => undefined);
    }
}

/** 启动并复用一个本地 opencode 服务；同一个工作空间只起一个。 */
async function ensureServer(cwd: string): Promise<OpencodeServer> {
    if (server?.cwd === cwd && server.child.exitCode === null) return server;
    if (server) {
        server.child.kill();
        server = null;
    }
    if (!serverStarting) serverStarting = startServer(cwd).finally(() => { serverStarting = null; });
    return serverStarting;
}

async function startServer(cwd: string): Promise<OpencodeServer> {
    const command = `${process.env.OPENCODE_BIN || `npx -y opencode-ai@${OPENCODE_VERSION}`} serve --port 0 --hostname 127.0.0.1`;
    const child = spawn(command, {
        cwd,
        shell: true,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify(canvasConfig()) },
    });
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-2000); });
    const base = await new Promise<string>((resolve, reject) => {
        child.stdout?.setEncoding("utf8");
        child.stdout?.on("data", (chunk: string) => {
            const match = chunk.match(/listening on (http:\/\/\S+)/);
            if (match) resolve(match[1]);
        });
        child.once("error", reject);
        child.once("exit", (code) => reject(new Error(`opencode 服务启动失败（退出码 ${code}）${stderr.trim() ? `：${stderr.trim()}` : ""}`)));
    });
    child.once("exit", () => { if (server?.child === child) server = null; });
    // 进程退出时一并结束 opencode 子进程，避免留下孤儿服务。
    process.once("exit", () => {
        if (process.platform === "win32" && child.pid) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        else child.kill();
    });
    logger.info("opencode server started", { base, cwd });
    server = { base, child, cwd };
    return server;
}

/** 让 opencode 连回本进程的 MCP；源码/未构建时返回空配置，不阻断纯对话。 */
function canvasConfig() {
    const entry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "index.js");
    if (!fs.existsSync(entry)) return {};
    return { mcp: { "infinite-canvas": { type: "local", command: [process.execPath, entry, "mcp"], enabled: true } } };
}
