import {
  contentPath,
  createAsset,
  extFromMime,
  findByHash,
  type ProviderCapability,
  type ReproAsset,
  type ReproPackage,
} from '@/domain';
import { resolveRuntime } from '@/infra/runtime';
import { addNode, connectNodes, setNodeAsset } from '@/app/stores/graphStore';
import { putAsset, useAssetStore } from '@/app/stores/assetStore';
import { useProviderStore } from '@/app/stores/providerStore';
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
 *
 * 厂商校验放在最前面，原因是一个很难察觉的静默错误：
 * `runGeneration` 只按**模型名**挑厂商（`pickModel` 的 preferred 参数是模型 id），
 * `params.providerId` 根本没被用到。于是复现包在另一台机器上打开时，
 * 只要本机碰巧有同名模型（例如大家都配了 `gpt-image-1`），
 * 就会用**别的厂商**出图，而且审计台账里记的也是那个错厂商——
 * 「复现」悄悄变成了「用我的号重跑一遍」，提示词可能去了不该去的地方。
 *
 * 所以：原厂商不存在就直接拒绝并说清楚，不做任何猜测性替换。
 */
export async function runReproPackage(pkg: ReproPackage): Promise<RunResult> {
  const { configs } = useProviderStore.getState();
  const original = configs.find((c) => c.id === pkg.params.providerId);
  if (!original) {
    const known = configs.map((c) => c.id).join('、') || '无';
    return {
      ok: false,
      message: `复现包用的是厂商「${pkg.params.providerId}」，本机没有这个配置（现有：${known}）。先在设置里添加同名 id 的厂商，避免用别的厂商误跑。`,
    };
  }
  const hasModel = original.models.some(
    (m) => m.id === pkg.params.model && m.capabilities.includes(pkg.params.kind as ProviderCapability),
  );
  if (!hasModel) {
    return {
      ok: false,
      message: `厂商「${original.name}」下找不到可做「${pkg.params.kind}」的模型 ${pkg.params.model}，请先在设置里补上。`,
    };
  }

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

  // 2) 重建上游文字节点。
  //    坑就在这：生成节点的 `prompt` 口是 required，而 checkRequiredInputs 只看
  //    「有没有连线」，完全不认 params.prompt。只回填参数、建一个孤立的生成节点，
  //    会被自己的校验拦住——点了没反应，连任务都不会建，所以审计台账里也不会留痕，
  //    看起来像"复现成功了但什么都没发生"。原生拓扑本来就是「文字 → 生成」，
  //    照原样重建才是真正的复现。
  const textId = addNode({
    defKind: 'text-input',
    position: { x: 40, y: 60 + refNodeIds.length * 320 },
    params: { content: pkg.params.prompt },
  });

  // 3) 重建生成节点，参数原样回填
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

  connectNodes({
    sourceNodeId: textId,
    sourcePortId: 'text',
    targetNodeId: genId,
    targetPortId: 'prompt',
  });

  // 4) 把参考素材接到生成节点的 reference 口
  for (const nid of refNodeIds) {
    connectNodes({
      sourceNodeId: nid,
      sourcePortId: 'out',
      targetNodeId: genId,
      targetPortId: 'reference',
    });
  }

  // 5) 走原生执行链路
  return runGeneration(genId);
}
