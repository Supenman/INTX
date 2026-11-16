/**
 * ModelScope 异步协议对传输层的适配（浏览器与桌面端共用一套出口）。
 *
 * 任务层的 `modelScope.ts` 只依赖 `ModelScopeTransport` 接口；这里把
 * `ProviderTransport` 包成它要的形状，再补上「上游图片下载成 dataUrl」。
 *
 * ModelScope 的 CORS 预检不允许 `X-ModelScope-Async-Mode`（2026-11-14 桌面版实测），
 * 所以桌面端必须走 Rust 侧的 `plugin-http`、不碰本地代理；这一点现在由
 * `ProviderTransport` 统一负责，这里不再自己判断平台。
 */
import { createProviderTransport } from "./provider-transport";
import type { ModelScopeTransport } from "@/services/generation";
import type { ChannelProxyMode } from "@/stores/use-config-store";

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取上游图片失败"));
        reader.readAsDataURL(blob);
    });
}

/**
 * 按渠道出网方式构造传输实现。
 * `proxyMode: "direct"` 时浏览器也直连上游，不套本地代理（配了系统级代理或支持 CORS 的上游可用）。
 */
export function createModelScopeTransport(proxyMode: ChannelProxyMode = "system"): ModelScopeTransport {
    const transport = createProviderTransport(proxyMode);
    return {
        async request(url, init) {
            // 非 2xx 不抛，交给任务层按 HTTP 状态归类（401/429/5xx 各有三态语义）
            const response = await transport.request({
                method: init.method,
                url,
                headers: init.headers,
                body: init.body,
                signal: init.signal,
            });
            return { ok: response.ok, status: response.status, json: response.json, text: response.text };
        },
        async fetchImage(url, signal) {
            return blobToDataUrl(await transport.blob({ method: "GET", url, signal }));
        },
    };
}

/** 默认（system）实现，保留给不关心渠道开关的调用点。 */
export const browserModelScopeTransport: ModelScopeTransport = createModelScopeTransport("system");
