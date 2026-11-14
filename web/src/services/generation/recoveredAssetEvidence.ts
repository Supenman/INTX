/**
 * 2.2c-1 已取回素材证据。
 *
 * 查单取回的产物写入素材元数据并确认后、任务台账核销前，进程可能崩溃。
 * 重启后若没有这份证据，待核实任务会重新查单、重新下载、重复创建素材。
 * 这里把「产物已取回，只补写任务记录」的事实落盘；核销成功后清除。
 *
 * 它只缩小崩溃窗口，不承诺零窗口，也不是跨集合原子事务：证据写失败时
 * 仍只保留当前进程内存证据。复用 2.2b 的库与对象仓库，不新建 object store。
 */
import localforage from 'localforage';

const PREFIX = 'infinite-canvas:intx_recovered_assets:';

export interface RecoveredAssetEvidence {
  taskId: string;
  upstreamRef: string;
  /** 已确认保存的素材 id；补写任务时原样使用，不重新查单或创建素材。 */
  assetIds: string[];
  savedAt: number;
}

export interface RecoveredAssetEvidenceStore {
  put(evidence: RecoveredAssetEvidence): Promise<void>;
  list(): Promise<RecoveredAssetEvidence[]>;
  remove(taskId: string): Promise<void>;
}

const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 损坏证据不能当成「没有证据」——那会把已取回的产物重新查一遍、再建一份素材。 */
export function parseRecoveredAssetEvidence(value: unknown): RecoveredAssetEvidence | null {
  if (!record(value)) return null;
  const { taskId, upstreamRef, assetIds, savedAt } = value;
  if (typeof taskId !== 'string' || !taskId) return null;
  if (typeof upstreamRef !== 'string' || !upstreamRef) return null;
  if (!Array.isArray(assetIds) || !assetIds.length || !assetIds.every((id) => typeof id === 'string' && id)) return null;
  if (!finite(savedAt)) return null;
  return value as unknown as RecoveredAssetEvidence;
}

export function createMemoryRecoveredAssetEvidenceStore(): RecoveredAssetEvidenceStore {
  const entries = new Map<string, RecoveredAssetEvidence>();
  return {
    async put(evidence) { entries.set(evidence.taskId, { ...evidence, assetIds: [...evidence.assetIds] }); },
    async list() { return [...entries.values()].map((entry) => ({ ...entry, assetIds: [...entry.assetIds] })); },
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
