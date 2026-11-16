import { create } from "zustand";
import i18n from "@/i18n";

import type { CanvasAgentOp, CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { isAgentPermissionMode } from "@/lib/canvas/agent-permissions";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { readLocalAgentConfig } from "@/services/api/canvas-agent";

export type AgentChatRole = "user" | "assistant" | "system" | "tool" | "error";
export type AgentAttachment = { id: string; name: string; type: string; size: number; width: number; height: number; url: string; dataUrl: string };
export type AgentMessageAttachment = Pick<AgentAttachment, "id" | "name" | "url"> & Partial<Pick<AgentAttachment, "type" | "size" | "width" | "height" | "dataUrl">>;
export type AgentCanvasReference = Pick<CanvasResourceReference, "nodeId" | "label" | "title" | "kind" | "previewUrl" | "text">;
export type AgentSkillReference = { name: string; path: string; displayName?: string };
export type AgentChatItem = {
    id: string;
    itemId?: string;
    clientMessageId?: string;
    threadId?: string;
    turnId?: string;
    role: AgentChatRole;
    title?: string;
    text: string;
    meta?: string;
    detail?: unknown;
    attachments?: AgentMessageAttachment[];
    canvasReferences?: AgentCanvasReference[];
    skill?: AgentSkillReference;
    streamId?: string;
    activityItems?: Record<string, string>;
};
export type AgentEventLog = { id: string; time: string; title: string; text: string; raw?: unknown };
export type AgentPermissionMode = "request" | "automatic" | "full";
export type AgentReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
export type AgentModel = {
    id: string;
    model: string;
    displayName: string;
    defaultReasoningEffort: AgentReasoningEffort;
    supportedReasoningEfforts: Array<{ reasoningEffort: AgentReasoningEffort; description?: string }>;
    isDefault?: boolean;
};
export type AgentApprovalDecision = "accept" | "acceptForSession" | "decline";
export type AgentPendingApproval = {
    requestId: string;
    method: string;
    threadId?: string;
    turnId?: string;
    itemId?: string;
    reason?: string;
    command?: unknown;
    cwd?: string;
    grantRoot?: string;
    networkApprovalContext?: unknown;
    permissions?: unknown;
    deciding?: AgentApprovalDecision;
};
export type AgentCanvasContext = { snapshot: CanvasAgentSnapshot; applyOps: (ops?: CanvasAgentOp[]) => CanvasAgentSnapshot; undoOps: () => CanvasAgentSnapshot | null; canUndo: boolean };
export type AgentThreadSummary = { id: string; preview: string; name?: string | null; cwd?: string; status?: string; source?: unknown; createdAt?: number; updatedAt?: number };
export type AgentTokenUsage = { input: number; cached: number; output: number };
export type AgentBootstrapStatus = { key: string; text: string; detail: string; status: "running" | "ready" | "error" };
export type AgentConversationState = {
    revision: number;
    conversationId: string;
    threadId: string;
    status: "idle" | "preparing" | "ready" | "warning" | "running" | "failed";
    mcpStatuses: Record<string, { status: "starting" | "ready" | "failed" | "cancelled"; error?: string | null; failureReason?: string | null }>;
    sourceClientId?: string;
    error?: string;
};
export type AgentPanelTab = "chat" | "setup" | "history" | "skills" | "log";

const CONNECT_TIMEOUT_MS = 6000;
let agentSource: EventSource | null = null;
let connectTimer: ReturnType<typeof setTimeout> | null = null;

export const AGENT_PERMISSION_KEY = "infinite-canvas:agent-permission";

/** 权限偏好跟着人走，不跟项目：换画布不该改变安全习惯。 */
function readStoredPermission(): AgentPermissionMode {
    try {
        const stored = localStorage.getItem(AGENT_PERMISSION_KEY);
        return isAgentPermissionMode(stored) ? stored : "automatic";
    } catch {
        return "automatic";
    }
}

type AgentStore = {
    width: number;
    panelOpen: boolean;
    panelMounted: boolean;
    panelClosing: boolean;
    canvasContext: AgentCanvasContext | null;
    url: string;
    token: string;
    connected: boolean;
    enabled: boolean;
    silentConnect: boolean;
    fragmentBootstrap: boolean;
    prompt: string;
    attachments: AgentAttachment[];
    canvasReferences: CanvasResourceReference[];
    sending: boolean;
    waiting: boolean;
    messages: AgentChatItem[];
    tokenUsage: AgentTokenUsage | null;
    eventLogs: AgentEventLog[];
    threads: AgentThreadSummary[];
    activeThreadId: string;
    activeTurnId: string;
    workspacePath: string;
    loadingThreads: boolean;
    activeTab: AgentPanelTab;
    activity: string;
    conversation: AgentConversationState;
    bootstrapStatus: AgentBootstrapStatus | null;
    mcpStartupStatuses: Record<string, AgentBootstrapStatus>;
    connectError: string;
    /** Agent 三档权限；默认 automatic（花钱与删除仍需确认）。 */
    permission: AgentPermissionMode;
    setPermission: (permission: AgentPermissionMode) => void;
    setAgentState: (
        patch: Partial<Omit<AgentStore, "setAgentState" | "setPermission" | "connectAgent" | "connectLocalAgent" | "disconnectAgent" | "addMessage" | "addEventLog" | "clearEventLogs" | "openPanel" | "closePanel" | "togglePanel" | "setCanvasContext">>,
    ) => void;
    openPanel: () => void;
    closePanel: () => void;
    togglePanel: () => void;
    setCanvasContext: (context: AgentCanvasContext | null) => void;
    connectAgent: (options?: { silent?: boolean }) => void;
    connectLocalAgent: (options?: { silent?: boolean }) => Promise<void>;
    disconnectAgent: (
        patch?: Partial<Omit<AgentStore, "setAgentState" | "setPermission" | "connectAgent" | "connectLocalAgent" | "disconnectAgent" | "addMessage" | "addEventLog" | "clearEventLogs" | "openPanel" | "closePanel" | "togglePanel" | "setCanvasContext">>,
    ) => void;
    addMessage: (item: AgentChatItem) => void;
    addEventLog: (item: AgentEventLog) => void;
    clearEventLogs: () => void;
};

export const CANVAS_AGENT_PANEL_MOTION_MS = 500;

export const useAgentStore = create<AgentStore>((set, get) => ({
    width: typeof window === "undefined" ? 440 : Number(localStorage.getItem("canvas-agent-panel-width")) || 440,
    panelOpen: false,
    panelMounted: true,
    panelClosing: false,
    canvasContext: null,
    // 桌面版由 connectLocalAgent 从本地配置填入；浏览器里只能从上次手动填写处恢复。
    url: (typeof window !== "undefined" && localStorage.getItem("canvas-agent-url")) || "http://127.0.0.1:17371",
    token: (typeof window !== "undefined" && localStorage.getItem("canvas-agent-token")) || "",
    connected: false,
    enabled: false,
    silentConnect: false,
    fragmentBootstrap: false,
    prompt: "",
    attachments: [],
    canvasReferences: [],
    sending: false,
    waiting: false,
    messages: [],
    tokenUsage: null,
    eventLogs: [],
    threads: [],
    activeThreadId: "",
    activeTurnId: "",
    workspacePath: "",
    loadingThreads: false,
    activeTab: "setup",
    activity: i18n.t("agent.state.ready"),
    conversation: { revision: 0, conversationId: "", threadId: "", status: "idle", mcpStatuses: {} },
    bootstrapStatus: null,
    mcpStartupStatuses: {},
    connectError: "",
    permission: readStoredPermission(),
    setPermission: (permission) => {
        set({ permission });
        try {
            localStorage.setItem(AGENT_PERMISSION_KEY, permission);
        } catch {
            // 存不下就只在本次会话生效，不因为存储故障拦住权限切换
        }
    },
    setAgentState: (patch) => set(patch),
    openPanel: () => set({ panelOpen: true, panelMounted: true, panelClosing: false }),
    closePanel: () => {
        if (!get().panelMounted || get().panelClosing) return;
        set({ panelOpen: false, panelClosing: true });
        setTimeout(() => {
            if (get().panelClosing) set({ panelClosing: false });
        }, CANVAS_AGENT_PANEL_MOTION_MS);
    },
    togglePanel: () => (get().panelOpen ? get().closePanel() : get().openPanel()),
    setCanvasContext: (canvasContext) => set({ canvasContext }),
    connectAgent: (options) => {
        const silent = options?.silent ?? false;
        const endpoint = get().url.trim().replace(/\/$/, "");
        const token = get().token.trim();
        if (!endpoint || !token) return set({ connectError: silent ? "" : i18n.t("agent.state.connectionRequired") });
        try {
            const parsed = new URL(endpoint);
            if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
        } catch {
            return set({ connectError: silent ? "" : i18n.t("agent.state.invalidUrl") });
        }
        // 仅浏览器兜底会走到这里：记住手动填过的地址和 token。桌面版由本地配置直接覆盖。
        localStorage.setItem("canvas-agent-url", endpoint);
        localStorage.setItem("canvas-agent-token", token);
        // Only set enabled here; OpencodeAgentPanel's effect owns SSE initialization.
        set({ url: endpoint, token, enabled: true, silentConnect: silent, fragmentBootstrap: false, activity: i18n.t("agent.status.connecting"), connectError: "" });
    },
    // 桌面版直接读本地 Agent 自己写的配置，用户不需要知道地址和 token。
    connectLocalAgent: async (options) => {
        const config = await readLocalAgentConfig();
        if (!config) {
            if (!options?.silent) set({ connectError: i18n.t("agent.runtime.agentNotFound") });
            return;
        }
        set({ url: config.url, token: config.token });
        get().connectAgent({ silent: true });
    },
    disconnectAgent: (patch = {}) => {
        agentSource?.close();
        agentSource = null;
        if (connectTimer) clearTimeout(connectTimer);
        connectTimer = null;
        set({
            enabled: false,
            connected: false,
            silentConnect: false,
            fragmentBootstrap: false,
            activity: i18n.t("agent.state.offline"),
            conversation: { revision: 0, conversationId: "", threadId: "", status: "idle", mcpStatuses: {} },
            bootstrapStatus: null,
            mcpStartupStatuses: {},
            ...patch,
        });
    },
    addMessage: (item) => set((state) => ({ messages: [...state.messages, item] })),
    addEventLog: (item) => set((state) => ({ eventLogs: [...state.eventLogs.slice(-160), item] })),
    clearEventLogs: () => set({ eventLogs: [] }),
}));
