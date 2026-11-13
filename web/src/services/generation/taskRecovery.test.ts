import { describe, expect, it } from 'vitest';

import { createTask, transition, type GenerationParams, type Task } from '@/domain/task/model';
import { commitRecovered, createMemoryTaskLog, markInFlight, resumableTasks, TaskPersistenceError } from './taskLog';
import { pickModelScopeChannel, recoveryAction } from './taskRecovery';

function taskWith(partial: Partial<Task> & { params?: GenerationParams } = {}): Task {
  const created = createTask({
    kind: partial.kind ?? 'image',
    params: partial.params ?? { kind: 'image', prompt: '一只猫', model: 'openmoss/MOSS-Image-SFT', providerId: 'openai', inputAssetIds: [] },
  });
  return { ...created, ...partial, params: partial.params ?? created.params };
}

const running: Task = (() => {
  const created = createTask({ kind: 'image', params: { kind: 'image', prompt: 'p', model: 'm', providerId: 'openai', inputAssetIds: [] } });
  const result = transition(created, 'running', { phase: 'submitting' });
  if (!result.ok) throw new Error('构造失败');
  return result.value;
})();

const msChannel = { name: 'ModelScope', baseUrl: 'https://api-inference.modelscope.cn/v1', apiKey: 'fixture-only' };

describe('ModelScope 渠道选择', () => {
  it('只认官方端点且配了 Key 的渠道', () => {
    expect(pickModelScopeChannel([msChannel])).toBe(msChannel);
    expect(pickModelScopeChannel([{ ...msChannel, baseUrl: 'https://www.modelscope.cn/v1' }])).toBeNull();
    expect(pickModelScopeChannel([{ ...msChannel, baseUrl: 'https://api-inference.modelscope.cn.evil.com/v1' }])).toBeNull();
    expect(pickModelScopeChannel([{ ...msChannel, apiKey: '   ' }])).toBeNull();
    expect(pickModelScopeChannel([{ name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiKey: 'k' }])).toBeNull();
  });

  it('多个候选时取第一个可用的', () => {
    const openai = { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiKey: 'k' };
    const second = { ...msChannel, apiKey: 'fixture-only' };
    expect(pickModelScopeChannel([openai, msChannel, second])).toBe(msChannel);
  });
});

describe('待核实任务按协议选查单方式', () => {
  const modelscopeImage = taskWith({ kind: 'image', upstreamRef: 'tk-1', status: 'failed', params: { kind: 'image', prompt: 'p', model: 'm', providerId: 'openai', inputAssetIds: [], extras: { endpoint: 'modelscope' } } });

  it('ModelScope 出图单：有渠道就能查，没渠道只能手工核对', () => {
    expect(recoveryAction(modelscopeImage, msChannel)).toBe('modelscope');
    expect(recoveryAction(modelscopeImage, null)).toBe('manual');
  });

  it('普通同步出图单不会被推荐用 ModelScope 查', () => {
    expect(recoveryAction(taskWith({ kind: 'image', upstreamRef: 'tk-2' }), msChannel)).toBe('manual');
  });

  it('视频单按视频协议查，未知协议交回人工', () => {
    for (const provider of ['openai', 'gemini', 'plugin']) {
      expect(recoveryAction(taskWith({ kind: 'video', upstreamRef: 'v-1', params: { kind: 'video', prompt: 'p', model: 'm', providerId: provider, inputAssetIds: [] } }), null)).toBe('video');
    }
    expect(recoveryAction(taskWith({ kind: 'video', upstreamRef: 'v-2', params: { kind: 'video', prompt: 'p', model: 'm', providerId: 'unknown', inputAssetIds: [] } }), null)).toBe('manual');
  });

  it('没有任务号的单一律交回人工', () => {
    expect(recoveryAction(taskWith({ kind: 'image', upstreamRef: null }), msChannel)).toBe('manual');
    expect(recoveryAction(running, msChannel)).toBe('manual');
  });
});

describe('待核实清单', () => {
  it('本进程正在跑的单不算待核实，跑完（失败留号）才进列表', async () => {
    const log = createMemoryTaskLog();
    const task = await log.create({ kind: 'image', params: { kind: 'image', prompt: 'p', model: 'm', providerId: 'openai', inputAssetIds: [] } });
    const started = transition(task, 'running', { phase: 'generating' });
    if (!started.ok) throw new Error('构造失败');
    await log.update({ ...started.value, revision: task.revision, upstreamRef: 'tk-live' });
    markInFlight(task.id, true);
    try {
      expect(resumableTasks(await log.list())).toHaveLength(0);
    } finally {
      markInFlight(task.id, false);
    }
    expect(resumableTasks(await log.list())).toHaveLength(1);
  });
});

describe('取回产物写回台账', () => {
  it('轮询被打断的 running 单正常转成功', async () => {
    const log = createMemoryTaskLog();
    const task = await log.create({ kind: 'image', params: { kind: 'image', prompt: 'p', model: 'm', providerId: 'openai', inputAssetIds: [] } });
    const started = transition(task, 'running', { phase: 'generating', upstreamRef: 'tk-interrupted' });
    if (!started.ok) throw new Error('构造失败');
    const saved = await log.update({ ...started.value, revision: task.revision });
    const next = await commitRecovered(log, saved, ['asset-1']);
    expect(next.status).toBe('succeeded');
    expect(next.upstreamRef).toBe('tk-interrupted');
    expect((await log.list())[0]!.resultAssetIds).toEqual(['asset-1']);
  });

  it('已收单的失败单走受限恢复，其他失败拒绝恢复且不动', async () => {
    const log = createMemoryTaskLog();
    const task = await log.create({ kind: 'image', params: { kind: 'image', prompt: 'p', model: 'm', providerId: 'openai', inputAssetIds: [] } });
    const started = transition(task, 'running', { phase: 'generating' });
    if (!started.ok) throw new Error('构造失败');
    const saved = await log.update({ ...started.value, revision: task.revision });
    const pending = transition(saved, 'failed', { error: { code: 'provider_result_pending', message: '已收单' }, upstreamRef: 'tk-9' });
    if (!pending.ok) throw new Error('构造失败');
    const savedPending = await log.update({ ...pending.value, revision: saved.revision });
    await commitRecovered(log, savedPending, ['asset-2']);
    expect((await log.get(task.id))!.status).toBe('succeeded');

    const auth = await log.create({ id: 'auth-task', kind: 'image', params: task.params });
    const authStarted = transition(auth, 'running', { phase: 'generating' });
    if (!authStarted.ok) throw new Error('构造失败');
    const savedAuthStarted = await log.update({ ...authStarted.value, revision: auth.revision });
    const authFailed = transition(savedAuthStarted, 'failed', { upstreamRef: 'tk-10', error: { code: 'auth_failed', message: 'x' } });
    if (!authFailed.ok) throw new Error('构造失败');
    const savedAuth = await log.update({ ...authFailed.value, revision: savedAuthStarted.revision });
    await expect(commitRecovered(log, savedAuth, ['asset-3'])).rejects.toBeInstanceOf(TaskPersistenceError);
    expect(await log.get(auth.id)).toEqual(savedAuth);
  });
});
