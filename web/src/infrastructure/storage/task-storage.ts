import type { StorageError, Stored } from '../../application/ports/taskRepository';
import { err, ok, type Result } from '../../domain/shared/result';
import { TASK_KINDS, TASK_PHASES, TASK_STATUSES, type ErrorCode, type Task } from '../../domain/task/model';

const ERROR_CODES: readonly ErrorCode[] = [
  'auth_failed', 'rate_limited', 'content_rejected', 'timeout', 'upstream_5xx',
  'network', 'invalid_params', 'local_save_failed', 'submission_uncertain',
  'provider_result_pending', 'unknown',
];
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const nullableNumber = (v: unknown) => v === null || finite(v);
const nullableString = (v: unknown) => v === null || typeof v === 'string';
const strings = (v: unknown) => Array.isArray(v) && Array.from(v).every((s) => typeof s === 'string');
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every((k) => allowed.includes(k));
const optional = (v: Record<string, unknown>, key: string, valid: (v: unknown) => boolean) =>
  v[key] === undefined || valid(v[key]);
const revision = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

export const corruptData = (): StorageError => ({ code: 'corrupt_data', message: '任务存储数据损坏或字段非法，已拒绝覆盖' });

/** 与 snapshotInvalidData 同理：草稿不合 schema 不等于库里的数据坏了。 */
export const invalidTaskData = (): StorageError => ({ code: 'corrupt_data', message: '本次要保存的任务数据字段非法，已拒绝写入；已保存的任务未受影响' });

function isTask(v: unknown): v is Task {
  if (!record(v) || !keys(v, [
    'id', 'nodeId', 'kind', 'params', 'status', 'phase', 'upstreamProgress',
    'resultAssetIds', 'error', 'upstreamRef', 'attempt', 'createdAt', 'startedAt', 'finishedAt', 'cost',
  ])) return false;
  const p = v.params;
  return typeof v.id === 'string' && v.id.length > 0 && nullableString(v.nodeId)
    && TASK_KINDS.some((k) => k === v.kind)
    && TASK_STATUSES.some((s) => s === v.status)
    && (v.phase === null || TASK_PHASES.some((p) => p === v.phase))
    && (v.upstreamProgress === null || (finite(v.upstreamProgress) && v.upstreamProgress >= 0 && v.upstreamProgress <= 1))
    && strings(v.resultAssetIds) && nullableString(v.upstreamRef)
    && revision(v.attempt) && v.attempt >= 1 && finite(v.createdAt)
    && nullableNumber(v.startedAt) && nullableNumber(v.finishedAt)
    && (v.error === null || (record(v.error) && keys(v.error, ['code', 'message'])
      && ERROR_CODES.some((c) => c === (v.error as Record<string, unknown>).code) && typeof v.error.message === 'string'))
    && (v.cost === null || (record(v.cost) && keys(v.cost, ['amount', 'currency', 'basis'])
      && finite(v.cost.amount) && typeof v.cost.currency === 'string' && typeof v.cost.basis === 'string'))
    && record(p) && keys(p, [
      'kind', 'prompt', 'model', 'providerId', 'inputAssetIds', 'aspectRatio', 'resolution', 'durationSec', 'count', 'extras',
    ]) && p.kind === v.kind && typeof p.prompt === 'string' && typeof p.model === 'string'
    && typeof p.providerId === 'string' && strings(p.inputAssetIds)
    && optional(p, 'aspectRatio', (x) => typeof x === 'string')
    && optional(p, 'resolution', (x) => typeof x === 'string')
    && optional(p, 'durationSec', finite) && optional(p, 'count', finite)
    && optional(p, 'extras', (x) => record(x) && Object.values(x).every((e) =>
      typeof e === 'string' || typeof e === 'boolean' || finite(e)));
}

/** 验证完整任务，复制入参与返回值；不执行任何业务迁移。 */
export function copyTask(task: Task): Result<Task, StorageError> {
  try {
    if (!isTask(task)) return err(invalidTaskData());
    return ok(JSON.parse(JSON.stringify(task)) as Task);
  } catch {
    return err(invalidTaskData());
  }
}

export interface TaskSnapshot {
  state: { tasks: Task[] };
  version: 0;
  metadata: { formatVersion: 1; revisions: Record<string, number> };
}

/** 只识别当前 Zustand JSON 字符串；旧格式只在首次成功写入时补元数据。 */
export function decodeTasks(raw: unknown): Result<TaskSnapshot, StorageError> {
  if (raw === undefined) return ok({ state: { tasks: [] }, version: 0, metadata: { formatVersion: 1, revisions: {} } });
  try {
    if (typeof raw !== 'string') return err(corruptData());
    const v: unknown = JSON.parse(raw);
    if (!record(v)) return err(corruptData());
    if (v.version !== 0 || (record(v.metadata) && v.metadata.formatVersion !== 1)) {
      return err({ code: 'unsupported_format', message: '不支持此任务存储格式，已拒绝覆盖' });
    }
    if (!keys(v, ['state', 'version', 'metadata']) || !record(v.state)
      || !keys(v.state, ['tasks']) || !Array.isArray(v.state.tasks) || !v.state.tasks.every(isTask)) return err(corruptData());
    const tasks = v.state.tasks;
    const ids = new Set(tasks.map((t) => t.id));
    if (ids.size !== tasks.length) return err(corruptData());
    let revisions: Record<string, number>;
    if (!Object.hasOwn(v, 'metadata')) {
      revisions = Object.fromEntries(tasks.map((t) => [t.id, 0]));
    } else {
      const m = v.metadata;
      if (!record(m) || !keys(m, ['formatVersion', 'revisions']) || !record(m.revisions)
        || Object.keys(m.revisions).length !== ids.size
        || !Object.entries(m.revisions).every(([id, r]) => ids.has(id) && revision(r))) return err(corruptData());
      revisions = m.revisions as Record<string, number>;
    }
    return ok({ state: { tasks }, version: 0, metadata: { formatVersion: 1, revisions } });
  } catch {
    return err(corruptData());
  }
}

/** 仅修改事务内最新快照的目标任务，revision 不写入业务 Task。 */
export function changeTask(snapshot: TaskSnapshot, task: Task, expectedRevision?: number): Result<Stored<Task>, StorageError> {
  const index = snapshot.state.tasks.findIndex((t) => t.id === task.id);
  if (expectedRevision === undefined) {
    if (index !== -1) return err({ code: 'already_exists', id: task.id, message: '任务已存在，不能重复创建' });
    snapshot.state.tasks.unshift(task);
  } else {
    if (index === -1) return err({ code: 'not_found', id: task.id, message: '任务不存在，不能替换' });
    const actualRevision = snapshot.metadata.revisions[task.id];
    if (expectedRevision !== actualRevision) return err({
      code: 'conflict', message: '任务已被其他写入更新，请重新读取后保存', expectedRevision, actualRevision,
    });
    if (!revision(actualRevision + 1)) return err(corruptData());
    snapshot.state.tasks[index] = task;
  }
  const nextRevision = expectedRevision === undefined ? 1 : expectedRevision + 1;
  Object.defineProperty(snapshot.metadata.revisions, task.id, { value: nextRevision, enumerable: true, writable: true, configurable: true });
  return ok({ value: task, revision: nextRevision });
}
