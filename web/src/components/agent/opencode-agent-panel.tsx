import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Tooltip } from "antd";
import dayjs from "dayjs";
import { Bot, ChevronUp, Cpu, History, MessageSquare, PanelRightClose, PlugZap, Plus, Terminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";

import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import i18n from "@/i18n";
import { acquireAgentClientId, AGENT_PROTOCOL_VERSION, isDesktopApp } from "@/lib/agent/agent-client";
import { canvasThemes } from "@/lib/canvas-theme";
import { randomId } from "@/lib/utils";
import { activateAgentClient, createOpencodeThread, deleteOpencodeThread, fetchOpencodeModels, fetchOpencodeThread, fetchOpencodeThreads, interruptOpencodeTurn, postState, sendOpencodeTurn, type OpencodeModelOption } from "@/services/api/canvas-agent";
import type { AgentSkillSummary } from "@/services/api/canvas-agent";
import { useAgentSkillStore } from "@/stores/use-agent-skill-store";
import { useAgentStore, type AgentCanvasContext, type AgentCanvasReference, type AgentChatItem } from "@/stores/use-agent-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { AgentChatTimeline, AgentUsageBar } from "./agent-chat";
import { AgentChatComposer } from "./agent-chat-composer";
import { AgentConnectView } from "./agent-connect-view";
import { agentErrorView, bindPendingTurnMessages, eventUsage, formatAgentActivity, isCurrentThreadEvent, normalizeHistoryMessages, normalizeText, parseEventData, scopeChatItem, stringText, upsertAgentMessage, type AgentEventPayload } from "./agent-event-formatters";
import { AgentHistoryView } from "./agent-history-view";
import { AgentLogView } from "./agent-log-view";
import { AgentPanelTabs } from "./agent-panel-tabs";

const rt = (key: string, options?: Record<string, unknown>) => i18n.t(`agent.runtime.${key}`, options);

/** opencode 车道：会话列表、发消息、停止都直连本地 Agent 的 opencode 路由。 */
export function OpencodeAgentPanel() {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { message, modal } = App.useApp();
    const { url, token, connected, enabled, prompt, sending, waiting, tokenUsage, eventLogs, threads, activeThreadId, workspacePath, loadingThreads, activeTab, activity, connectError } = useAgentStore(
        useShallow((state) => ({
            url: state.url,
            token: state.token,
            connected: state.connected,
            enabled: state.enabled,
            prompt: state.prompt,
            sending: state.sending,
            waiting: state.waiting,
            tokenUsage: state.tokenUsage,
            eventLogs: state.eventLogs,
            threads: state.threads,
            activeThreadId: state.activeThreadId,
            workspacePath: state.workspacePath,
            loadingThreads: state.loadingThreads,
            activeTab: state.activeTab,
            activity: state.activity,
            connectError: state.connectError,
        })),
    );
    const setAgentState = useAgentStore((state) => state.setAgentState);
    const connectAgent = useAgentStore((state) => state.connectAgent);
    const connectLocalAgent = useAgentStore((state) => state.connectLocalAgent);
    const addMessage = useAgentStore((state) => state.addMessage);
    const pushEventLog = useAgentStore((state) => state.addEventLog);
    const clearEventLogs = useAgentStore((state) => state.clearEventLogs);
    const closePanel = useAgentStore((state) => state.closePanel);
    const addEventLog = useCallback((title: string, text: unknown, raw?: unknown) => {
        const value = normalizeText(text) || title;
        const last = useAgentStore.getState().eventLogs.at(-1);
        if (last?.title === title && last.text === value) return;
        pushEventLog({ id: `${Date.now()}-${Math.random()}`, time: dayjs().format("YYYY-MM-DD HH:mm:ss"), title, text: value, raw });
    }, [pushEventLog]);
    const messageCount = useAgentStore((state) => state.messages.length);
    const canvasContextRef = useRef<AgentCanvasContext | null>(useAgentStore.getState().canvasContext);
    const connectedRef = useRef(false);
    const clientIdRef = useRef("");
    const [clientReady, setClientReady] = useState(false);
    const endpoint = useMemo(() => url.trim().replace(/\/$/, ""), [url]);
    // 模型选择只保存在这个面板内，切换会话不需要跨页面共享。
    const [opencodeModels, setOpencodeModels] = useState<OpencodeModelOption[]>([]);
    const [opencodeModel, setOpencodeModel] = useState("");
    const [modelsUnavailable, setModelsUnavailable] = useState(false);

    useEffect(() => {
        let disposed = false;
        void acquireAgentClientId().then((clientId) => {
            if (disposed) return;
            clientIdRef.current = clientId;
            setClientReady(true);
        });
        return () => { disposed = true; };
    }, []);

    // 连上后从连接页回到对话；用户自己点开连接页看状态时不打扰。
    useEffect(() => {
        if (connected && useAgentStore.getState().activeTab === "setup") setAgentState({ activeTab: "chat" });
    }, [connected, setAgentState]);

    const loadSnapshot = useCallback(async (threadId: string) => {
        const data = await fetchOpencodeThread(endpoint, token, threadId);
        if (useAgentStore.getState().activeThreadId !== threadId) return;
        setAgentState({ messages: normalizeHistoryMessages(data.messages || []), activeTurnId: "", tokenUsage: null });
    }, [endpoint, setAgentState, token]);

    const loadThreads = useCallback(async (resume = false) => {
        setAgentState({ loadingThreads: true });
        try {
            const data = await fetchOpencodeThreads(endpoint, token);
            const list = data.data || [];
            const current = useAgentStore.getState();
            const active = list.some((item) => item.id === current.activeThreadId) ? current.activeThreadId : list[0]?.id || "";
            setAgentState({ threads: list, workspacePath: data.workspace?.workspacePath || "", activeThreadId: active, ...(active === current.activeThreadId ? {} : { messages: [], activeTurnId: "", tokenUsage: null }) });
            // 只在进入面板或手动刷新时重读历史；一轮刚结束时按消息流为准，不覆盖正在显示的内容。
            if (resume && active && !current.sending && !current.waiting) await loadSnapshot(active);
            if (!active) setAgentState({ messages: [], activeTurnId: "", tokenUsage: null });
        } catch (error) {
            addEventLog(rt("historyReadFailed"), error);
        } finally {
            setAgentState({ loadingThreads: false });
        }
    }, [addEventLog, endpoint, loadSnapshot, setAgentState, token]);

    const scopeEventItem = useCallback((event: AgentEventPayload, item: Omit<AgentChatItem, "id"> & { id?: string }, itemId: string) => {
        const threadId = event.threadId || event.thread_id || "";
        const turnId = event.turnId || event.turn_id || "";
        return scopeChatItem({ ...item, id: item.id || itemId, itemId } as AgentChatItem, threadId, turnId);
    }, []);

    const appendStreamText = useCallback((event: AgentEventPayload, text: string) => {
        const itemId = event.item?.id;
        if (!itemId || !text) return;
        const scoped = scopeEventItem(event, { role: "assistant", title: "opencode", text, streamId: itemId }, itemId);
        const messages = useAgentStore.getState().messages;
        const index = messages.findIndex((item) => item.id === scoped.id);
        if (index < 0) {
            addMessage(scoped);
            return;
        }
        setAgentState({ messages: messages.map((item, itemIndex) => itemIndex === index ? { ...item, text: `${item.text}${text}` } : item) });
    }, [addMessage, scopeEventItem, setAgentState]);

    const finishStreamText = useCallback((event: AgentEventPayload) => {
        const itemId = event.item?.id;
        if (!itemId) return;
        const text = stringText(event.item?.text);
        const scoped = scopeEventItem(event, { role: "assistant", title: "opencode", text }, itemId);
        const messages = useAgentStore.getState().messages;
        const index = messages.findIndex((item) => item.id === scoped.id);
        if (index < 0) {
            if (text) addMessage(scoped);
            return;
        }
        setAgentState({ messages: messages.map((item, itemIndex) => itemIndex === index ? { ...item, text: text || item.text, streamId: undefined } : item) });
    }, [addMessage, scopeEventItem, setAgentState]);

    const upsertActivity = useCallback((event: AgentEventPayload, activity: Omit<AgentChatItem, "id">) => {
        const itemId = event.item?.id;
        if (!itemId) return;
        const messages = useAgentStore.getState().messages;
        const scoped = scopeEventItem(event, activity, itemId);
        const existing = messages.find((item) => item.id === scoped.id);
        setAgentState({ messages: upsertAgentMessage(messages, { ...scoped, text: scoped.text || existing?.text || "" }) });
    }, [scopeEventItem, setAgentState]);

    const showError = useCallback((value: unknown, scopeThreadId = useAgentStore.getState().activeThreadId, scopeTurnId = useAgentStore.getState().activeTurnId) => {
        const error = agentErrorView(value);
        addMessage(scopeChatItem({ id: randomId(), role: "error", title: error.title, text: error.text }, scopeThreadId, scopeTurnId));
        addEventLog(error.title, error.text);
    }, [addEventLog, addMessage]);

    const handleAgentEvent = useCallback((event: AgentEventPayload) => {
        if (event.type === "thread.started") {
            setAgentState({ activity: rt("agentRunning") });
            return;
        }
        if (event.type === "turn.started") {
            const threadId = event.threadId || event.thread_id || "";
            const turnId = event.turnId || event.turn_id || "";
            if (!threadId || !turnId) return;
            setAgentState({ activeTurnId: turnId, sending: false, waiting: true, activity: rt("agentRunning"), messages: bindPendingTurnMessages(useAgentStore.getState().messages, threadId, turnId) });
            return;
        }
        if (event.type === "usage.updated") {
            setAgentState({ tokenUsage: eventUsage(event) });
            return;
        }
        if (event.type === "item.updated" && event.item?.type === "agent_message") {
            appendStreamText(event, stringText(event.item.delta));
            return;
        }
        if (event.type === "item.completed" && event.item?.type === "agent_message") {
            finishStreamText(event);
            return;
        }
        if (event.type === "turn.completed") {
            const state = useAgentStore.getState();
            const threadId = event.threadId || event.thread_id || "";
            const turnId = event.turnId || event.turn_id || "";
            setAgentState({
                sending: false,
                waiting: false,
                activeTurnId: state.activeTurnId === turnId ? "" : state.activeTurnId,
                activity: event.status === "failed" ? rt("processingFailed") : rt("completed"),
                messages: state.messages.map((item) => item.threadId === threadId && item.turnId === turnId && item.streamId ? { ...item, streamId: undefined } : item),
            });
            if (event.status === "failed") showError(event.error?.message || i18n.t("agent.events.taskFailed"), threadId, turnId);
            void loadThreads();
            return;
        }
        const activity = formatAgentActivity(event);
        if (activity) upsertActivity(event, activity);
    }, [appendStreamText, finishStreamText, loadThreads, setAgentState, showError, upsertActivity]);

    useEffect(() => {
        if (!clientReady || !enabled || !token.trim()) return;
        const clientId = clientIdRef.current;
        let disposed = false;
        let eventQueue = Promise.resolve();
        const isCurrent = () => !disposed && clientIdRef.current === clientId;
        const enqueue = (task: () => void) => {
            eventQueue = eventQueue.then(() => { if (isCurrent()) task(); }).catch((error) => {
                if (isCurrent()) addEventLog(rt("conversationSyncFailed"), error);
            });
        };
        const source = new EventSource(`${endpoint}/events?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientId)}`);
        source.addEventListener("hello", (event) => {
            if (!isCurrent()) return;
            const hello = parseEventData<{ protocolVersion?: number }>(event);
            if (hello?.protocolVersion !== AGENT_PROTOCOL_VERSION) {
                const text = rt("agentOutdated");
                source.close();
                connectedRef.current = false;
                setAgentState({ enabled: false, connected: false, waiting: false, sending: false, activity: rt("restartRequired"), connectError: text });
                addEventLog(rt("versionMismatch"), text, hello);
                message.error(text);
                return;
            }
            connectedRef.current = true;
            setAgentState({ connected: true, connectError: "", sending: false, waiting: false, activity: rt("connected") });
            void postState(endpoint, token, clientId, canvasContextRef.current?.snapshot || null);
            if (document.visibilityState === "visible" && document.hasFocus()) void activateAgentClient(endpoint, token, clientId);
            useAgentSkillStore.getState().reset();
            void loadThreads(true);
        });
        source.addEventListener("agent_event", (event) => {
            const data = parseEventData<AgentEventPayload>(event);
            if (data) enqueue(() => {
                if (isCurrentThreadEvent(data)) handleAgentEvent(data);
            });
        });
        source.onerror = () => {
            // 连上之后的断线交给浏览器自动重连；一直没握手成功才算连接失败。
            if (disposed || connectedRef.current) return;
            source.close();
            setAgentState({ enabled: false, connected: false, waiting: false, sending: false, activity: rt("connectionFailed"), connectError: rt("connectionFailedDescription") });
        };
        return () => {
            disposed = true;
            source.close();
        };
    }, [addEventLog, clientReady, enabled, endpoint, handleAgentEvent, loadThreads, message, setAgentState, token]);

    // 连上后读取 opencode 可用模型；列表为空或请求失败只提示不可用，不阻断对话（后端按默认模型发送）。
    useEffect(() => {
        if (!connected) return;
        let disposed = false;
        void fetchOpencodeModels(endpoint, token).then((data) => {
            if (disposed) return;
            const models = Array.isArray(data.models) ? data.models : [];
            if (!models.length) {
                setOpencodeModels([]);
                setOpencodeModel("");
                setModelsUnavailable(true);
                return;
            }
            const saved = typeof window === "undefined" ? "" : localStorage.getItem("canvas-agent-opencode-model") || "";
            const current = models.find((item) => item.id === saved)?.id
                || (data.defaultId && models.some((item) => item.id === data.defaultId) ? data.defaultId : "")
                || models[0].id;
            setOpencodeModels(models);
            setOpencodeModel(current);
            setModelsUnavailable(false);
            localStorage.setItem("canvas-agent-opencode-model", current);
        }).catch((error) => {
            if (disposed) return;
            setOpencodeModels([]);
            setOpencodeModel("");
            setModelsUnavailable(true);
            addEventLog(rt("modelListFailed"), error);
        });
        return () => { disposed = true; };
    }, [addEventLog, connected, endpoint, token]);

    // 画布变化只更新 ref，并按 300ms 节流回报，避免拖动时整块面板重渲染。
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const unsubscribe = useAgentStore.subscribe((state) => {
            if (state.canvasContext === canvasContextRef.current) return;
            canvasContextRef.current = state.canvasContext;
            if (!useAgentStore.getState().connected) return;
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => void postState(endpoint, token, clientIdRef.current, canvasContextRef.current?.snapshot || null), 300);
        });
        return () => {
            unsubscribe();
            if (timer) clearTimeout(timer);
        };
    }, [endpoint, token]);

    const sendPrompt = async () => {
        const state = useAgentStore.getState();
        const text = state.prompt.trim();
        if (!state.connected || state.sending || state.waiting || state.loadingThreads) return;
        const nodeIds = new Set(state.canvasContext?.snapshot.nodes.map((node) => node.id) || []);
        const references = state.canvasReferences.filter((item) => nodeIds.has(item.nodeId));
        const requestPrompt = withSkill(promptWithReferences(text, references), useAgentSkillStore.getState().selectedSkill);
        if (!requestPrompt) return;
        const messageId = randomId();
        setAgentState({ prompt: "", canvasReferences: [], sending: true, activity: rt("sending"), activeTurnId: "" });
        useAgentSkillStore.getState().clearSelection();
        addMessage({ id: messageId, itemId: "synthetic:user", clientMessageId: messageId, threadId: state.activeThreadId, turnId: "", role: "user", text: text || rt("canvasReferencesSent", { count: references.length }), canvasReferences: references as AgentCanvasReference[] });
        let threadId = state.activeThreadId;
        try {
            if (!threadId) {
                threadId = (await createOpencodeThread(endpoint, token)).threadId || "";
                if (!threadId) throw new Error(rt("startConversationFailed"));
                setAgentState({ activeThreadId: threadId, messages: useAgentStore.getState().messages.map((item) => item.clientMessageId === messageId ? scopeChatItem(item, threadId, "") : item) });
            }
            addEventLog(rt("sendTask"), compact(text) || rt("canvasReferencesSent", { count: references.length }));
            await sendOpencodeTurn(endpoint, token, { threadId, prompt: requestPrompt, clientId: clientIdRef.current, ...(opencodeModel ? { model: opencodeModel } : {}) });
            setAgentState({ sending: false, waiting: true, activity: rt("agentRunning") });
        } catch (error) {
            const latest = useAgentStore.getState();
            setAgentState({
                sending: false,
                waiting: false,
                activity: rt("sendFailed"),
                messages: latest.messages.filter((item) => item.clientMessageId !== messageId || item.turnId),
                ...(latest.prompt ? {} : { prompt: text, canvasReferences: references }),
            });
            showError(error instanceof Error ? error.message : rt("sendFailed"));
        }
    };

    const stopTurn = async () => {
        if (!connected || (!sending && !waiting)) return;
        setAgentState({ activity: rt("stopping") });
        try {
            await interruptOpencodeTurn(endpoint, token);
            addEventLog(rt("stopTask"), rt("taskStopped"));
        } catch (error) {
            setAgentState({ activity: rt("stopFailed") });
            addEventLog(rt("stopFailed"), error);
        }
    };

    const startNewThread = async () => {
        const state = useAgentStore.getState();
        if (!state.connected || state.sending || state.waiting || state.loadingThreads) return;
        setAgentState({ loadingThreads: true, activity: rt("creatingConversation") });
        try {
            const threadId = (await createOpencodeThread(endpoint, token)).threadId || "";
            if (!threadId) throw new Error(rt("startConversationFailed"));
            setAgentState({ activeTab: "chat", activeThreadId: threadId, activeTurnId: "", messages: [], tokenUsage: null, activity: rt("newConversation") });
            await loadThreads();
        } catch (error) {
            setAgentState({ activity: rt("newConversationFailed") });
            addEventLog(rt("newConversationFailed"), error);
            message.error(error instanceof Error ? error.message : rt("newConversationFailed"));
        } finally {
            setAgentState({ loadingThreads: false });
        }
    };

    const resumeThread = async (threadId: string) => {
        const state = useAgentStore.getState();
        if (!state.connected || !threadId || state.sending || state.waiting || state.loadingThreads) return;
        setAgentState({ loadingThreads: true, ...(threadId === state.activeThreadId ? {} : { activeThreadId: threadId, activeTurnId: "", messages: [], tokenUsage: null }) });
        try {
            await loadSnapshot(threadId);
            setAgentState({ activeTab: "chat", activity: rt("conversationResumed") });
        } catch (error) {
            addEventLog(rt("resumeConversationFailed"), error);
            message.error(error instanceof Error ? error.message : rt("resumeConversationFailed"));
        } finally {
            setAgentState({ loadingThreads: false });
        }
    };

    const deleteThreads = async (threadIds: string[]) => {
        const state = useAgentStore.getState();
        if (!state.connected || !threadIds.length || state.sending || state.waiting) return;
        const ids = [...new Set(threadIds)];
        setAgentState({ loadingThreads: true });
        try {
            for (const threadId of ids) await deleteOpencodeThread(endpoint, token, threadId);
            if (ids.includes(state.activeThreadId)) setAgentState({ activeThreadId: "", activeTurnId: "", messages: [], tokenUsage: null });
            await loadThreads();
            message.success(rt("recordsDeleted", { count: ids.length }));
        } catch (error) {
            await loadThreads();
            addEventLog(rt("deleteConversationFailed"), error);
            message.error(error instanceof Error ? error.message : rt("deleteConversationFailed"));
        } finally {
            setAgentState({ loadingThreads: false });
        }
    };

    const confirmDeleteThreads = (threadIds: string[]) => {
        modal.confirm({
            title: rt("deleteConversations", { count: threadIds.length }),
            content: rt("deleteConversationsDescription"),
            okText: t("common.delete"),
            okType: "danger",
            cancelText: t("common.cancel"),
            onOk: () => deleteThreads(threadIds),
        });
    };

    const toggleAgentConnection = () => {
        if (enabled) {
            setAgentState({ enabled: false, connected: false, activity: rt("offline"), connectError: "", messages: [], threads: [], activeThreadId: "", activeTurnId: "", tokenUsage: null, workspacePath: "" });
            return;
        }
        if (isDesktopApp()) void connectLocalAgent();
        else connectAgent();
    };

    const connectionStatus = t(connectError ? "agent.status.failed" : connected ? "agent.status.connected" : enabled ? "agent.status.connecting" : "agent.status.disconnected");
    const connectionStatusColor = connectError ? "#dc2626" : connected ? "#16a34a" : enabled ? "#d97706" : theme.node.muted;
    return (
        <>
            <AgentPanelTabs
                value={activeTab}
                theme={theme}
                leading={
                    <div className="flex items-center gap-1">
                        <span className="grid size-8 place-items-center">
                            <Bot className="size-4" />
                        </span>
                        <div className="hidden text-base font-semibold leading-5 @min-[560px]:block">Agent</div>
                        <Tooltip title={t("agent.panel.connectionSettings", { status: connectionStatus })} placement="bottom">
                            <Button size="small" type="text" className="!h-8 !w-8 !min-w-8 !px-0 @min-[560px]:!w-auto @min-[560px]:!min-w-0 @min-[560px]:!px-[7px]" aria-label={t("agent.panel.connectionSettingsLabel", { status: connectionStatus })} icon={<PlugZap className="size-3.5" style={{ color: connectionStatusColor }} />} onClick={() => setAgentState({ activeTab: "setup" })}>
                                <span className="hidden @min-[560px]:inline">{connectionStatus}</span>
                            </Button>
                        </Tooltip>
                    </div>
                }
                items={[
                    { value: "chat", label: t("agent.panel.chat"), icon: <MessageSquare className="size-3.5" /> },
                    { value: "history", label: t("agent.panel.history"), icon: <History className="size-3.5" />, count: threads.length },
                    { value: "log", label: t("agent.panel.logs"), icon: <Terminal className="size-3.5" />, count: eventLogs.length },
                ]}
                onChange={(activeTab) => {
                    setAgentState({ activeTab });
                    if (activeTab === "history") void loadThreads();
                }}
                right={
                    <>
                        <Tooltip title={t("agent.history.newThread")} placement="bottom">
                            <Button size="small" type="text" className="!h-8 !w-8 !min-w-8 !px-0 @min-[560px]:!w-auto @min-[560px]:!min-w-0 @min-[560px]:!px-[7px]" aria-label={t("agent.history.newThread")} disabled={!connected || loadingThreads || sending || waiting} icon={<Plus className="size-3.5" />} onClick={() => void startNewThread()}>
                                <span className="hidden @min-[560px]:inline">{t("agent.history.newThread")}</span>
                            </Button>
                        </Tooltip>
                        <Tooltip title={t("agent.panel.collapse")}>
                            <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" aria-label={t("agent.panel.collapseLabel")} style={{ color: theme.node.muted }} icon={<PanelRightClose className="size-4" />} onClick={closePanel} />
                        </Tooltip>
                    </>
                }
            />

            {activeTab === "setup" ? (
                <AgentConnectView
                    theme={theme}
                    url={url}
                    token={token}
                    enabled={enabled}
                    connected={connected}
                    activity={activity}
                    connectError={connectError}
                    onUrlChange={(url) => setAgentState({ url, connectError: "" })}
                    onTokenChange={(token) => setAgentState({ token, connectError: "" })}
                    onToggleEnabled={toggleAgentConnection}
                />
            ) : activeTab === "history" ? (
                <AgentHistoryView
                    theme={theme}
                    threads={threads}
                    activeThreadId={activeThreadId}
                    workspacePath={workspacePath}
                    loading={loadingThreads}
                    busy={sending || waiting}
                    connected={connected}
                    onRefresh={() => void loadThreads(true)}
                    onNewThread={() => void startNewThread()}
                    onResumeThread={(threadId) => void resumeThread(threadId)}
                    onDeleteThreads={confirmDeleteThreads}
                />
            ) : activeTab === "log" ? (
                <AgentLogView
                    logs={eventLogs}
                    theme={theme}
                    context={{ endpoint, connected, enabled, activity, waiting, sending, messages: messageCount }}
                    onClear={clearEventLogs}
                    onCopied={(text) => message.success(text)}
                    onCopyBlocked={(text) => message.warning(text)}
                />
            ) : (
                <>
                    <AgentChatTimeline theme={theme} sending={sending} waiting={waiting} />
                    {tokenUsage ? <AgentUsageBar usage={tokenUsage} theme={theme} /> : null}
                    <AgentChatComposer
                        prompt={prompt}
                        disabled={!connected || loadingThreads}
                        sending={sending || waiting}
                        placeholder={t("agent.panel.opencodePlaceholder")}
                        theme={theme}
                        onPromptChange={(prompt) => setAgentState({ prompt })}
                        onSubmit={() => void sendPrompt()}
                        onStop={() => void stopTurn()}
                        left={
                            opencodeModels.length && opencodeModel ? (
                                <OpencodeModelSelect models={opencodeModels} model={opencodeModel} onChange={(model) => {
                                    if (!opencodeModels.some((item) => item.id === model)) return;
                                    setOpencodeModel(model);
                                    localStorage.setItem("canvas-agent-opencode-model", model);
                                }} />
                            ) : (
                                <span className="hidden text-[11px] @min-[660px]:inline" style={{ color: theme.node.muted }}>
                                    {t(modelsUnavailable ? "agent.kind.opencodeModelsUnavailable" : "agent.kind.opencodeModel")}
                                </span>
                            )
                        }
                    />
                </>
            )}
        </>
    );
}

/** opencode 模型下拉：只列出 /config/providers 返回过的 id，避免列表里出现调不通的模型。 */
function OpencodeModelSelect({ models, model, onChange }: { models: OpencodeModelOption[]; model: string; onChange: (model: string) => void }) {
    const { t } = useTranslation();
    const current = models.find((item) => item.id === model) || models[0];
    const [open, setOpen] = useState(false);
    return (
        <Tooltip title={t("agent.kind.selectOpencodeModel", { model: current.label })} placement="top" open={open ? false : undefined}>
            <span className="inline-flex shrink-0">
                <Select value={model} open={open} onOpenChange={setOpen} onValueChange={onChange}>
                    <SelectTrigger hideChevron className="h-9 w-9 min-w-9 justify-center gap-0 rounded-full border-0 bg-transparent px-0 text-xs font-medium shadow-none hover:bg-black/5 focus:ring-0 @min-[660px]:w-auto @min-[660px]:min-w-36 @min-[660px]:max-w-44 @min-[660px]:justify-start @min-[660px]:gap-1.5 @min-[660px]:px-2.5 dark:bg-transparent dark:hover:bg-white/10" aria-label={t("agent.kind.selectOpencodeModel", { model: current.label })}>
                        <Cpu className="size-3.5 shrink-0 opacity-70" />
                        <span className="hidden min-w-0 flex-1 truncate text-left @min-[660px]:inline">{current.label}</span>
                        <ChevronUp className="hidden size-3 opacity-50 @min-[660px]:block" />
                    </SelectTrigger>
                    <SelectContent data-canvas-no-zoom position="popper" side="top" align="start" sideOffset={6} className="z-[1200] w-64 rounded-xl border border-border/70 bg-popover p-1 shadow-xl">
                        {models.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}
                    </SelectContent>
                </Select>
            </span>
        </Tooltip>
    );
}

function compact(value: string, maxLength = 120) {
    const text = value.replace(/\s+/g, " ").trim();
    return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

/** opencode 没有图片附件通道，画布引用只带 nodeId 和素材文字。 */
/** opencode 不认 `$skill` 标记，把 Skill 说明文件路径一并带上，让它自己读。 */
function withSkill(text: string, skill: AgentSkillSummary | null) {
    if (!skill) return text;
    return `${text || "请按这个 Skill 执行。"}\n\n本轮使用的 Skill：$${skill.name}（说明文件 ${skill.path}），先读取该文件，再按其中的步骤执行。`;
}

function promptWithReferences(text: string, references: AgentCanvasReference[]) {
    if (!references.length) return text;
    const task = text || "请处理引用的画布素材。";
    const list = references.map((item, index) => `${index + 1}. mention=${JSON.stringify(`@${item.label}`)}, nodeId=${JSON.stringify(item.nodeId)}, title=${JSON.stringify(item.title)}, type=${item.kind}`).join("\n");
    return `${task}\n\n本轮引用的当前画布素材：\n${list}\n需要读取或操作这些素材时，先调用画布工具读取当前画布，再用上面的 nodeId 精确定位，不要按标题猜测节点。`;
}
