import { describe, expect, it, vi } from 'vitest';
import { createTask } from '@/domain/task/model';
import { err } from '@/domain/shared/result';
import type { TaskRepository } from '@/application/ports/taskRepository';
import { createMemoryTaskRepository } from '@/infrastructure/storage/memory-task-repository';
import { browserTaskLog, commit, createMemoryTaskLog, createTaskLog, resumableTasks, retryTaskSave, TaskPersistenceError, useTaskLogStore, type LoggedTask } from './taskLog';
import { inspectRunWithTask } from './withTask';
import { noteVideoPoll, submitVideoTask } from './videoTasks';
import { generateModelScopeImages, type ModelScopeTransport } from './modelScope';

const params = { kind: 'image' as const, prompt: 'fixture', model: 'fixture/image', providerId: 'fixture', inputAssetIds: [] };
const failed = () => err({ code: 'write_failed' as const, message: '本地保存失败' });
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}
const transport = (events: string[]): ModelScopeTransport => ({
  async request(_url, init) {
    events.push(init.method);
    return { ok: true, status: 200, json: async () => init.method === 'POST' ? { task_id: 'up-fixture' } : { task_status: 'SUCCEED', output_images: ['https://fixture.invalid/image'] }, text: async () => '' };
  },
  async fetchImage() { return 'data:image/png;base64,AAAA'; },
});

describe('任务存储与提交屏障', () => {
  it('创建/提交状态保存失败时，图片和视频均零提交', async () => {
    for (const stage of ['create', 'replace'] as const) {
      const repo: TaskRepository = { ...createMemoryTaskRepository(), [stage]: async () => failed() };
      const log = createTaskLog(repo);
      const submit = vi.fn(async () => []);
      await expect(inspectRunWithTask({ params, log, submit })).rejects.toMatchObject({ name: 'TaskPersistenceError' });
      expect(submit).not.toHaveBeenCalled();
      const videoSubmit = vi.fn(async () => ({ id: 'v', provider: 'openai' as const, model: 'fixture/video' }));
      await expect(submitVideoTask({ config: { videoModel: 'fixture/video' }, prompt: 'fixture', log, transport: { submit: videoSubmit } })).rejects.toBeInstanceOf(TaskPersistenceError);
      expect(videoSubmit).not.toHaveBeenCalled();
    }
  });

  it('保存等待期间取消：最终不调用厂商，落 canceled', async () => {
    const repo = createMemoryTaskRepository();
    const wait = gate();
    const entered = gate();
    const log = createTaskLog({ ...repo, async create(task) { entered.resolve(); await wait.promise; return repo.create(task); } });
    const controller = new AbortController();
    const submit = vi.fn(async () => []);
    const run = inspectRunWithTask({ params, log, signal: controller.signal, submit });
    await entered.promise;
    controller.abort(); wait.resolve();
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(submit).not.toHaveBeenCalled();
    expect((await log.list())[0].status).toBe('canceled');
  });

  it('任务号写确认后才 GET；本地提交状态确认后才 POST', async () => {
    const events: string[] = [];
    const repo = createMemoryTaskRepository();
    const log = createTaskLog({ ...repo, async create(task) { const r = await repo.create(task); events.push('created'); return r; }, async replace(task, rev) { const r = await repo.replace(task, rev); events.push(task.upstreamRef ? 'ref-saved' : 'running-saved'); return r; } });
    await inspectRunWithTask({ params, log, submit: (hooks) => generateModelScopeImages(transport(events), { baseUrl: 'https://api-inference.modelscope.cn', apiKey: ['fixture', 'only'].join('-'), model: 'fixture', prompt: 'fixture', referenceCount: 0, onSubmitted: hooks.onSubmitted }) });
    expect(events.slice(0, 5)).toEqual(['created', 'running-saved', 'POST', 'ref-saved', 'GET']);
    expect(events.filter((e) => e === 'POST')).toHaveLength(1);
  });

  it('POST 已接受、任务号写失败：保留任务号/confirm，零 GET、零重新 POST', async () => {
    const events: string[] = [];
    const repo = createMemoryTaskRepository();
    const log = createTaskLog({ ...repo, async replace(task, rev) { return task.upstreamRef ? failed() : repo.replace(task, rev); } });
    const error = await inspectRunWithTask({ params, log, submit: (hooks) => generateModelScopeImages(transport(events), { baseUrl: 'https://api-inference.modelscope.cn', apiKey: ['fixture', 'only'].join('-'), model: 'fixture', prompt: 'fixture', referenceCount: 0, onSubmitted: hooks.onSubmitted }) }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TaskPersistenceError);
    expect(error).toMatchObject({ upstreamRef: 'up-fixture', outcome: { regenerate: 'confirm' } });
    expect(events).toEqual(['POST']);
  });

  it('视频收单后写失败同样保留旧号/confirm，不再次提交', async () => {
    const repo = createMemoryTaskRepository();
    const log = createTaskLog({ ...repo, async replace(task, rev) { return task.upstreamRef ? failed() : repo.replace(task, rev); } });
    const submit = vi.fn(async () => ({ id: 'v-old-order', provider: 'openai' as const, model: 'fixture/video' }));
    await expect(submitVideoTask({ config: { videoModel: 'fixture/video' }, prompt: 'fixture', log, transport: { submit } })).rejects.toMatchObject({ upstreamRef: 'v-old-order', outcome: { regenerate: 'confirm' } });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('任务号保存挂起期间没有 GET，确认后才继续查单', async () => {
    const repo = createMemoryTaskRepository();
    const entered = gate(); const wait = gate(); const events: string[] = [];
    const log = createTaskLog({ ...repo, async replace(task, rev) {
      if (task.upstreamRef && task.status === 'running') { entered.resolve(); await wait.promise; }
      return repo.replace(task, rev);
    } });
    const run = inspectRunWithTask({ params, log, submit: (hooks) => generateModelScopeImages(transport(events), {
      baseUrl: 'https://api-inference.modelscope.cn', apiKey: ['fixture', 'only'].join('-'), model: 'fixture', prompt: 'fixture', referenceCount: 0, onSubmitted: hooks.onSubmitted,
    }) });
    await entered.promise;
    expect(events).toEqual(['POST']);
    wait.resolve(); await run;
    expect(events).toEqual(['POST', 'GET']);
  });

  it('同步产物返回、终态写失败：不假报成功，并保留产物引用/confirm', async () => {
    const repo = createMemoryTaskRepository();
    const log = createTaskLog({ ...repo, async replace(task, rev) { return task.status === 'succeeded' ? failed() : repo.replace(task, rev); } });
    const submit = vi.fn(async () => [{ id: 'result-fixture' }]);
    const error = await inspectRunWithTask({ params, log, submit, resultIds: (items) => items.map((i) => i.id) }).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'TaskPersistenceError', task: { resultAssetIds: ['result-fixture'] }, outcome: { regenerate: 'confirm' } });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('非法迁移和版本冲突显式拒绝，数据不变', async () => {
    const log = createMemoryTaskLog();
    const queued = await log.create({ kind: 'image', params });
    await expect(commit(log, queued, 'succeeded')).rejects.toBeInstanceOf(TaskPersistenceError);
    const running = await commit(log, queued, 'running');
    await expect(commit(log, queued, 'running')).rejects.toMatchObject({ detail: { code: 'conflict' } });
    expect(await log.get(queued.id)).toEqual(running);
  });

  it('初次创建补记中途失败后，保留确认过的revision并能继续补写', async () => {
    const desired: LoggedTask = { ...createTask({ id: 'first-save-fixture', kind: 'image', params }), revision: 0, status: 'running' };
    useTaskLogStore.setState({ unsaved: { [desired.id]: { desired, evidence: desired, error: 'fixture' } } });
    const created = { ...desired, status: 'queued' as const, revision: 1 };
    const get = vi.spyOn(browserTaskLog, 'get').mockResolvedValueOnce(null).mockResolvedValue(created);
    const create = vi.spyOn(browserTaskLog, 'create').mockResolvedValue(created);
    const update = vi.spyOn(browserTaskLog, 'update').mockRejectedValueOnce(new TaskPersistenceError({ code: 'write_failed', message: 'fixture' })).mockResolvedValue({ ...desired, revision: 2 });
    try {
      await expect(retryTaskSave(desired.id)).rejects.toBeInstanceOf(TaskPersistenceError);
      expect(useTaskLogStore.getState().unsaved[desired.id].desired.revision).toBe(1);
      await retryTaskSave(desired.id);
      expect(update.mock.calls[1][0].revision).toBe(1);
      expect(create).toHaveBeenCalledTimes(1);
    } finally { get.mockRestore(); create.mockRestore(); update.mockRestore(); useTaskLogStore.setState({ unsaved: {} }); }
  });

  it('视频终态本地补记成功后，继续查原单不再次迁移终态', async () => {
    const log = createMemoryTaskLog();
    let task = await log.create({ kind: 'video', params: { ...params, kind: 'video' } });
    task = await commit(log, task, 'running', { upstreamRef: 'video-old' });
    task = await noteVideoPoll({ status: 'completed' }, task, log);
    expect(await noteVideoPoll({ status: 'completed' }, task, log)).toEqual(task);
    expect((await log.get(task.id))?.revision).toBe(task.revision);
  });

  it('查单清单仅接纳恢复命令能处理的已收单错误，不展示其他终态失败', () => {
    const task = { ...createTask({ kind: 'image', params }), status: 'failed' as const, upstreamRef: 'old-order' };
    expect(resumableTasks([{ ...task, error: { code: 'upstream_5xx', message: 'HTTP 500' } }])).toEqual([]);
    expect(resumableTasks([{ ...task, error: { code: 'provider_result_pending', message: '已收单' } }])).toHaveLength(1);
  });

  it('补记遇到较新版本时保留证据并报冲突，不套用新revision覆盖', async () => {
    const desired: LoggedTask = { ...createTask({ id: 'conflict-fixture', kind: 'image', params }), revision: 2, status: 'running', upstreamRef: 'old-order' };
    const pending = { desired, evidence: desired, error: 'fixture' };
    useTaskLogStore.setState({ unsaved: { [desired.id]: pending } });
    const get = vi.spyOn(browserTaskLog, 'get').mockResolvedValue({ ...desired, revision: 3 });
    const update = vi.spyOn(browserTaskLog, 'update').mockRejectedValue(new TaskPersistenceError({ code: 'conflict', message: '版本冲突', expectedRevision: 2, actualRevision: 3 }, desired));
    try {
      await expect(retryTaskSave(desired.id)).rejects.toMatchObject({ detail: { code: 'conflict' } });
      expect(update).toHaveBeenCalledExactlyOnceWith(desired);
      expect(useTaskLogStore.getState().unsaved[desired.id].desired.revision).toBe(2);
    } finally { get.mockRestore(); update.mockRestore(); useTaskLogStore.setState({ unsaved: {} }); }
  });

  it('重试本地补记只写已知快照，不调用网络或新建任务', async () => {
    const desired: LoggedTask = { ...createTask({ id: 'save-fixture', kind: 'image', params }), revision: 2, status: 'running', upstreamRef: 'old-order', phase: 'generating' };
    useTaskLogStore.setState({ unsaved: { [desired.id]: { desired, evidence: desired, error: 'fixture' } } });
    const get = vi.spyOn(browserTaskLog, 'get').mockResolvedValue(desired);
    const update = vi.spyOn(browserTaskLog, 'update').mockResolvedValue({ ...desired, revision: 3 });
    const create = vi.spyOn(browserTaskLog, 'create');
    try {
      await retryTaskSave(desired.id);
      expect(update).toHaveBeenCalledExactlyOnceWith(desired);
      expect(create).not.toHaveBeenCalled();
    } finally { get.mockRestore(); update.mockRestore(); create.mockRestore(); useTaskLogStore.setState({ unsaved: {} }); }
  });
});
