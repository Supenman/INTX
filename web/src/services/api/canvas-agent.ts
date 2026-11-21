import { invoke } from "@tauri-apps/api/core";

import i18n from "@/i18n";
import type { CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import type { AgentChatItem, AgentReasoningEffort, AgentThreadSummary } from "@/stores/use-agent-store";

const AGENT_MESSAGE_ASSET_PATTERN = /^agent-asset:([a-f0-9]{64})\/([a-f0-9]{64}\.(?:gif|jpe?g|png|webp))$/;

export class AgentApiError<T = unknown> extends Error {
    constructor(readonly status: number, readonly response: T & { code?: string; error?: string; msg?: string }) {
        super(response.error || response.msg || i18n.t("agent.state.requestFailed"));
        this.name = "AgentApiError";
    }
}

export type AgentSkillScope = "user" | "repo" | "system" | "admin";
export type AgentSkillInterface = { displayName?: string | null; shortDescription?: string | null; defaultPrompt?: string | null };
export type AgentSkillSummary = {
    name: string;
    description: string;
    shortDescription?: string | null;
    interface?: AgentSkillInterface | null;
    dependencies?: unknown;
    path: string;
    scope: AgentSkillScope;
    enabled: boolean;
    managed: boolean;
    revision: string;
};
export type AgentSkillDetail = {
    name: string;
    description: string;
    instructions: string;
    interface?: AgentSkillInterface | null;
    path: string;
    managed: true;
    revision: string;
};
export type AgentSkillInput = { name?: string; description: string; instructions: string; interface?: AgentSkillInterface | null; expectedRevision?: string };
export type AgentSkillDraft = { name: string; displayName: string; description: string; instructions: string; shortDescription: string; defaultPrompt: string };
export type AgentSkillDraftInput = { source: "conversation" | "canvas"; threadId: string; clientId: string; model?: string; effort?: AgentReasoningEffort };
export type AgentSkillsResponse = { ok?: boolean; data?: AgentSkillSummary[]; errors?: unknown[] };
export type AgentSkillResponse = { ok?: boolean; data?: AgentSkillDetail };
export type AgentSkillDraftResponse = { ok?: boolean; data?: AgentSkillDraft };

export async function postState(endpoint: string, token: string, clientId: string, snapshot: CanvasAgentSnapshot | null) {
    try {
        const response = await fetch(`${endpoint}/canvas/state?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientId)}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(snapshot ? { ...snapshot, hasCanvas: true } : { hasCanvas: false }),
        });
        return response.ok;
    } catch {
        return false;
    }
}

export async function activateAgentClient(endpoint: string, token: string, clientId: string) {
    try {
        await fetch(`${endpoint}/canvas/activate?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientId)}`, { method: "POST" });
    } catch {}
}

export async function postToolResult(endpoint: string, token: string, clientId: string, body: { requestId: string; result?: unknown; error?: string }) {
    await fetchAgentJson(endpoint, token, `/canvas/result?clientId=${encodeURIComponent(clientId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

export async function revealAgentLocalFile(endpoint: string, token: string, path: string) {
    await fetchAgentJson(endpoint, token, "/agent/local-file/reveal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }) });
}

export type OpencodeThreadsResponse = { ok?: boolean; workspace?: { workspacePath?: string }; data?: AgentThreadSummary[] };
export type OpencodeThreadResponse = { ok?: boolean; thread?: AgentThreadSummary; messages?: AgentChatItem[] };
export type OpencodeModelOption = { id: string; providerID: string; modelID: string; label: string };
export type OpencodeModelsResponse = { ok?: boolean; models?: OpencodeModelOption[]; defaultId?: string };

export function fetchOpencodeModels(endpoint: string, token: string) {
    return fetchAgentJson<OpencodeModelsResponse>(endpoint, token, "/agent/opencode/models");
}

export function fetchOpencodeSkills(endpoint: string, token: string) {
    return fetchAgentJson<AgentSkillsResponse>(endpoint, token, "/agent/opencode/skills");
}

export function fetchOpencodeSkill(endpoint: string, token: string, name: string) {
    return fetchAgentJson<AgentSkillResponse>(endpoint, token, `/agent/opencode/skills/${encodeURIComponent(name)}`);
}

export function createOpencodeSkill(endpoint: string, token: string, input: AgentSkillInput) {
    return fetchAgentJson<AgentSkillResponse>(endpoint, token, "/agent/opencode/skills", jsonPost(input));
}

export function updateOpencodeSkill(endpoint: string, token: string, name: string, input: AgentSkillInput) {
    return fetchAgentJson<AgentSkillResponse>(endpoint, token, `/agent/opencode/skills/${encodeURIComponent(name)}/update`, jsonPost(input));
}

export function deleteOpencodeSkill(endpoint: string, token: string, name: string, expectedRevision: string) {
    return fetchAgentJson<{ ok?: boolean }>(endpoint, token, `/agent/opencode/skills/${encodeURIComponent(name)}/delete`, jsonPost({ expectedRevision }));
}

export function fetchOpencodeThreads(endpoint: string, token: string) {
    return fetchAgentJson<OpencodeThreadsResponse>(endpoint, token, "/agent/opencode/threads");
}

export function createOpencodeThread(endpoint: string, token: string) {
    return fetchAgentJson<{ ok?: boolean; threadId?: string }>(endpoint, token, "/agent/opencode/threads/new", jsonPost({}));
}

export function fetchOpencodeThread(endpoint: string, token: string, threadId: string) {
    return fetchAgentJson<OpencodeThreadResponse>(endpoint, token, `/agent/opencode/threads/${encodeURIComponent(threadId)}`);
}

export function deleteOpencodeThread(endpoint: string, token: string, threadId: string) {
    return fetchAgentJson<{ ok?: boolean }>(endpoint, token, `/agent/opencode/threads/${encodeURIComponent(threadId)}/delete`, jsonPost({}));
}

export function renameOpencodeThread(endpoint: string, token: string, threadId: string, title: string) {
    return fetchAgentJson<{ ok?: boolean; threadId?: string; title?: string }>(endpoint, token, `/agent/opencode/threads/${encodeURIComponent(threadId)}/rename`, jsonPost({ title }));
}

export function sendOpencodeTurn(endpoint: string, token: string, body: { threadId: string; prompt: string; clientId: string; model?: string }) {
    return fetchAgentJson<{ ok?: boolean; threadId?: string }>(endpoint, token, "/agent/opencode/turn", jsonPost(body));
}

export function interruptOpencodeTurn(endpoint: string, token: string) {
    return fetchAgentJson<{ ok?: boolean }>(endpoint, token, "/agent/opencode/interrupt", jsonPost({}));
}

export function resolveAgentMessageAssetUrl(endpoint: string, token: string, value: string) {
    const match = AGENT_MESSAGE_ASSET_PATTERN.exec(value);
    if (!match) return value.startsWith("agent-asset:") ? "" : value;
    const baseUrl = endpoint.trim().replace(/\/$/, "");
    return baseUrl && token ? `${baseUrl}/agent/message-assets/${match[1]}/${match[2]}?token=${encodeURIComponent(token)}` : "";
}

export async function fetchAgentJson<T>(endpoint: string, token: string, path: string, init?: RequestInit) {
    const url = `${endpoint}${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
    const res = await fetch(url, init);
    const data = (await res.json().catch(() => ({}))) as T & { error?: string; msg?: string };
    if (!res.ok) throw new AgentApiError(res.status, data);
    return data;
}

/** 读取桌面壳拿到的本地 Agent 配置；浏览器里没有 Tauri 命令，返回 null。 */
export async function readLocalAgentConfig() {
    try {
        const config = await invoke<{ url: string; token: string } | null>("read_agent_config");
        return config?.url && config.token ? config : null;
    } catch {
        return null;
    }
}

function jsonPost(body: unknown): RequestInit {
    return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}
