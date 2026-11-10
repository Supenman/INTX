import { describe, expect, it } from 'vitest';
import {
  canTransition,
  createTask,
  isTerminal,
  normalizeError,
  setProgress,
  transition,
  type GenerationParams,
} from './model';

const params: GenerationParams = {
  kind: 'image',
  prompt: 'a cat',
  model: 'openai/gpt-image-1',
  providerId: 'openai',
  inputAssetIds: ['as1'],
};

function makeTask() {
  return createTask({ kind: 'image', params, nodeId: 'n1', now: 1000, id: 'tk1' });
}

describe('createTask', () => {
  it('初始状态是 queued，无进度无错误', () => {
    const t = makeTask();
    expect(t.status).toBe('queued');
    expect(t.phase).toBeNull();
    expect(t.upstreamProgress).toBeNull();
    expect(t.error).toBeNull();
    expect(t.attempt).toBe(1);
  });

  it('参数被快照：外部改动不影响已建任务', () => {
    const mutable: GenerationParams = { ...params, inputAssetIds: ['as1'] };
    const t = createTask({ kind: 'image', params: mutable });
    mutable.inputAssetIds = ['CHANGED'];
    mutable.prompt = 'changed';
    expect(t.params.inputAssetIds).toEqual(['as1']);
    expect(t.params.prompt).toBe('a cat');
  });

  it('快照数组不可变', () => {
    const t = makeTask();
    expect(Object.isFrozen(t.params.inputAssetIds)).toBe(true);
  });
});

describe('状态机', () => {
  it('合法路径 queued → running → succeeded', () => {
    const t = makeTask();
    const r1 = transition(t, 'running', { now: 2000 });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.value.phase).toBe('submitting');
    expect(r1.value.startedAt).toBe(2000);

    const r2 = transition(r1.value, 'succeeded', { now: 3000, resultAssetIds: ['as9'] });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.value.finishedAt).toBe(3000);
    expect(r2.value.phase).toBeNull();
    expect(r2.value.resultAssetIds).toEqual(['as9']);
  });

  it('禁止 queued 直接跳 succeeded', () => {
    const r = transition(makeTask(), 'succeeded');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('illegal_transition');
  });

  it('终态不能再迁移（除重试回队列）', () => {
    const t = makeTask();
    const running = transition(t, 'running');
    if (!running.ok) throw new Error('setup');
    const failed = transition(running.value, 'failed', { now: 5 });
    if (!failed.ok) throw new Error('setup');

    expect(isTerminal(failed.value.status)).toBe(true);
    const again = transition(failed.value, 'running');
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe('terminal_state');
  });

  it('失败后可重试：回到 queued 且 attempt 递增、清空错误', () => {
    const running = transition(makeTask(), 'running');
    if (!running.ok) throw new Error('setup');
    const failed = transition(running.value, 'failed', {
      error: { code: 'timeout', message: 'x', retryable: true },
    });
    if (!failed.ok) throw new Error('setup');

    const retry = transition(failed.value, 'queued', { now: 9999 });
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.value.status).toBe('queued');
    expect(retry.value.attempt).toBe(2);
    expect(retry.value.error).toBeNull();
    expect(retry.value.finishedAt).toBeNull();
    // 参数快照在重试时原样保留
    expect(retry.value.params.prompt).toBe('a cat');
  });

  it('canTransition 与迁移表一致', () => {
    expect(canTransition('queued', 'running')).toBe(true);
    expect(canTransition('queued', 'failed')).toBe(false);
    expect(canTransition('running', 'queued')).toBe(false);
    expect(canTransition('succeeded', 'canceled')).toBe(false);
  });
});

describe('setProgress', () => {
  it('接受 0–1', () => {
    const r = setProgress(makeTask(), 0.42);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.upstreamProgress).toBe(0.42);
  });

  it('null 表示不确定态，而不是 0', () => {
    const r = setProgress(makeTask(), null);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.upstreamProgress).toBeNull();
  });

  it('越界值直接拒绝，不做静默 clamp', () => {
    expect(setProgress(makeTask(), 1.5).ok).toBe(false);
    expect(setProgress(makeTask(), -0.1).ok).toBe(false);
    expect(setProgress(makeTask(), Number.NaN).ok).toBe(false);
  });
});

describe('normalizeError', () => {
  it('鉴权失败不可重试', () => {
    const e = normalizeError(new Error('401 Unauthorized'));
    expect(e.code).toBe('auth_failed');
    expect(e.retryable).toBe(false);
  });

  it('限流可重试', () => {
    const e = normalizeError(new Error('429 rate limit exceeded'));
    expect(e.code).toBe('rate_limited');
    expect(e.retryable).toBe(true);
  });

  it('内容拒绝不可重试', () => {
    const e = normalizeError('content policy violation');
    expect(e.code).toBe('content_rejected');
    expect(e.retryable).toBe(false);
  });

  it('无法解析的内容仍归入 unknown 且可重试', () => {
    const e = normalizeError('some weird thing');
    expect(e.code).toBe('unknown');
    expect(e.retryable).toBe(true);
  });
});
