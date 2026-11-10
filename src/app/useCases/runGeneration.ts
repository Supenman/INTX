import {
  checkPrompt,
  checkRequiredInputs,
  requireNodeDefinition,
  storyboardPrompt,
  createAsset,
  contentPath,
  extFromMime,
  normalizeError,
  resolvePrompt,
  sha256Hex,
  type Asset,
  type GeneratedItem,
  type GenerationRequest,
  type ProviderCapability,
  type ProviderConfig,
  type ProviderAdapter,
} from '@/domain';
import { attachAssets, useGraphStore } from '@/app/stores/graphStore';
import { markCanceled, markFailed, markPhase, markProgress, markRunning, markSucceeded, submitTask, useTaskStore } from '@/app/stores/taskStore';
import { findAssetByHash, putAsset, useAssetStore } from '@/app/stores/assetStore';
import { useProviderStore, pickModel } from '@/app/stores/providerStore';
import { adapterFor } from '@/infra/provider';
import { resolveRuntime } from '@/infra/runtime';

/**
 * 真实生成用例。
 *
 * 这是整个 S3 的核心：把「画布上的一次点击」翻译成一次可追溯的任务。
 *
 * 顺序很重要，且每一段失败都有明确的用户可见后果：
 *  1. 读上游连线 → 组装参考图与文本（缺什么就报哪个口）
 *  2. 校验必填与提示词（提交前，不发给厂商）
 *  3. 冻结参数快照（之后用户怎么改节点都不影响这次生成）
 *  4. 选厂商与模型（能力自述，不猜名字）
 *  5. 调适配器，逐事件写任务状态
 *  6. 产物按内容哈希落盘，同图不存第二份
 *  7. 节点记住产物 assetId，画布直接渲染
 */

export const CANCEL_MESSAGE = '已取消生成';

export interface RunResult {
  ok: boolean;
  taskId?: string;
  assetIds?: string[];
  /** 用户可读的失败原因（已分类） */
  message?: string;
}

/** 从图里收集某个节点的某一类输入。 */
function incoming(nodeId: string, portId: string): { nodeId: string; assetId?: string; text?: string }[] {
  const { edges, nodes } = useGraphStore.getState();
  const out: { nodeId: string; assetId?: string; text?: string }[] = [];
  for (const e of Object.values(edges)) {
    if (e.target !== nodeId || e.targetPort !== portId) continue;
    const src = nodes[e.source];
    if (!src) continue;
    const text = typeof src.params.content === 'string' ? src.params.content : undefined;
    out.push({ nodeId: src.id, ...(src.assetId ? { assetId: src.assetId } : {}), ...(text ? { text } : {}) });
  }
  return out;
}

async function loadBytes(assetId: string): Promise<{ mime: string; bytes: ArrayBuffer } | null> {
  const entry = useAssetStore.getState().assets[assetId];
  if (!entry) return null;
  const runtime = await resolveRuntime();
  const bytes = await runtime.blobs.get(entry.blobKey);
  if (!bytes) return null;
  return { mime: entry.asset.mime, bytes };
}

/** 把产物写进资产库。同哈希直接复用，返回已有 assetId。 */
async function persistItem(item: GeneratedItem, taskId: string): Promise<Asset> {
  const runtime = await resolveRuntime();
  const hash = await sha256Hex(item.bytes);

  const existing = findAssetByHash(hash);
  if (existing) return existing.asset;

  const ext = extFromMime(item.mime);
  const path = contentPath(hash, ext);

  const created = createAsset({
    mime: item.mime,
    hash,
    bytes: item.bytes.byteLength,
    path,
    origin: { type: 'task', taskId },
  });
  if (!created.ok) throw new Error(created.error.message);

  await runtime.blobs.put(hash, item.bytes, item.mime);
  putAsset({ asset: created.value, blobKey: hash });
  return created.value;
}

/** 生成节点的能力：看参数里选的产出类型。 */
function capabilityOf(params: Record<string, unknown>): ProviderCapability {
  const k = params.outputKind;
  return k === 'video' ? 'video' : k === 'text' ? 'text' : 'image';
}

export async function runGeneration(
  nodeId: string,
  registerAbort?: (signal: AbortController) => void,
): Promise<RunResult> {
  const node = useGraphStore.getState().nodes[nodeId];
  if (!node) return { ok: false, message: '节点不存在' };

  const edges = useGraphStore.getState().edges;
  const requiredPort = node.defKind === 'storyboard' ? 'script' : 'prompt';
  const issues = checkRequiredInputs(node, requireNodeDefinition(node.defKind), {
    incomingEdgeCount: (target, port) =>
      Object.values(edges).filter((e) => e.target === target && e.targetPort === port).length,
  });

  // 分镜节点的文本来自上游，不接受本地输入；其余节点两者都行
  const upstreamText = incoming(nodeId, requiredPort)
    .map((i) => i.text)
    .filter((t): t is string => typeof t === 'string')
    .join('\n');

  const prompt = resolvePrompt(node, upstreamText);
  const promptIssue = checkPrompt(prompt);

  if (issues.length > 0) {
    return { ok: false, message: issues.map((i) => i.message).join('；') };
  }
  if (promptIssue) {
    return { ok: false, message: promptIssue.message };
  }

  const capability: ProviderCapability =
    node.defKind === 'storyboard' ? 'image' : capabilityOf(node.params as Record<string, unknown>);

  const configs = useProviderStore.getState().configs;
  const picked = pickModel(configs, capability, String(node.params.model ?? ''));
  if (!picked) {
    return { ok: false, message: `没有可用的「${capability}」模型，请先在设置里添加厂商` };
  }

  // 参考图：generate 用 reference 口，分镜用 reference 口（角色参考）
  const refs = await Promise.all(
    incoming(nodeId, 'reference')
      .map((i) => i.assetId)
      .filter((id): id is string => typeof id === 'string')
      .map((id) => loadBytes(id)),
  );

  const count = node.defKind === 'storyboard' ? gridCount(String(node.params.grid ?? '2x2')) : 1;

  const taskId = submitTask({
    nodeId,
    kind: capability === 'text' ? 'text' : capability,
    params: {
      kind: capability === 'text' ? 'text' : capability,
      prompt,
      model: picked.modelId,
      providerId: picked.config.id,
      inputAssetIds: incoming(nodeId, 'reference')
        .map((i) => i.assetId)
        .filter((id): id is string => typeof id === 'string'),
      aspectRatio: String(node.params.aspectRatio ?? '1:1'),
      ...(node.defKind === 'storyboard' ? { extras: { grid: String(node.params.grid ?? '2x2') } } : {}),
    },
  });

  useGraphStore.setState((s) => {
    const n = s.nodes[nodeId];
    if (n) n.lastTaskId = taskId;
  });

  const controller = new AbortController();
  registerAbort?.(controller);

  const request: GenerationRequest = {
    capability,
    model: picked.modelId,
    prompt,
    referenceImages: refs.filter((r): r is { mime: string; bytes: ArrayBuffer } => r !== null),
    ...(node.params.aspectRatio ? { aspectRatio: String(node.params.aspectRatio) } : {}),
    count,
    signal: controller.signal,
  };

  const adapter: ProviderAdapter = adapterFor(picked.config);
  const config: ProviderConfig = picked.config;
  const aspectRatio = String(node.params.aspectRatio ?? '1:1');

  try {
    markRunning(taskId);

    const assets: Asset[] = [];

    if (node.defKind === 'storyboard') {
      /**
       * 分镜逐格生成。
       *
       * 为什么不一次要 N 张：一次出 9 张的接口很罕见，而且一张失败就全废。
       * 逐格还能拿到**真实进度**（第 3/9 格是确定的事实，不是编的百分比），
       * 这恰好对应"有真进度就别假装不确定"这条设计。
       */
      const grid = String(node.params.grid ?? '2x2');
      const style = String(node.params.style ?? '');
      const total = gridCount(grid);
      const refImages = refs.filter((r): r is { mime: string; bytes: ArrayBuffer } => r !== null);

      for (let cell = 0; cell < total; cell += 1) {
        markPhase(taskId, 'generating');
        markProgress(taskId, cell / total);
        const items = await adapter.generate(
          config,
          {
            capability: 'image',
            model: picked.modelId,
            prompt: storyboardPrompt(prompt, grid, style, cell, total),
            referenceImages: refImages,
            aspectRatio,
            count: 1,
            signal: controller.signal,
          },
          { onPhase: () => {}, onProgress: () => {} },
        );
        for (const item of items) assets.push(await persistItem(item, taskId));
        markProgress(taskId, (cell + 1) / total);
      }
    } else {
      const items = await adapter.generate(config, request, {
        onPhase: (p) => markPhase(taskId, p),
        onProgress: (v) => markProgress(taskId, v),
      });
      markPhase(taskId, 'downloading');
      for (const item of items) assets.push(await persistItem(item, taskId));
    }

    if (assets.length === 0) throw new Error('上游没有返回可用的产物');
    markSucceeded(taskId, assets.map((a) => a.id));

    attachAssets(
      nodeId,
      assets.map((a) => a.id),
    );

    return { ok: true, taskId, assetIds: assets.map((a) => a.id) };
  } catch (e) {
    // 取消不是失败：走 canceled 终态，别把「用户主动停」记成一次错误
    if (controller.signal.aborted) {
      markCanceled(taskId);
      return { ok: false, taskId, message: CANCEL_MESSAGE };
    }
    const err = normalizeError(e);
    markFailed(taskId, err);
    return { ok: false, taskId, message: err.message };
  }
}

export function gridCount(grid: string): number {
  const m = /^(\d+)x(\d+)$/.exec(grid);
  if (!m) return 1;
  return Math.max(1, Math.min(16, Number(m[1]) * Number(m[2])));
}

/** 节点当前任务的最近一次状态，用于 UI 判断能否再次点击。 */
export function busy(nodeId: string): boolean {
  const { tasks } = useTaskStore.getState();
  const list = Object.values(tasks).filter((t) => t.nodeId === nodeId);
  return list.some((t) => t.status === 'queued' || t.status === 'running');
}
