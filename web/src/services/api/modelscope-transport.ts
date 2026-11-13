/**
 * ModelScope 异步协议在浏览器里的传输实现（axios + 本地代理 + 下载转 dataUrl）。
 *
 * 桌面端（Tauri）改走 `@tauri-apps/plugin-http`：请求由 Rust 侧发出，
 * 没有浏览器 CORS 预检。ModelScope 的预检不允许 `X-ModelScope-Async-Mode`，
 * WebView 直连一定会被拦（2026-11-14 桌面版实测），所以桌面端不碰本地代理。
 *
 * 任务层的 `modelScope.ts` 只依赖 `ModelScopeTransport` 接口，不碰 axios；
 * 这里是唯一的真实 IO 实现，单独成文件，不往 942 行的 image.ts 里堆。
 */
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import axios from "axios";

import { withLocalProxy } from "@/stores/use-config-store";
import type { ModelScopeTransport, TransportResponse } from "@/services/generation";

/** 桌面壳注入的标记；浏览器里不存在。 */
const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function toResponse(status: number, data: unknown): TransportResponse {
    const text = typeof data === "string" ? data : JSON.stringify(data ?? "");
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => (typeof data === "string" ? JSON.parse(data) : data),
        text: async () => text,
    };
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取上游图片失败"));
        reader.readAsDataURL(blob);
    });
}

export const browserModelScopeTransport: ModelScopeTransport = {
    async request(url, init) {
        if (inTauri) {
            const response = await tauriFetch(url, {
                method: init.method,
                headers: init.headers,
                body: init.body,
                signal: init.signal,
            });
            const text = await response.text();
            let data: unknown = text;
            try {
                data = JSON.parse(text);
            } catch {
                // 保留原文，错误信息里还能看到厂商返回的纯文本
            }
            return toResponse(response.status, data);
        }
        const response = await axios.request({
            url: withLocalProxy(url),
            method: init.method,
            headers: init.headers,
            data: init.body,
            signal: init.signal,
            // 非 2xx 不抛，交给任务层按 HTTP 状态归类（401/429/5xx 各有三态语义）
            validateStatus: () => true,
        });
        return toResponse(response.status, response.data);
    },
    async fetchImage(url, signal) {
        if (inTauri) {
            const response = await tauriFetch(url, { signal });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return blobToDataUrl(await response.blob());
        }
        const response = await axios.get<Blob>(withLocalProxy(url), { responseType: "blob", signal });
        return blobToDataUrl(response.data);
    },
};
