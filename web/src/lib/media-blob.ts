/**
 * 读取本地或已落地媒体的字节：`data:`、`blob:`、本地存储地址。
 *
 * 这些不是厂商请求，不能走 `ProviderTransport`——桌面端把 data URL 丢给 Rust 侧
 * 没有意义，blob: 地址也只在 WebView 里有效。
 */
export function readLocalBlob(url: string, signal?: AbortSignal) {
    return fetch(url, { signal }).then((response) => response.blob());
}

/** 判断是否指向本机服务（ComfyUI 网关/Agent）。这类地址下载失败是真失败，不能退回直链。 */
export function isLocalGatewayUrl(url: string) {
    try {
        const parsed = new URL(url);
        return /^https?:$/.test(parsed.protocol) && ["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname);
    } catch {
        return false;
    }
}

/**
 * 视频节点里存了 content 但没有落地 storageKey，且 content 是本机网关地址 —— 这是历史版本
 * 吞掉下载错误留下的坏节点（黑屏 0:00）。它必须被视为"可恢复"，否则用户没有任何重试入口。
 */
export function isBrokenVideoContent(metadata?: { content?: string; storageKey?: string }) {
    return Boolean(metadata?.content && !metadata?.storageKey && isLocalGatewayUrl(metadata.content));
}
