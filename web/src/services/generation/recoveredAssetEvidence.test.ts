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
  assetDrafts,
  createMemoryRecoveredAssetEvidenceStore,
  parseRecoveredAssetEvidence,
  planDraftRecovery,
  setRecoveredAssetEvidenceStore,
  type RecoveredAssetEvidence,
} from './recoveredAssetEvidence';
import type { Asset } from '@/application/persistence/types';

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

function fixtureAsset(id: string, storageKey: string): Asset {
  return {
    id, kind: 'image', title: 'fixture', coverUrl: '', tags: [],
    createdAt: '2026-01-01', updatedAt: '2026-01-01',
    data: { dataUrl: '', storageKey, width: 1, height: 1, bytes: 1, mimeType: 'image/png' },
  } as Asset;
}

function fixtureDrafts() {
  return assetDrafts(
    [fixtureAsset('a-1', 'image:k1'), fixtureAsset('a-2', 'image:k2')],
    ['a-1', 'a-2'],
  );
}

function stageA(): RecoveredAssetEvidence {
  return { taskId: base.id, upstreamRef: 'up-fixture', assetIds: [], drafts: fixtureDrafts(), savedAt: 1 };
}

describe('2.2c-2 已下载 Blob 的补建证据', () => {
  it('旧格式（阶段 B）与阶段 A 都能解析，阶段冲突被拒绝', () => {
    expect(parseRecoveredAssetEvidence(evidence())?.assetIds).toEqual(['asset-1', 'asset-2']);
    expect(parseRecoveredAssetEvidence(stageA())?.drafts).toHaveLength(2);
    expect(parseRecoveredAssetEvidence({ ...stageA(), assetIds: ['a-1'] })).toBeNull();
    expect(parseRecoveredAssetEvidence({ ...stageA(), drafts: [] })).toBeNull();
    expect(parseRecoveredAssetEvidence({ ...stageA(), drafts: undefined })).toBeNull();
  });

  it('损坏的草稿不能当成空证据', () => {
    const e = stageA();
    const good = e.drafts![0];
    expect(parseRecoveredAssetEvidence({ ...e, drafts: [{ assetId: '', asset: good.asset }] })).toBeNull();
    expect(parseRecoveredAssetEvidence({ ...e, drafts: [{ assetId: 'a-1', asset: { ...good.asset, kind: 'unknown' } }] })).toBeNull();
    expect(parseRecoveredAssetEvidence({ ...e, drafts: [{ assetId: 'a-1', asset: { ...good.asset, data: null } }] })).toBeNull();
    expect(parseRecoveredAssetEvidence({ ...e, drafts: [{ assetId: 'a-1', asset: { ...good.asset, data: { ...good.asset.data, storageKey: '' } } }] })).toBeNull();
  });

  it('assetDrafts 剥掉运行时字段，缺一个就整体退回，不落半份证据', () => {
    const drafts = fixtureDrafts();
    expect(drafts).toHaveLength(2);
    expect(drafts[0].asset).not.toHaveProperty('id');
    expect(drafts[0].asset).not.toHaveProperty('createdAt');
    expect(drafts[0].asset).not.toHaveProperty('updatedAt');
    expect(drafts[0].asset.data).toHaveProperty('storageKey', 'image:k1');
    expect(assetDrafts([fixtureAsset('a-1', 'image:k1')], ['a-1', 'missing'])).toEqual([]);
    // 没有本地 storageKey 的产物只是远程 URL 引用，退回 2.2c-1，不落可能引用过期地址的证据。
    expect(assetDrafts([fixtureAsset('a-1', '')], ['a-1'])).toEqual([]);
    expect(assetDrafts([], [])).toEqual([]);
  });

  it('补建计划按 id 或 storageKey 幂等复用，缺的才返回 null', () => {
    const drafts = fixtureDrafts();
    expect(planDraftRecovery(drafts, [fixtureAsset('a-1', 'image:k1'), fixtureAsset('a-2', 'image:k2')])).toEqual(['a-1', 'a-2']);
    // 补建会生成新 id，必须靠 storageKey 认出同一份 Blob，不能重复创建素材。
    expect(planDraftRecovery(drafts, [fixtureAsset('new-1', 'image:k1'), fixtureAsset('new-2', 'image:k2')])).toEqual(['new-1', 'new-2']);
    expect(planDraftRecovery(drafts, [fixtureAsset('new-1', 'image:k1')])).toEqual(['new-1', null]);
    expect(planDraftRecovery(drafts, [])).toEqual([null, null]);
  });

  it('阶段 A 证据落盘后重启可恢复，三态仍不退化成可重发', async () => {
    const e = stageA();
    const store = createMemoryRecoveredAssetEvidenceStore();
    await store.put(e);
    setRecoveredAssetEvidenceStore(store);
    useTaskLogStore.setState({ tasks: [task()] });
    await loadTaskLog();
    expect(useTaskLogStore.getState().pendingCommits[e.taskId]?.drafts).toHaveLength(2);
    const current = useTaskLogStore.getState().tasks.find((item) => item.id === e.taskId) ?? task();
    expect(readTaskOutcome(current)?.regenerate).not.toBe('allowed');
    expect(useTaskLogStore.getState().loadError).toBeNull();
  });

  it('阶段 A 证据写入失败不抛错，仍保留当前进程内存证据', async () => {
    setRecoveredAssetEvidenceStore({
      async put() { throw new Error('fixture evidence down'); },
      async list() { return []; },
      async remove() {},
    });
    const e = stageA();
    await expect(rememberPendingCommit(e)).resolves.toBeUndefined();
    expect(pendingCommitFor(e.taskId, 'up-fixture')?.drafts).toHaveLength(2);
  });

  it('升级为阶段 B 必须显式去掉 drafts，否则解析拒绝', () => {
    const e = stageA();
    expect(parseRecoveredAssetEvidence({ ...e, assetIds: ['a-1', 'a-2'] })).toBeNull();
    const upgraded = {
      taskId: e.taskId, upstreamRef: e.upstreamRef, assetIds: ['a-1', 'a-2'], savedAt: 2,
    };
    expect(parseRecoveredAssetEvidence(upgraded)?.assetIds).toEqual(['a-1', 'a-2']);
  });
});
