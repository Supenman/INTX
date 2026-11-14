import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTask } from '@/domain/task/model';
import { readTaskOutcome } from '@/domain/task/outcome';
import {
  browserTaskLog,
  forgetPendingCommit,
  isTaskCommitted,
  loadTaskLog,
  pendingCommitFor,
  rememberPendingCommit,
  restorePendingCommits,
  useTaskLogStore,
  type LoggedTask,
} from './taskLog';
import { createMemoryEvidenceStore, setEvidenceStore } from './taskEvidence';
import {
  createMemoryRecoveredAssetEvidenceStore,
  parseRecoveredAssetEvidence,
  setRecoveredAssetEvidenceStore,
  type RecoveredAssetEvidence,
} from './recoveredAssetEvidence';

const params = { kind: 'image' as const, prompt: 'fixture', model: 'fixture/image', providerId: 'fixture', inputAssetIds: [] };
const base = createTask({ kind: 'image', params, nodeId: null });

function task(overrides: Partial<LoggedTask> = {}): LoggedTask {
  return {
    ...base,
    revision: 2, status: 'running', phase: 'generating', upstreamRef: 'up-fixture',
    ...overrides,
  } as LoggedTask;
}

function evidence(overrides: Partial<RecoveredAssetEvidence> = {}): RecoveredAssetEvidence {
  return {
    taskId: base.id, upstreamRef: 'up-fixture', assetIds: ['asset-1', 'asset-2'], savedAt: 1,
    ...overrides,
  };
}

function resetState() {
  useTaskLogStore.setState({
    tasks: [], hydrated: false, loading: false, loadError: null,
    unsaved: {}, recovered: {}, pendingCommits: {}, inFlightIds: [],
  });
}

beforeEach(() => {
  setEvidenceStore(createMemoryEvidenceStore());
  setRecoveredAssetEvidenceStore(createMemoryRecoveredAssetEvidenceStore());
  resetState();
});
afterEach(() => {
  setEvidenceStore(createMemoryEvidenceStore());
  setRecoveredAssetEvidenceStore(createMemoryRecoveredAssetEvidenceStore());
  resetState();
  vi.restoreAllMocks();
});

describe('2.2c-1 已取回素材证据', () => {
  it('损坏证据按错误拒绝，不能当空证据', () => {
    const e = evidence();
    expect(parseRecoveredAssetEvidence(e)?.assetIds).toEqual(['asset-1', 'asset-2']);
    expect(parseRecoveredAssetEvidence(null)).toBeNull();
    expect(parseRecoveredAssetEvidence({ ...e, taskId: '' })).toBeNull();
    expect(parseRecoveredAssetEvidence({ ...e, upstreamRef: '' })).toBeNull();
    expect(parseRecoveredAssetEvidence({ ...e, assetIds: [] })).toBeNull();
    expect(parseRecoveredAssetEvidence({ ...e, assetIds: ['ok', 123] })).toBeNull();
    expect(parseRecoveredAssetEvidence({ ...e, savedAt: Number.NaN })).toBeNull();
  });

  it('内存证据仓库写入、读取、移除，且返回值与内部状态隔离', async () => {
    const store = createMemoryRecoveredAssetEvidenceStore();
    const e = evidence();
    await store.put(e);
    const listed = await store.list();
    expect(listed).toHaveLength(1);
    listed[0].assetIds.push('injected');
    expect((await store.list())[0].assetIds).toEqual(['asset-1', 'asset-2']);
    await store.remove(e.taskId);
    expect(await store.list()).toHaveLength(0);
  });

  it('已核销的任务不再恢复补写证据', () => {
    const e = evidence();
    expect(isTaskCommitted(task({ status: 'succeeded' }))).toBe(true);
    expect(isTaskCommitted(task({ resultAssetIds: ['asset-1'] }))).toBe(true);
    expect(isTaskCommitted(task())).toBe(false);
    expect(isTaskCommitted(undefined)).toBe(false);
    expect(restorePendingCommits([task({ status: 'succeeded' })], [e])).toEqual({});
    expect(restorePendingCommits([], [e])[e.taskId]).toEqual(e);
  });

  it('单号不匹配的证据不会串到别的任务上', () => {
    const e = evidence();
    useTaskLogStore.setState({ pendingCommits: { [e.taskId]: e } });
    expect(pendingCommitFor(e.taskId, 'up-fixture')).toEqual(e);
    expect(pendingCommitFor(e.taskId, 'up-other')).toBeNull();
    expect(pendingCommitFor('other-task', 'up-fixture')).toBeNull();
  });

  it('素材确认后落盘证据，任务核销后清除内存与磁盘', async () => {
    const store = createMemoryRecoveredAssetEvidenceStore();
    const remove = vi.spyOn(store, 'remove');
    setRecoveredAssetEvidenceStore(store);
    const e = evidence();
    await rememberPendingCommit(e);
    expect(pendingCommitFor(e.taskId, 'up-fixture')).toEqual(e);
    expect(await store.list()).toHaveLength(1);
    forgetPendingCommit(e.taskId);
    expect(pendingCommitFor(e.taskId, 'up-fixture')).toBeNull();
    expect(remove).toHaveBeenCalledWith(e.taskId);
    expect(await store.list()).toHaveLength(0);
  });

  it('证据写入失败不抛错，仍保留当前进程内存证据', async () => {
    setRecoveredAssetEvidenceStore({
      async put() { throw new Error('fixture evidence down'); },
      async list() { return []; },
      async remove() {},
    });
    const e = evidence();
    await expect(rememberPendingCommit(e)).resolves.toBeUndefined();
    expect(pendingCommitFor(e.taskId, 'up-fixture')).toEqual(e);
  });

  it('启动时把未核销证据还原成待补写任务', async () => {
    const e = evidence();
    const store = createMemoryRecoveredAssetEvidenceStore();
    await store.put(e);
    setRecoveredAssetEvidenceStore(store);
    await loadTaskLog();
    const item = useTaskLogStore.getState().pendingCommits[e.taskId];
    expect(item).toBeDefined();
    expect(item.assetIds).toEqual(['asset-1', 'asset-2']);
    expect(useTaskLogStore.getState().loadError).toBeNull();
    expect(useTaskLogStore.getState().hydrated).toBe(true);
  });

  it('主台账已核销时清除残留证据，不重复补写', async () => {
    const e = evidence();
    const store = createMemoryRecoveredAssetEvidenceStore();
    await store.put(e);
    const remove = vi.spyOn(store, 'remove');
    setRecoveredAssetEvidenceStore(store);
    vi.spyOn(browserTaskLog, 'list').mockResolvedValue([
      task({ status: 'succeeded', resultAssetIds: ['asset-1', 'asset-2'] }),
    ]);
    await loadTaskLog();
    expect(useTaskLogStore.getState().pendingCommits[e.taskId]).toBeUndefined();
    expect(remove).toHaveBeenCalledWith(e.taskId);
  });

  it('证据读取失败显示加载错误，不静默当成没有证据', async () => {
    setRecoveredAssetEvidenceStore({
      async put() {},
      async list() { throw new Error('fixture 已取回素材证据损坏'); },
      async remove() {},
    });
    await loadTaskLog();
    expect(useTaskLogStore.getState().loadError).toContain('fixture 已取回素材证据损坏');
    expect(useTaskLogStore.getState().hydrated).toBe(false);
  });

  it('恢复补写证据不改变任务三态，仍不退化成可重发', async () => {
    const e = evidence();
    const store = createMemoryRecoveredAssetEvidenceStore();
    await store.put(e);
    setRecoveredAssetEvidenceStore(store);
    useTaskLogStore.setState({ tasks: [task()] });
    await loadTaskLog();
    const current = useTaskLogStore.getState().tasks.find((item) => item.id === e.taskId) ?? task();
    expect(readTaskOutcome(current)?.regenerate).not.toBe('allowed');
    expect(useTaskLogStore.getState().pendingCommits[e.taskId]).toBeDefined();
  });
});
