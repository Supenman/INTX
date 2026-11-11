import { buildReproPackage, type ReproAsset } from '@/domain';
import { resolveRuntime } from '@/infra/runtime';
import { useAssetStore } from '@/app/stores/assetStore';
import { useTaskStore } from '@/app/stores/taskStore';
import { downloadBytes } from '@/ui/common/download';

/**
 * 导出复现包。
 *
 * 把一次成功生成「原样可重跑」所需的一切打进一个自包含 JSON：
 * 冻结的参数快照 + 结果图字节 + 参考图字节（base64 内联）。
 * 别人拿到文件，点一下就能在另一台机器上重跑出同样的图。
 */

function bytesToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

async function loadReproAsset(runtime: Awaited<ReturnType<typeof resolveRuntime>>, assetId: string): Promise<ReproAsset | null> {
  const entry = useAssetStore.getState().assets[assetId];
  if (!entry) return null;
  const key = entry.blobKey ?? entry.asset.hash;
  const bytes = await runtime.blobs.get(key);
  if (!bytes) return null;
  return { hash: entry.asset.hash, mime: entry.asset.mime, bytesB64: bytesToBase64(bytes) };
}

/**
 * 为某个任务导出复现包并触发下载。
 *
 * 返回 null 表示成功，否则返回失败原因。
 *
 * 关于参考图顺序：`params.inputAssetIds` 的顺序是有语义的（第一张常被厂商当主参考图）。
 * 早期实现在字节缺失时用 `.filter(a => a !== null)` 丢掉那项——结果数组被压缩，
 * 后面的图整体前移，复现出来是「张冠李戴」，而且没有任何提示。
 * 所以这里改成：任一参考图字节缺失就整包失败并说明缺哪张，宁可不导出也不导出一个错的。
 */
export async function exportReproForTask(taskId: string): Promise<string | null> {
  const task = useTaskStore.getState().tasks[taskId];
  if (!task) return '找不到该任务';
  const runtime = await resolveRuntime();

  const results = await Promise.all(task.resultAssetIds.map((id) => loadReproAsset(runtime, id)));
  const lostResult = results.findIndex((r) => r === null);
  if (lostResult >= 0) {
    return `第 ${lostResult + 1} 张产物的文件已丢失，无法打包（可用「重新生成」补上）`;
  }

  const references = await Promise.all(task.params.inputAssetIds.map((id) => loadReproAsset(runtime, id)));
  const lostRef = references.findIndex((r) => r === null);
  if (lostRef >= 0) {
    return `第 ${lostRef + 1} 张参考图的文件已丢失，打包会让后续参考图错位，已中止`;
  }

  const pkg = buildReproPackage({
    taskId,
    params: task.params,
    references: references as ReproAsset[],
    results: results as ReproAsset[],
  });
  const json = JSON.stringify(pkg, null, 2);
  downloadBytes(new TextEncoder().encode(json).buffer, 'application/json', `intx-repro-${taskId}.json`);
  return null;
}
