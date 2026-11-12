import type { GeneratedItem, GenerationHandlers } from '@/domain';

/**
 * 适配器共用的 HTTP 小工具。
 *
 * 单独成文件是为了让「同步适配器」和「异步查单」都能用同一套取图逻辑，
 * 又不必互相 import 形成循环依赖：openaiCompatible / modelScope /
 * modelScopeTask 都是这里的下游，谁也不回头依赖谁。
 */

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/** 从响应里抽出人能看懂的错。不要把整段 HTML 错误页塞进任务里。 */
export async function failure(res: Response): Promise<Error> {
  let detail = '';
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
      detail =
        typeof json.error === 'string'
          ? json.error
          : json.error?.message ?? json.message ?? text.slice(0, 300);
    } catch {
      detail = text.slice(0, 300);
    }
  } catch {
    detail = res.statusText;
  }
  return new Error(`HTTP ${res.status} ${detail}`.trim());
}

export function fromBase64(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** data URL 与远程 URL 都要能处理：有的服务只回 b64，有的只回链接。 */
export async function materialize(
  item: { b64_json?: string; url?: string },
  signal: AbortSignal,
  handlers: GenerationHandlers,
): Promise<GeneratedItem> {
  if (item.b64_json) {
    return { mime: 'image/png', bytes: fromBase64(item.b64_json) };
  }
  if (!item.url) throw new Error('上游既没返回图片数据也没返回链接');

  handlers.onPhase?.('downloading');
  handlers.onProgress?.(null);
  const res = await fetch(item.url, { signal });
  if (!res.ok) throw await failure(res);
  return {
    mime: res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png',
    bytes: await res.arrayBuffer(),
    sourceUrl: item.url,
  };
}
