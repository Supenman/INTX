import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTask } from '@/domain/task/model';
import { readTaskOutcome } from '@/domain/task/outcome';
import { err } from '@/domain/shared/result';
import type { TaskRepository } from '@/application/ports/taskRepository';
import { createMemoryTaskRepository } from '@/infrastructure/storage/memory-task-repository';
import { createMemoryTaskLog, createTaskLog, loadTaskLog, restoreUnsaved, TaskPersistenceError, useTaskLogStore, type LoggedTask } from './taskLog';
import { createMemoryEvidenceStore, parseEvidence, setEvidenceStore, type EvidenceStore, type TaskEvidence } from './taskEvidence';
import { createMemoryRecoveredAssetEvidenceStore, setRecoveredAssetEvidenceStore } from './recoveredAssetEvidence';
import { inspectRunWithTask, type SubmitHooks } from './withTask';
import { submitVideoTask } from './videoTasks';
import { generateModelScopeImages, type ModelScopeTransport } from './modelScope';

const params = { kind: 'image' as const, prompt: 'fixture', model: 'fixture/image', providerId: 'fixture', inputAssetIds: [] };
const scopeRequest = { baseUrl: 'https://api-inference.modelscope.cn', apiKey: ['fixture', 'only'].join('-'), model: 'fixture', prompt: 'fixture', referenceCount: 0 };
const transport = (onPost?: () => void): ModelScopeTransport => ({
  async request(_url, init) {
    if (init.method === 'POST') onPost?.();
    return {
      ok: true, status: 200,
      json: async () => init.method === 'POST'
        ? { task_id: 'up-fixture' }
        : { task_status: 'SUCCEED', output_images: ['https://fixture.invalid/image'] },
      text: async () => '',
    };
  },
  async fetchImage() { return 'data:image/png;base64,AAAA'; },
});
const submitImages = (t: ModelScopeTransport) => (hooks: SubmitHooks) =>
  generateModelScopeImages(t, { ...scopeRequest, onSubmitted: hooks.onSubmitted });

function fixture(overrides: Partial<TaskEvidence> = {}): TaskEvidence {
  const desired = {
    ...createTask({ kind: 'image', params, nodeId: null }),
    revision: 2, status: 'running' as const, phase: 'generating' as const, upstreamRef: null,
  } as LoggedTask;
  return { taskId: desired.id, upstreamRef: 'up-fixture', desired, savedAt: 1, ...overrides };
}

function resetState() {
  useTaskLogStore.setState({ tasks: [], hydrated: false, loading: false, loadError: null, unsaved: {}, recovered: {}, pendingCommits: {}, inFlightIds: [] });
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

describe('2.2b 本机已收单证据', () => {
  it('损坏证据按错误拒绝，不能当空证据', () => {
    const e = fixture();
    expect(parseEvidence(e)?.upstreamRef).toBe('up-fixture');
    expect(parseEvidence(null)).toBeNull();
    expect(parseEvidence({ ...e, taskId: '' })).toBeNull();
    expect(parseEvidence({ ...e, upstreamRef: '' })).toBeNull();
    expect(parseEvidence({ ...e, savedAt: Number.NaN })).toBeNull();
    expect(parseEvidence({ ...e, desired: { ...e.desired, id: 'other' } })).toBeNull();
    expect(parseEvidence({ ...e, desired: { ...e.desired, revision: -1 } })).toBeNull();
  });

  it('内存证据仓库支持写入、读取与移除', async () => {
    const store = createMemoryEvidenceStore();
    const e = fixture();
    await store.put(e);
    expect(await store.list()).toHaveLength(1);
    await store.remove(e.taskId);
    expect(await store.list()).toHaveLength(0);
  });

  it('重启恢复：补回任务号且三态为 confirm，不退化成可重发', () => {
    const e = fixture();
    const item = restoreUnsaved([], [e])[e.taskId];
    expect(item).toBeDefined();
    expect(item.desired.upstreamRef).toBe('up-fixture');
    expect(item.evidence.error?.code).toBe('provider_result_pending');
    expect(readTaskOutcome(item.evidence)?.regenerate).toBe('confirm');
  });

  it('主台账已确认同一任务号时不重复恢复', () => {
    const e = fixture();
    const saved = { ...e.desired, upstreamRef: 'up-fixture', revision: 3 };
    expect(restoreUnsaved([saved], [e])).toEqual({});
  });

  it('拿到任务号时先落证据，再写主台账，确认后清除', async () => {
    const events: string[] = [];
    const inner = createMemoryEvidenceStore();
    const store: EvidenceStore = {
      async put(e) { events.push(`evidence:put:${e.upstreamRef}`); await inner.put(e); },
      async list() { return inner.list(); },
      async remove(id) { events.push(`evidence:remove`); await inner.remove(id); },
    };
    setEvidenceStore(store);
    const repo = createMemoryTaskRepository();
    const log: TaskRepository = {
      ...repo,
      async replace(task, rev) {
        const result = await repo.replace(task, rev);
        events.push(task.upstreamRef ? 'ref-saved' : 'running-saved');
        return result;
      },
    };
    await inspectRunWithTask({ params, log: createTaskLog(log), submit: submitImages(transport()) });
    expect(events.indexOf('evidence:put:up-fixture')).toBeGreaterThanOrEqual(0);
    expect(events.indexOf('evidence:put:up-fixture')).toBeLessThan(events.indexOf('ref-saved'));
    expect(events).toContain('evidence:remove');
    expect(await inner.list()).toHaveLength(0);
  });

  it('主台账写失败时证据保留，错误仍是 confirm', async () => {
    const store = createMemoryEvidenceStore();
    setEvidenceStore(store);
    const repo = createMemoryTaskRepository();
    const log: TaskRepository = {
      ...repo,
      async replace(task, rev) {
        if (task.upstreamRef) return err({ code: 'write_failed' as const, message: 'fixture 主台账写失败' });
        return repo.replace(task, rev);
      },
    };
    const error = await inspectRunWithTask({ params, log: createTaskLog(log), submit: submitImages(transport()) }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TaskPersistenceError);
    expect((error as TaskPersistenceError).outcome?.regenerate).toBe('confirm');
    expect(await store.list()).toHaveLength(1);
    expect((await store.list())[0].upstreamRef).toBe('up-fixture');
  });

  it('证据写入失败不中断已发出的提交，也不伪装成提交失败', async () => {
    setEvidenceStore({
      async put() { throw new Error('fixture evidence down'); },
      async list() { return []; },
      async remove() {},
    });
    let posts = 0;
    const result = await inspectRunWithTask({
      params, log: createMemoryTaskLog(), submit: submitImages(transport(() => { posts += 1; })),
    });
    expect(posts).toBe(1);
    expect(result.task.upstreamRef).toBe('up-fixture');
    // 成功出图是正常完成，不是「旧单未确认」；这里只验证本地证据故障没有打断流程。
    expect(result.task.status).toBe('succeeded');
  });

  it('视频提交即收单，同样先落证据', async () => {
    const events: string[] = [];
    const inner = createMemoryEvidenceStore();
    setEvidenceStore({
      async put(e) { events.push(`evidence:put:${e.upstreamRef}`); await inner.put(e); },
      async list() { return inner.list(); },
      async remove(id) { await inner.remove(id); },
    });
    await submitVideoTask({
      config: { videoModel: 'fixture/video' }, prompt: 'fixture', log: createMemoryTaskLog(),
      transport: { submit: async () => { events.push('submitted'); return { id: 'v-fixture', provider: 'openai' as const, model: 'fixture/video' }; } },
    });
    expect(events.indexOf('submitted')).toBeLessThan(events.indexOf('evidence:put:v-fixture'));
  });

  it('启动时把未确认证据还原到待核实列表', async () => {
    const e = fixture();
    const store = createMemoryEvidenceStore();
    await store.put(e);
    setEvidenceStore(store);
    await loadTaskLog();
    const item = useTaskLogStore.getState().unsaved[e.taskId];
    expect(item).toBeDefined();
    expect(item.evidence.upstreamRef).toBe('up-fixture');
    expect(readTaskOutcome(item.evidence)?.regenerate).toBe('confirm');
    expect(useTaskLogStore.getState().loadError).toBeNull();
  });

  it('证据读取失败时报加载错误，不静默当成没有证据', async () => {
    setEvidenceStore({
      async put() {},
      async list() { throw new Error('fixture 证据损坏'); },
      async remove() {},
    });
    await loadTaskLog();
    expect(useTaskLogStore.getState().loadError).toContain('fixture 证据损坏');
    expect(useTaskLogStore.getState().hydrated).toBe(false);
  });
});
