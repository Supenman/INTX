/**
 * 读取本地或已落地媒体的字节：`data:`、`blob:`、本地存储地址。
 *
 * 这些不是厂商请求，不能走 `ProviderTransport`——桌面端把 data URL 丢给 Rust 侧
 * 没有意义，blob: 地址也只在 WebView 里有效。
 */
export function readLocalBlob(url: string, signal?: AbortSignal) {
    return fetch(url, { signal }).then((response) => response.blob());
}
