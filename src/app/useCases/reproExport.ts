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

/** 为某个任务导出复现包并触发下载。返回是否成功（任务或资产缺失则 false）。 */
export async function exportReproForTask(taskId: string): Promise<boolean> {
  const task = useTaskStore.getState().tasks[taskId];
  if (!task) return false;
  const runtime = await resolveRuntime();

  const results = (
    await Promise.all(task.resultAssetIds.map((id) => loadReproAsset(runtime, id)))
  ).filter((a): a is ReproAsset => a !== null);
  const references = (
    await Promise.all(task.params.inputAssetIds.map((id) => loadReproAsset(runtime, id)))
  ).filter((a): a is ReproAsset => a !== null);

  const pkg = buildReproPackage({ taskId, params: task.params, references, results });
  const json = JSON.stringify(pkg, null, 2);
  downloadBytes(new TextEncoder().encode(json).buffer, 'application/json', `intx-repro-${taskId}.json`);
  return true;
}
