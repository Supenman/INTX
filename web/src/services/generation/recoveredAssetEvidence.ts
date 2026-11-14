/**
 * 2.2c-1 / 2.2c-2 已取回素材证据。
 *
 * 查单取回的产物写入媒体 store 后，进程可能崩溃：
 *  - 2.2c-1（阶段 B）：素材元数据已确认、任务台账未核销 → 重启后只补写任务记录。
 *  - 2.2c-2（阶段 A）：Blob 已写入、素材元数据未确认 → 重启后用**已经下载好的
 *    Blob**补建素材，再补写任务记录；不重新查单、不重新下载、不产生孤儿文件。
 *
 * 它只缩小崩溃窗口，不承诺零窗口，也不是跨集合原子事务：证据写失败时仍只保留
 * 当前进程内存证据。复用 2.2b 的库与对象仓库，不新建 object store。
 */
import localforage from 'localforage';

import type { Asset } from '@/application/persistence/types';

const PREFIX = 'infinite-canvas:intx_recovered_assets:';

export type AssetDraft = Omit<Asset, 'id' | 'createdAt' | 'updatedAt'>;

/** 阶段 A：补建一个素材所需的全部信息，全部来自本机已有数据，不含大 Blob。 */
export interface RecoveredAssetDraft {
  /** 原素材 id，仅用于「是否已存在」的幂等检查；补建时会生成新 id。 */
  assetId: string;
  asset: AssetDraft;
}

export interface RecoveredAssetEvidence {
  taskId: string;
  upstreamRef: string;
  /** 阶段 B：素材元数据已确认保存的素材 id；阶段 A 时为空数组。 */
  assetIds: string[];
  /** 阶段 A：待补建的素材草稿；阶段 B 不带该字段。两阶段互斥。 */
  drafts?: RecoveredAssetDraft[];
  savedAt: number;
}

export interface RecoveredAssetEvidenceStore {
  put(evidence: RecoveredAssetEvidence): Promise<void>;
  list(): Promise<RecoveredAssetEvidence[]>;
  remove(taskId: string): Promise<void>;
}

const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const ids = (v: unknown): v is string[] => Array.isArray(v) && v.every((id) => typeof id === 'string' && Boolean(id));

function parseDraft(value: unknown): RecoveredAssetDraft | null {
  if (!record(value)) return null;
  const { assetId, asset } = value;
  if (typeof assetId !== 'string' || !assetId || !record(asset)) return null;
  if (typeof asset.kind !== 'string' || !['image', 'video', 'text'].includes(asset.kind)) return null;
  if (typeof asset.title !== 'string' || !record(asset.data)) return null;
  if (typeof asset.data.storageKey !== 'string' || !asset.data.storageKey) return null;
  return value as unknown as RecoveredAssetDraft;
}

/** 损坏证据不能当成「没有证据」——那会把已取回的产物重新查一遍、再建一份素材。 */
export function parseRecoveredAssetEvidence(value: unknown): RecoveredAssetEvidence | null {
  if (!record(value)) return null;
  const { taskId, upstreamRef, assetIds, drafts, savedAt } = value;
  if (typeof taskId !== 'string' || !taskId) return null;
  if (typeof upstreamRef !== 'string' || !upstreamRef) return null;
  if (!ids(assetIds)) return null;
  if (!finite(savedAt)) return null;
  // 旧格式（2.2c-1）只有非空 assetIds；新格式的阶段 A 只有非空 drafts。
  if (drafts === undefined) return assetIds.length ? value as unknown as RecoveredAssetEvidence : null;
  if (!Array.isArray(drafts) || !drafts.length || assetIds.length) return null;
  const parsed = drafts.map(parseDraft);
  if (parsed.some((draft) => draft === null)) return null;
  return { ...(value as unknown as RecoveredAssetEvidence), drafts: parsed as RecoveredAssetDraft[] };
}

/**
 * 从素材库里按 id 取出刚创建的素材，剥掉运行时字段；缺一个或没有本地 storageKey
 * 就整体退回，不落半份证据。没有 storageKey 的产物只是远程 URL 引用，落证据再补建
 * 可能引用过期地址；这种情形退回 2.2c-1（确认素材元数据后再落阶段 B），重启后
 * 重新查单不扣费，比静默建出坏素材安全。
 */
export function assetDrafts(assets: readonly Asset[], assetIds: readonly string[]): RecoveredAssetDraft[] {
  const out: RecoveredAssetDraft[] = [];
  for (const id of assetIds) {
    const found = assets.find((asset) => asset.id === id);
    // 文本素材的 data 没有 storageKey；先用 in 收窄联合类型再取属性。
    if (!found || !('storageKey' in found.data) || typeof found.data.storageKey !== 'string' || !found.data.storageKey) return [];
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = found;
    out.push({ assetId: id, asset: rest as AssetDraft });
  }
  return out;
}

/**
 * 重启后的补建计划：与 drafts 同序，null 表示需要 addAsset 补建。
 * 幂等优先按原 id，其次按 storageKey（补建会生成新 id，不能只认 id）。
 */
export function planDraftRecovery(drafts: readonly RecoveredAssetDraft[], existing: readonly Asset[]): (string | null)[] {
  const keyOf = (data: unknown): string => {
    if (!record(data)) return '';
    return typeof data.storageKey === 'string' ? data.storageKey : '';
  };
  return drafts.map((draft) => {
    const byId = existing.find((asset) => asset.id === draft.assetId);
    if (byId) return byId.id;
    const key = keyOf(draft.asset.data);
    if (key) {
      const byKey = existing.find((asset) => keyOf(asset.data) === key);
      if (byKey) return byKey.id;
    }
    return null;
  });
}

export function createMemoryRecoveredAssetEvidenceStore(): RecoveredAssetEvidenceStore {
  const entries = new Map<string, RecoveredAssetEvidence>();
  const copy = (entry: RecoveredAssetEvidence): RecoveredAssetEvidence => ({
    ...entry,
    assetIds: [...entry.assetIds],
    drafts: entry.drafts ? entry.drafts.map((draft) => ({ ...draft, asset: { ...draft.asset } })) : undefined,
  });
  return {
    async put(evidence) { entries.set(evidence.taskId, copy(evidence)); },
    async list() { return [...entries.values()].map(copy); },
    async remove(taskId) { entries.delete(taskId); },
  };
}

/** 与主任务台账、2.2b 证据同库同 store，只按前缀区分键；不新建 object store。 */
function createBrowserRecoveredAssetEvidenceStore(): RecoveredAssetEvidenceStore {
  const instance = localforage.createInstance({
    name: 'infinite-canvas',
    storeName: 'app_state',
    driver: localforage.INDEXEDDB,
  });
  return {
    async put(evidence) { await instance.setItem(`${PREFIX}${evidence.taskId}`, evidence); },
    async list() {
      const out: RecoveredAssetEvidence[] = [];
      await instance.iterate<unknown, void>((value, key) => {
        if (!key.startsWith(PREFIX)) return;
        const parsed = parseRecoveredAssetEvidence(value);
        if (!parsed) throw new Error('已取回素材证据损坏，已拒绝按空证据处理');
        out.push(parsed);
      });
      return out;
    },
    async remove(taskId) { await instance.removeItem(`${PREFIX}${taskId}`); },
  };
}

let active: RecoveredAssetEvidenceStore = createBrowserRecoveredAssetEvidenceStore();
export function recoveredAssetEvidenceStore(): RecoveredAssetEvidenceStore { return active; }
/** 仅测试注入；生产不调用。 */
export function setRecoveredAssetEvidenceStore(store: RecoveredAssetEvidenceStore): void { active = store; }
