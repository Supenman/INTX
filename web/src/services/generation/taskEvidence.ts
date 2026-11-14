/** 2.2b 本机证据：上游 2xx 拿到任务号的那一刻先落盘，独立于主任务台账。 */
import localforage from 'localforage';

import type { LoggedTask } from './taskLog';

const PREFIX = 'infinite-canvas:intx_task_evidence:';

export interface TaskEvidence {
  taskId: string;
  upstreamRef: string;
  /** 已确认过的任务快照；补写时原样使用，不重新发请求。 */
  desired: LoggedTask;
  savedAt: number;
}

export interface EvidenceStore {
  put(evidence: TaskEvidence): Promise<void>;
  list(): Promise<TaskEvidence[]>;
  remove(taskId: string): Promise<void>;
}

const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 损坏证据不能当成「没有证据」——那会把已收单的单子显示成可重发。 */
export function parseEvidence(value: unknown): TaskEvidence | null {
  if (!record(value)) return null;
  const { taskId, upstreamRef, desired, savedAt } = value;
  if (typeof taskId !== 'string' || !taskId) return null;
  if (typeof upstreamRef !== 'string' || !upstreamRef) return null;
  if (!finite(savedAt) || !record(desired) || desired.id !== taskId) return null;
  if (!finite(desired.revision) || (desired.revision as number) < 0) return null;
  return value as unknown as TaskEvidence;
}

export function createMemoryEvidenceStore(): EvidenceStore {
  const entries = new Map<string, TaskEvidence>();
  return {
    async put(evidence) { entries.set(evidence.taskId, { ...evidence }); },
    async list() { return [...entries.values()].map((entry) => ({ ...entry })); },
    async remove(taskId) { entries.delete(taskId); },
  };
}

/** 沿用主台账所在的库和对象仓库，只按前缀区分键；不新建 object store。 */
function createBrowserEvidenceStore(): EvidenceStore {
  const instance = localforage.createInstance({ name: 'infinite-canvas', storeName: 'app_state', driver: localforage.INDEXEDDB });
  return {
    async put(evidence) { await instance.setItem(`${PREFIX}${evidence.taskId}`, evidence); },
    async list() {
      const out: TaskEvidence[] = [];
      await instance.iterate<unknown, void>((value, key) => {
        if (!key.startsWith(PREFIX)) return;
        const parsed = parseEvidence(value);
        if (!parsed) throw new Error('本机任务证据损坏，已拒绝按空证据处理');
        out.push(parsed);
      });
      return out;
    },
    async remove(taskId) { await instance.removeItem(`${PREFIX}${taskId}`); },
  };
}

let active: EvidenceStore = createBrowserEvidenceStore();
export function evidenceStore(): EvidenceStore { return active; }
/** 仅测试注入；生产不调用。 */
export function setEvidenceStore(store: EvidenceStore): void { active = store; }
