/**
 * 厂商请求的统一出口（M2.5 第②项）。
 *
 * 桌面端走 `@tauri-apps/plugin-http`：请求由 Rust 侧发出，没有浏览器 CORS 预检，
 * 也不经过本地代理。浏览器端走原生 fetch + 本地代理，只用于开发与自动检查。
 * 厂商层只依赖这里的 `ProviderTransport`，不再直接 import axios / fetch / @tauri-apps。
 *
 * 重试只对 GET 生效：最多 2 次，间隔 1s → 2s，且只重试连接类失败与 502/503/504。
 * POST 一律不重试——请求可能已经到达厂商，就是可能已收单/已计费的单子，
 * 只能交给任务层按三态判 confirm，不能在传输层擅自重发。
 */
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

import { runtime } from "@/lib/runtime/capabilities";
import { withLocalProxy, type ChannelProxyMode } from "@/stores/use-config-store";

/** 一次请求的描述。url 是完整厂商地址，本地代理前缀由实现按出网方式加。 */
export interface ProviderRequest {
    method: "GET" | "POST";
    url: string;
    headers?: Record<string, string>;
    /** 字符串或 FormData。用 FormData 时不要自己写 Content-Type，boundary 由浏览器补。 */
    body?: string | FormData;
    signal?: AbortSignal;
    /** 调用方自己的超时；不传就沿用各调用点原来的行为，这里不发明默认值。 */
    timeoutMs?: number;
    /** 缓存策略，默认按浏览器/WebView 默认行为。提示词源用 "no-store" 保证每次拿最新列表。 */
    cache?: RequestCache;
}

/** HTTP 响应的最小视图，便于注入与测试。 */
export interface ProviderResponse {
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
    text(): Promise<string>;
}

/**
 * 失败类型。`network` / `aborted` / `timeout` 都是没拿到 HTTP 响应；
 * `http` 只出现在 `blob()` 上——它没有 `ProviderResponse` 可以带状态码回来。
 */
export type TransportFailure = "aborted" | "timeout" | "network" | "http";

export class ProviderTransportError extends Error {
    readonly kind: TransportFailure;
    readonly status?: number;

    constructor(kind: TransportFailure, message: string, status?: number) {
        super(message);
        this.name = "ProviderTransportError";
        this.kind = kind;
        this.status = status;
    }
}

/** HTTP 有响应但状态非 2xx。调用方通常拿 status 决定提示与三态。 */
export class ProviderHttpError extends Error {
    readonly status: number;

    constructor(status: number, message: string) {
        super(message);
        this.name = "ProviderHttpError";
        this.status = status;
    }
}

/**
 * 非 2xx 直接抛。各厂商错误体不同，正文到文案的翻译由调用方传进来，
 * 传输层只负责保留状态码。
 */
export async function assertProviderOk(response: ProviderResponse, readMessage: (text: string) => string) {
    if (response.ok) return;
    throw new ProviderHttpError(response.status, readMessage(await response.text()));
}

export interface ProviderTransport {
    request(request: ProviderRequest): Promise<ProviderResponse>;
    /** 流式响应原样返回，body 可读；SSE 分帧留给调用方。 */
    stream(request: ProviderRequest): Promise<Response>;
    /** 下载二进制（视频/图片成品）。非 2xx 抛 `ProviderTransportError("http")`。 */
    blob(request: ProviderRequest): Promise<Blob>;
}

const RETRY_DELAYS_MS = [1_000, 2_000];
const RETRYABLE_STATUS = new Set([502, 503, 504]);

function sleep(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(new ProviderTransportError("aborted", "request aborted"));
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(new ProviderTransportError("aborted", "request aborted"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

/**
 * 发一次请求。调用方 signal 与内部超时合并成一个 controller，
 * 这样两端实现（plugin-http / fetch）共用同一套取消语义。
 */
async function send(request: ProviderRequest, proxyMode: ChannelProxyMode): Promise<Response> {
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort();
    if (request.signal?.aborted) controller.abort();
    else request.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = request.timeoutMs
        ? setTimeout(() => {
              timedOut = true;
              controller.abort();
          }, request.timeoutMs)
        : undefined;
    try {
        const init: RequestInit = { method: request.method, headers: request.headers, body: request.body, signal: controller.signal, cache: request.cache };
        if (runtime === "desktop") return await tauriFetch(request.url, init);
        return await fetch(withLocalProxy(request.url, proxyMode), init);
    } catch (error) {
        if (error instanceof ProviderTransportError) throw error;
        const kind: TransportFailure = timedOut ? "timeout" : controller.signal.aborted ? "aborted" : "network";
        throw new ProviderTransportError(kind, error instanceof Error ? error.message : String(error));
    } finally {
        if (timer) clearTimeout(timer);
        request.signal?.removeEventListener("abort", onAbort);
    }
}

async function toResponse(response: Response): Promise<ProviderResponse> {
    const text = await response.text();
    let data: unknown = text;
    try {
        data = JSON.parse(text);
    } catch {
        // 非 JSON 响应（HTML 错误页等）按原文返回，和 axios 的默认转换一致。
    }
    return {
        ok: response.ok,
        status: response.status,
        json: async () => data,
        text: async () => text,
    };
}

/**
 * 按渠道出网方式构造传输实现。
 * `proxyMode: "direct"` 时浏览器也直连上游；桌面端始终直连，不受全局代理开关影响。
 */
export function createProviderTransport(proxyMode: ChannelProxyMode = "system"): ProviderTransport {
    /** 只有 GET 敢重发：POST 可能已经收单，重发就是重复下单。 */
    async function fetchWithRetry(request: ProviderRequest) {
        const attempts = request.method === "GET" ? RETRY_DELAYS_MS.length + 1 : 1;
        for (let index = 0; ; index++) {
            try {
                const response = await send(request, proxyMode);
                if (!RETRYABLE_STATUS.has(response.status) || index + 1 >= attempts) return response;
                // 重试前释放这一轮的响应体，别把连接挂在未读完的流上。
                void response.body?.cancel().catch(() => {});
            } catch (error) {
                if (index + 1 >= attempts || !(error instanceof ProviderTransportError) || error.kind !== "network") throw error;
            }
            await sleep(RETRY_DELAYS_MS[index], request.signal);
        }
    }

    return {
        async request(request) {
            return toResponse(await fetchWithRetry(request));
        },
        async stream(request) {
            return send(request, proxyMode);
        },
        async blob(request) {
            const response = await fetchWithRetry(request);
            if (response.ok) return response.blob();
            const text = await response.text();
            throw new ProviderTransportError("http", text.slice(0, 300), response.status);
        },
    };
}
