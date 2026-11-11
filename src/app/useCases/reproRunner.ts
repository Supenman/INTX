import {
  contentPath,
  createAsset,
  extFromMime,
  findByHash,
  type ReproAsset,
  type ReproPackage,
} from '@/domain';
import { resolveRuntime } from '@/infra/runtime';
import { addNode, connectNodes, setNodeAsset } from '@/app/stores/graphStore';
import { putAsset, useAssetStore } from '@/app/stores/assetStore';
import { runGeneration, type RunResult } from '@/app/useCases/runGeneration';

/**
 * 一键复现：把复现包里的资产落回本机，在画布上重建一次生成并重跑。
 *
 * 走的是和手动操作完全相同的执行链路（createAsset → blobs.put → putAsset →
 * runGeneration），不另开一条生成路径——这样复现出来的结果天然带审计台账、
 * 成本估算与持久化，和原生出图没有两样。
 */

function base64ToBytes(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** 把复现包里的一个资产落回本机；同哈希已存在就复用，不重复落盘。 */
async function landAsset(
  runtime: Awaited<ReturnType<typeof resolveRuntime>>,
  ref: ReproAsset,
  taskId: string,
): Promise<string | null> {
  if (!ref.bytesB64) return null;
  const assets = Object.values(useAssetStore.getState().assets).map((e) => e.asset);
  const existing = findByHash(assets, ref.hash);
  if (existing) return existing.id;

  const bytes = base64ToBytes(ref.bytesB64);
  const path = contentPath(ref.hash, extFromMime(ref.mime));
  const created = createAsset({
    mime: ref.mime,
    hash: ref.hash,
    bytes: bytes.byteLength,
    path,
    origin: { type: 'task', taskId },
  });
  if (!created.ok) return null;
  await runtime.blobs.put(ref.hash, bytes, ref.mime);
  putAsset({ asset: created.value, blobKey: ref.hash });
  return created.value.id;
}

/**
 * 执行一次复现。返回与原生生成一致的 RunResult。
 * 失败（资产缺失/无可用厂商）由 runGeneration 负责给出人话错误消息。
 */
export async function runReproPackage(pkg: ReproPackage): Promise<RunResult> {
  const runtime = await resolveRuntime();

  // 1) 参考图落盘并建素材节点
  const refNodeIds: string[] = [];
  for (let i = 0; i < pkg.references.length; i += 1) {
    const assetId = await landAsset(runtime, pkg.references[i]!, pkg.taskId);
    if (!assetId) continue;
    const nid = addNode({
      defKind: 'asset',
      position: { x: 40, y: 60 + refNodeIds.length * 320 },
      params: { caption: '复现参考' },
    });
    setNodeAsset(nid, assetId);
    refNodeIds.push(nid);
  }

  // 2) 重建生成节点，参数原样回填
  const genId = addNode({
    defKind: 'generate',
    position: { x: 440, y: 60 },
    params: {
      prompt: pkg.params.prompt,
      outputKind: pkg.params.kind,
      aspectRatio: pkg.params.aspectRatio ?? '1:1',
      model: pkg.params.model,
    },
  });

  // 3) 把参考素材接到生成节点的 reference 口
  for (const nid of refNodeIds) {
    connectNodes({
      sourceNodeId: nid,
      sourcePortId: 'out',
      targetNodeId: genId,
      targetPortId: 'reference',
    });
  }

  // 4) 走原生执行链路
  return runGeneration(genId);
}
