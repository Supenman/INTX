import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";

import { messageMetadataStore } from "../agent/message-metadata.js";
import { createOpencodeThread, deleteOpencodeThread, interruptOpencodeTurn, listOpencodeModels, listOpencodeThreads, readOpencodeThread, runOpencodeTurn } from "../agent/opencode.js";
import { AGENT_PROTOCOL_VERSION, CanvasSession } from "../canvas/session.js";
import { SkillStore } from "../skills/store.js";
import { DEFAULT_PORT, ensureSiteWorkspace, loadConfig, saveConfig, type CanvasAgentConfig } from "../config.js";
import { logger } from "../utils/logger.js";
import { checkVersions } from "../version-check.js";

/** 启动仅监听本机的 Canvas Agent HTTP 服务。 */
export function startHttpServer() {
    const config = loadConfig(true);
    const port = Number(process.env.PORT) || Number(new URL(config.url).port) || DEFAULT_PORT;
    config.url = `http://127.0.0.1:${port}`;
    saveConfig(config);

    const initialWorkspace = ensureSiteWorkspace(config);
    const session = new CanvasSession(initialWorkspace.activeThreadId || "");
    /** 将 Agent 事件广播到所属线程或全部网页。 */
    const emit = (type: string, payload: unknown) => {
        const value = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : { value: payload };
        if (type === "skills_changed") {
            session.emitAll(type, value);
            return;
        }
        if (type === "agent_bootstrap" && value.phase === "preheat") {
            if (value.type === "mcp.startup") session.updateConversationMcp(String(value.name || ""), startupStatus(value.status), String(value.error || "") || null, String(value.failureReason || "") || null);
            if (value.type === "mcp.complete") session.completeConversationMcpInventory(mcpInventory(value.services));
        }
        const scope = session.codexBusy ? session.codexEventScope : { threadId: "", turnId: "", sourceClientId: "" };
        const threadId = String(value.threadId || value.thread_id || scope.threadId || ensureSiteWorkspace(config).activeThreadId || "");
        const turnId = String(value.turnId || value.turn_id || scope.turnId || "");
        const sourceClientId = String(value.sourceClientId || scope.sourceClientId || "");
        const data = {
            ...value,
            ...(threadId ? { threadId, thread_id: threadId } : {}),
            ...(turnId ? { turnId, turn_id: turnId } : {}),
            ...(sourceClientId ? { sourceClientId } : {}),
        };
        session.trackCodexEvent(type, data);
        threadId ? session.emitThread(type, threadId, data) : session.emitAll(type, data);
    };
    const app = express();
    app.disable("x-powered-by");
    app.use(express.json({ limit: "30mb" }));
    app.use((req, res, next) => {
        if (!logger.enabled) return next();
        const startedAt = Date.now();
        const url = requestUrl(req, config);
        res.on("finish", () => {
            if (req.method === "OPTIONS" || (res.statusCode < 400 && ["/health", "/canvas/state", "/canvas/activate"].includes(url.pathname))) return;
            logger.debug(`HTTP ${req.method} ${url.pathname}`, { status: res.statusCode, durationMs: Date.now() - startedAt });
        });
        next();
    });
    app.use((req, res, next) => {
        const url = requestUrl(req, config);
        if (!setCors(req, res, url, config)) return void res.status(403).json({ ok: false, error: "origin not allowed" });
        if (req.method === "OPTIONS") return void res.json({});
        next();
    });
    app.get("/health", (_req, res) => res.json(session.health()));
    app.get("/config", (_req, res) => res.json({ ok: true, protocolVersion: AGENT_PROTOCOL_VERSION, url: config.url, hasToken: true }));
    app.use((req, res, next) => {
        if (validToken(req, requestUrl(req, config), config.token)) return next();
        res.status(401).json({ ok: false, error: "invalid token" });
    });
    app.get("/events", (req, res) => {
        session.openEvents(requestUrl(req, config), res, ensureSiteWorkspace(config).activeThreadId || "");
    });
    app.post("/canvas/state", (req, res) => {
        session.updateState(req.body, String(req.query.clientId || "") || undefined);
        res.json({ ok: true });
    });
    app.post("/canvas/activate", (req, res) => {
        session.activateClient(String(req.query.clientId || ""));
        res.json({ ok: true });
    });
    app.post("/canvas/result", (req, res) => {
        const ok = session.resolveResult(String(req.query.clientId || ""), req.body);
        res.status(ok ? 200 : 409).json({ ok });
    });
    app.get("/agent/attachments/:attachmentId", route(async (req, res) => {
        const attachment = session.getTurnAttachment(String(req.query.clientId || ""), routeParam(req.params.attachmentId));
        const data = attachment.dataUrl.split(",", 2)[1];
        if (!data) throw new Error("图片附件内容无效");
        res.setHeader("Cache-Control", "no-store");
        res.type(attachment.type).send(Buffer.from(data, "base64"));
    }));
    app.get("/agent/message-assets/:messageKey/:assetFile", route(async (req, res) => {
        const asset = await messageMetadataStore.readAsset(routeParam(req.params.messageKey), routeParam(req.params.assetFile));
        if (!asset) return void res.status(404).json({ ok: false, error: "message asset not found" });
        res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
        res.type(asset.contentType).send(asset.data);
    }));
    app.post("/agent/local-file/reveal", route(async (req, res) => {
        const filePath = String(req.body?.path || "");
        if (!path.isAbsolute(filePath)) return res.status(400).json({ ok: false, error: "文件路径必须是绝对路径" });
        const file = await stat(filePath);
        await revealLocalFile(filePath, file.isDirectory());
        res.json({ ok: true });
    }));
    app.post("/agent/local-image", route(async (req, res) => {
        const filePath = String(req.body?.path || "");
        if (!path.isAbsolute(filePath) || !/\.(?:avif|gif|jpe?g|png|webp)$/i.test(filePath)) return res.status(400).json({ ok: false, error: "图片路径无效" });
        const file = await stat(filePath);
        if (!file.isFile()) return res.status(400).json({ ok: false, error: "图片文件无效" });
        res.setHeader("Cache-Control", "no-store");
        res.type(path.extname(filePath)).send(await readFile(filePath));
    }));
    app.post("/api/tools", route(async (req, res) => res.json({ ok: true, result: await session.callTool(req.body?.name, req.body?.input || {}) })));
    /** 将 Agent 写操作串行化，避免多窗口在异步请求期间交叉修改会话。 */
    function mutation(handler: (req: Request, res: Response) => unknown | Promise<unknown>) {
        return route(async (req, res) => {
            if (!session.beginCodexMutation()) return res.status(409).json({ ok: false, code: "CONVERSATION_BUSY", error: "本地 Agent 正在运行或正在切换会话，请稍后重试", state: session.conversationStateSnapshot });
            try {
                return await handler(req, res);
            } finally {
                session.endCodexMutation();
            }
        });
    }
    /** opencode 模型列表：服务或接口异常时返回空列表，前端提示不可用并回退默认模型，不阻断连接。 */
    app.get("/agent/opencode/models", route(async (_req, res) => {
        const workspace = ensureSiteWorkspace(config);
        res.json({ ok: true, ...(await listOpencodeModels(workspace.workspacePath)) });
    }));
    /** 本地 Skill 列表：只读站点工作空间的 .agents/skills，供侧边栏 `/` 提及使用。 */
    app.get("/agent/opencode/skills", route(async (_req, res) => {
        const workspace = ensureSiteWorkspace(config);
        const { skills, errors } = await new SkillStore(workspace.workspacePath).list();
        res.json({ ok: true, data: skills.map((skill) => ({ ...skill, scope: "repo", enabled: true, managed: true })), errors });
    }));
    app.post("/agent/opencode/threads/new", mutation(async (_req, res) => {
        const workspace = ensureSiteWorkspace(config);
        res.json({ ok: true, threadId: await createOpencodeThread(workspace.workspacePath) });
    }));
    app.get("/agent/opencode/threads", route(async (_req, res) => {
        const workspace = ensureSiteWorkspace(config);
        res.json({ ok: true, workspace: { workspacePath: workspace.workspacePath }, data: await listOpencodeThreads(workspace.workspacePath) });
    }));
    app.get("/agent/opencode/threads/:threadId", route(async (req, res) => {
        const workspace = ensureSiteWorkspace(config);
        const threadId = routeParam(req.params.threadId);
        res.json({ ok: true, workspace: { workspacePath: workspace.workspacePath }, thread: { id: threadId, preview: "" }, messages: await readOpencodeThread(workspace.workspacePath, threadId) });
    }));
    app.post("/agent/opencode/threads/:threadId/delete", mutation(async (req, res) => {
        const workspace = ensureSiteWorkspace(config);
        await deleteOpencodeThread(workspace.workspacePath, routeParam(req.params.threadId));
        res.json({ ok: true });
    }));
    app.post("/agent/opencode/turn", mutation(async (req, res) => {
        const prompt = String(req.body?.prompt || "");
        const threadId = String(req.body?.threadId || "");
        if (!prompt.trim()) return res.status(400).json({ ok: false, error: "请输入任务内容" });
        if (!threadId) return res.status(400).json({ ok: false, error: "缺少 opencode 会话" });
        const workspace = ensureSiteWorkspace(config);
        const clientId = String(req.body?.clientId || "");
        const model = typeof req.body?.model === "string" ? req.body.model : "";
        /** opencode 事件按线程广播；带上发起网页，方便它只处理自己的请求。 */
        const turnEmit = (type: string, payload: unknown) => {
            const value = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : { value: payload };
            emit(type, clientId ? { ...value, sourceClientId: clientId } : value);
        };
        void runOpencodeTurn(prompt, turnEmit, { threadId, cwd: workspace.workspacePath, model }).catch((error) => logger.warn("opencode turn failed", { threadId, error }));
        res.json({ ok: true, threadId });
    }));
    app.post("/agent/opencode/interrupt", route(async (_req, res) => {
        const ok = await interruptOpencodeTurn();
        res.status(ok ? 200 : 409).json({ ok, ...(ok ? {} : { error: "当前没有可停止的任务" }) });
    }));
    app.use((_req, res) => res.status(404).json({ ok: false, error: "not found" }));
    app.use((error: Error, req: Request, res: Response, _next: NextFunction) => {
        logger.error("HTTP request failed", { method: req.method, path: req.path, error });
        res.status(500).json({ ok: false, error: error.message });
    });

    app.listen(port, "127.0.0.1", () => {
        console.log("Infinite Canvas Agent");
        checkVersions();
        console.log(`Local URL: ${config.url}`);
        console.log(`Connect token: ${config.token}`);
        if (logger.enabled) console.log(`Debug log: ${logger.filePath}`);
        logger.info("Canvas Agent started", { url: config.url, workspace: ensureSiteWorkspace(config).workspacePath, debugLog: logger.filePath });
    });
}

/** 将异步 Express 路由异常交给统一错误处理中间件。 */
function route(handler: (req: Request, res: Response) => Promise<unknown>) {
    return (req: Request, res: Response, next: NextFunction) => void handler(req, res).catch(next);
}

/** 从 Express 路由参数中读取单个字符串。 */
function routeParam(value: string | string[]) {
    return Array.isArray(value) ? value[0] || "" : value;
}

function startupStatus(value: unknown): "starting" | "ready" | "failed" | "cancelled" {
    return value === "starting" || value === "ready" || value === "failed" ? value : "cancelled";
}

function mcpInventory(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const server = item as Record<string, unknown>;
        const name = String(server.name || "");
        return name ? [{ name, authStatus: String(server.authStatus || "") || undefined }] : [];
    });
}

/** 使用当前操作系统的文件管理器定位本地文件。 */
function revealLocalFile(filePath: string, isDirectory: boolean) {
    const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer.exe" : "xdg-open";
    const args = process.platform === "darwin"
        ? ["-R", filePath]
        : process.platform === "win32"
            ? [isDirectory ? filePath : `/select,${filePath}`]
            : [isDirectory ? filePath : path.dirname(filePath)];
    return new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, { detached: true, stdio: "ignore" });
        child.once("spawn", () => {
            child.unref();
            resolve();
        });
        child.once("error", reject);
    });
}

/** 结合服务配置解析当前请求 URL。 */
function requestUrl(req: Request, config: CanvasAgentConfig) {
    return new URL(req.originalUrl || req.url || "/", config.url);
}

/** 设置跨域响应头并记录通过 token 授权的来源。 */
function setCors(req: Request, res: Response, url: URL, config: CanvasAgentConfig) {
    const origin = req.headers.origin;
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type,x-canvas-agent-token");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Private-Network", "true");
    if (!origin || req.method === "OPTIONS" || url.pathname === "/health" || url.pathname === "/config") return true;
    config.origins ||= [];
    if (validToken(req, url, config.token) && !config.origins.includes(origin)) {
        config.origins.push(origin);
        saveConfig(config);
    }
    res.setHeader("Vary", "Origin");
    return config.origins.includes(origin);
}

/** 校验请求查询参数或请求头中的连接 token。 */
function validToken(req: Request, url: URL, token: string) {
    const header = req.headers["x-canvas-agent-token"];
    return url.searchParams.get("token") === token || header === token || (Array.isArray(header) && header.includes(token));
}

