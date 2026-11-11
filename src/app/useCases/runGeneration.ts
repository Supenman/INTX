import {
  applyAssetRefs,
  checkPrompt,
  checkRequiredInputs,
  localTextFor,
  parseAssetRefs,
  requireNodeDefinition,
  storyboardPrompt,
  createAsset,
  contentPath,
  estimateGenerationCost,
  extFromMime,
  normalizeError,
  parseGrid,
  resolvePrompt,
  sha256Hex,
  textInputPortId,
  unchangedAfterModeration,
  type Asset,
  type GeneratedItem,
  type GenerationRequest,
  type ProviderCapability,
  type ProviderConfig,
  type ProviderAdapter,
} from '@/domain';
import { attachAssets, useGraphStore } from '@/app/stores/graphStore';
import { markCanceled, markFailed, markPhase, markProgress, markRunning, markSucceeded, submitTask, latestTaskForNode, useTaskStore } from '@/app/stores/taskStore';
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

/** 读文本类资产的内容，供提示词内联。读不到返回 null，由调用方当缺失处理。 */
async function loadAssetText(assetId: string): Promise<string | null> {
  const loaded = await loadBytes(assetId);
  if (!loaded) return null;
  return new TextDecoder().decode(loaded.bytes);
}

/**
 * 产物已经拿到手，只是写不进本地磁盘。
 *
 * 单独一个类型是为了在 catch 里把它从「普通失败」里挑出来：这时上游已经按张
 * 计过费了，重试等于再买一张，所以不能给「可重试」这个结论。
 */
class MediaSaveError extends Error {
  constructor(cause: unknown) {
    super(`产物保存失败：${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'MediaSaveError';
  }
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

  try {
    await runtime.blobs.put(hash, item.bytes, item.mime);
  } catch (e) {
    throw new MediaSaveError(e);
  }
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
  const requiredPort = textInputPortId(node.defKind);
  const issues = checkRequiredInputs(
    node,
    requireNodeDefinition(node.defKind),
    {
      incomingEdgeCount: (target, port) =>
        Object.values(edges).filter((e) => e.target === target && e.targetPort === port).length,
    },
    // 生成节点的提示词可以自己写，不必非连线。分镜的 `script` 口只收上游。
    { localText: localTextFor(node) },
  );

  // 分镜节点的文本来自上游，不接受本地输入；其余节点两者都行
  const upstreamText = incoming(nodeId, requiredPort)
    .map((i) => i.text)
    .filter((t): t is string => typeof t === 'string')
    .join('\n');

  const rawPrompt = resolvePrompt(node, upstreamText);
  if (issues.length > 0) {
    return { ok: false, message: issues.map((i) => i.message).join('；') };
  }

  /**
   * 提示词里的 `@资产` 引用。
   *
   * 图片/视频进参考图，文本资产把内容内联进提示词，然后把 token 从文本里
   * 剥掉——厂商不认识这个语法，原样发过去只会变成一段噪音。
   *
   * 引用缺失时**直接失败**，不带病发请求。理由很实际：如果悄悄跳过，
   * 用户以为自己带了参考图，拿到一张毫不相干的产物，还得回头猜是模型
   * 不行还是自己写错了。报错至少指得准。
   */
  const assetRefs = parseAssetRefs(rawPrompt);
  let prompt = rawPrompt;
  let refAssetIds: string[] = [];
  if (assetRefs.length > 0) {
    const textBodies = new Map<string, string>();
    for (const ref of assetRefs) {
      const entry = useAssetStore.getState().assets[ref.assetId];
      if (entry?.asset.kind !== 'text') continue;
      const body = await loadAssetText(ref.assetId);
      if (body !== null) textBodies.set(ref.assetId, body);
    }
    const resolvedRefs = applyAssetRefs(rawPrompt, assetRefs, {
      kindOf: (id) => useAssetStore.getState().assets[id]?.asset.kind ?? null,
      textOf: (id) => textBodies.get(id) ?? null,
    });

    if (resolvedRefs.missing.length > 0) {
      const names = resolvedRefs.missing.map((r) => `「${r.label || r.assetId}」`).join('、');
      return {
        ok: false,
        message: `提示词里引用的资产已不存在：${names}。它可能被删除了，删掉这段引用或重新选一个。`,
      };
    }
    if (resolvedRefs.unsupported.length > 0) {
      const names = resolvedRefs.unsupported.map((r) => `「${r.label || r.assetId}」`).join('、');
      return { ok: false, message: `提示词里引用了暂不能作为参考素材的资产：${names}（目前支持图片、视频、文本）。` };
    }

    prompt = resolvedRefs.text;
    refAssetIds = resolvedRefs.imageAssetIds;

    // 只写了引用、没写描述：这时报「还没有提示词」会让人以为引用没生效。
    if (prompt.trim() === '' && refAssetIds.length > 0) {
      return { ok: false, message: '参考素材已经带上了，但还需要一句提示词说明你要什么' };
    }
  }

  const promptIssue = checkPrompt(prompt);
  if (promptIssue) {
    return { ok: false, message: promptIssue.message };
  }

  /**
   * 审核失败后一字未改地重发，等于把同一笔钱再花一次去换同一个拒绝。
   * 这里在本地拦下，而不是等上游跑一趟再失败——省的是真金白银，不是时间。
   */
  const previous = latestTaskForNode(useTaskStore.getState().tasks, nodeId);
  if (previous && unchangedAfterModeration(previous.error, previous.params.prompt, prompt)) {
    return {
      ok: false,
      message: '提示词和上次被审核拦下时一模一样，重发大概率还是同一张被拒的图。改一句再试。',
    };
  }

  const capability: ProviderCapability =
    node.defKind === 'storyboard' ? 'image' : capabilityOf(node.params as Record<string, unknown>);

  const configs = useProviderStore.getState().configs;
  const picked = pickModel(configs, capability, String(node.params.model ?? ''));
  if (!picked) {
    return { ok: false, message: `没有可用的「${capability}」模型，请先在设置里添加厂商` };
  }

  /**
   * 参考素材 = 连线 + 提示词里的 `@` 引用。
   *
   * 顺序有语义（第一张常被厂商当主参考图），所以连线排在前面：拖线是更
   * 明确的"我要这张当主参考"，`@` 是写在句子里的补充。两边重复引用同一张
   * 图只留一次，否则会白占一个参考槽。
   */
  const connectedRefIds = incoming(nodeId, 'reference')
    .map((i) => i.assetId)
    .filter((id): id is string => typeof id === 'string');
  const referenceAssetIds = [
    ...connectedRefIds,
    ...refAssetIds.filter((id) => !connectedRefIds.includes(id)),
  ];

  const refs = await Promise.all(referenceAssetIds.map((id) => loadBytes(id)));

  const count = node.defKind === 'storyboard' ? gridCount(String(node.params.grid ?? '2x2')) : 1;

  const taskId = submitTask({
    nodeId,
    kind: capability === 'text' ? 'text' : capability,
    params: {
      kind: capability === 'text' ? 'text' : capability,
      prompt,
      model: picked.modelId,
      providerId: picked.config.id,
      inputAssetIds: referenceAssetIds,
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

  /**
   * 已经拿到的产物。放在 try 外面是为了让 catch 也能看见：
   * 分镜逐格生成时第 3 格失败，前 2 格上游已经按张计过费，
   * 不能因为「这一单没跑完」就让它们连同节点一起消失。
   */
  const assets: Asset[] = [];

  try {
    markRunning(taskId);


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

    // 成本估算：按模型单价 × 本次产出数量。没配单价则 cost 为 null，绝不编 0。
    const spec = picked.config.models.find((m) => m.id === picked.modelId);
    const cost = estimateGenerationCost({
      pricing: spec?.pricing,
      kind: capability === 'text' ? 'text' : capability,
      outputCount: assets.length,
      modelId: picked.modelId,
      promptChars: prompt.length,
    });
    markSucceeded(taskId, assets.map((a) => a.id), cost);

    attachAssets(
      nodeId,
      assets.map((a) => a.id),
    );

    return { ok: true, taskId, assetIds: assets.map((a) => a.id) };
  } catch (e) {
    // 取消不是失败：走 canceled 终态，别把「用户主动停」记成一次错误
    if (controller.signal.aborted) {
      // 取消之前已经出的格子照样挂上去，不然那几张既花了钱又看不见
      if (assets.length > 0) attachAssets(nodeId, assets.map((a) => a.id));
      markCanceled(taskId);
      return { ok: false, taskId, message: CANCEL_MESSAGE };
    }

    // 部分成功：先把已出的挂上，再报错。顺序不能反——反了会闪一下空白
    if (assets.length > 0) attachAssets(nodeId, assets.map((a) => a.id));

    /**
     * 产物已出、只是没存下来。这条单独处理，因为它的重试不是「再试一次」
     * 而是「再买一张」，必须明确禁止。
     */
    if (e instanceof MediaSaveError) {
      const message = `上游已经出图了（这次已经计费），但存到本机失败。不要直接重试，那会再买一张；先清出磁盘空间。原始原因：${
        e.message
      }`;
      markFailed(taskId, { code: 'local_save_failed', message, retryable: false });
      return { ok: false, taskId, message };
    }

    /**
     * 带着当前阶段归一化：提交阶段的超时和生成阶段的超时不是一回事。
     * 不带阶段的话 `submission_uncertain` 永远不会被识别出来，用户还是会被
     * 引导去重试，扣两次钱。
     */
    const currentPhase = useTaskStore.getState().tasks[taskId]?.phase ?? null;
    const err = normalizeError(e, currentPhase);
    const partial = assets.length > 0 ? `（已经出的 ${assets.length} 张已保留在节点上）` : '';
    markFailed(taskId, { ...err, message: `${err.message}${partial}` });
    return { ok: false, taskId, message: `${err.message}${partial}` };
  }
}

/** 格数只问 domain 的 parseGrid，避免生成、提示词、导出各算一套。 */
export function gridCount(grid: string): number {
  return parseGrid(grid).total;
}

/** 节点当前任务的最近一次状态，用于 UI 判断能否再次点击。 */
export function busy(nodeId: string): boolean {
  const { tasks } = useTaskStore.getState();
  const list = Object.values(tasks).filter((t) => t.nodeId === nodeId);
  return list.some((t) => t.status === 'queued' || t.status === 'running');
}
