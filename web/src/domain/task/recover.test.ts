import { describe, expect, it } from 'vitest';

import { createTask, recoverPendingResult, transition, type Task } from './model';
import { readTaskOutcome } from './outcome';

const params = { kind: 'image' as const, prompt: '一只猫', model: 'openmoss/MOSS-Image-SFT', providerId: 'openai', inputAssetIds: [] };

/** 造一条「已收单、没拿到产物」的失败任务。 */
function pendingFailed(upstreamRef = 'tk-1'): Task {
  const running = transition(createTask({ kind: 'image', params, id: 'tk-x' }), 'running', { phase: 'submitting' });
  const task = running.ok ? running.value : createTask({ kind: 'image', params });
  const failed = transition(task, 'failed', { error: { code: 'provider_result_pending', message: '上游已收单' }, upstreamRef });
  if (!failed.ok) throw new Error('构造失败');
  return failed.value;
}

describe('凭原任务号取回产物', () => {
  it('已收单的失败单取回后转为成功，三态回到 allowed', () => {
    const recovered = recoverPendingResult(pendingFailed(), { resultAssetIds: ['asset-1', 'asset-2'], now: 1000 });
    expect(recovered.ok).toBe(true);
    if (!recovered.ok) return;
    expect(recovered.value.status).toBe('succeeded');
    expect(recovered.value.error).toBeNull();
    expect(recovered.value.resultAssetIds).toEqual(['asset-1', 'asset-2']);
    expect(recovered.value.finishedAt).toBe(1000);
    // 产物已经在手上，重新生成就是一个正常的新选择
    expect(readTaskOutcome(recovered.value)).toMatchObject({ phase: 'ready', regenerate: 'allowed' });
  });

  it('其他失败一律拒绝恢复：鉴权、审核、参数错不能借这条路变成成功', () => {
    for (const code of ['auth_failed', 'content_rejected', 'invalid_params', 'timeout', 'unknown'] as const) {
      const running = transition(createTask({ kind: 'image', params }), 'running', { phase: 'submitting' });
      if (!running.ok) throw new Error('构造失败');
      const failed = transition(running.value, 'failed', { error: { code, message: 'x' }, upstreamRef: 'tk-2' });
      if (!failed.ok) throw new Error('构造失败');
      expect(recoverPendingResult(failed.value, { resultAssetIds: ['a'] })).toMatchObject({ ok: false, error: { code: 'not_recoverable' } });
    }
  });

  it('还在跑的任务不走恢复（正常迁移即可），没有任务号的也不行', () => {
    const running = transition(createTask({ kind: 'image', params }), 'running', { phase: 'generating' });
    if (!running.ok) throw new Error('构造失败');
    expect(recoverPendingResult(running.value, { resultAssetIds: [] }).ok).toBe(false);
    expect(recoverPendingResult(pendingFailed(''), { resultAssetIds: [] }).ok).toBe(false);
  });
});
