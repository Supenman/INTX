import { describe, expect, it } from 'vitest';
import {
  canTransition,
  createTask,
  isTerminal,
  normalizeError,
  unchangedAfterModeration,
  setProgress,
  transition,
  type GenerationParams,
} from './model';
import { readTaskOutcome } from './outcome';

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
      error: { code: 'timeout', message: 'x' },
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
  it('鉴权失败归类为 auth_failed', () => {
    const e = normalizeError(new Error('401 Unauthorized'));
    expect(e.code).toBe('auth_failed');
  });

  it('限流归类为 rate_limited', () => {
    const e = normalizeError(new Error('429 rate limit exceeded'));
    expect(e.code).toBe('rate_limited');
  });

  it('内容拒绝归类为 content_rejected', () => {
    const e = normalizeError('content policy violation');
    expect(e.code).toBe('content_rejected');
  });

  it('HTTP 451 生成结果被安全审核拦下，归入 content_rejected 且引导改提示词', () => {
    // 真实原文：真机第一次出图时报的就是这一条
    const e = normalizeError(
      new Error('HTTP 451 The generated images appear to be unsafe. Try modifying the pronnpt or seeds.'),
    );
    expect(e.code).toBe('content_rejected');
    expect(e.message).toContain('451');
    expect(e.message).toContain('提示词');
    // 不能把英文原文直接甩给用户
    expect(e.message).not.toContain('unsafe');
  });

  it('只有 unsafe 没有状态码也能识别', () => {
    const e = normalizeError(new Error('blocked: the output was flagged as unsafe'));
    expect(e.code).toBe('content_rejected');
  });

  it('无法解析的内容仍归入 unknown', () => {
    const e = normalizeError('some weird thing');
    expect(e.code).toBe('unknown');
  });
});

/**
 * 提交不确定（照 BeefTV 的 `submission_uncertain` 补的）。
 *
 * 这组测试守的是一件事：**别让用户在「上游可能已经出图」的情况下点重试**。
 * 点了就是两次扣费，而且第二张出来之后没人说得清哪张是哪次。
 */
describe('normalizeError 的提交阶段判定', () => {
  it('提交阶段超时 → 不确定，落到 confirm（先去确认再重发）', () => {
    const e = normalizeError(new Error('request timeout'), 'submitting');
    expect(e.code).toBe('submission_uncertain');
    expect(readTaskOutcome({ status: 'failed', error: { code: e.code } })?.regenerate).toBe('confirm');
    expect(e.message).toContain('扣两次');
  });

  it('提交阶段 524（网关超时）也算不确定', () => {
    const e = normalizeError(new Error('HTTP 524: A timeout occurred'), 'submitting');
    expect(e.code).toBe('submission_uncertain');
  });

  it('提交阶段连接被拒 → 请求没出去，可重发（allowed）', () => {
    const e = normalizeError(new Error('connect ECONNREFUSED 127.0.0.1:8317'), 'submitting');
    expect(e.code).toBe('network');
    expect(readTaskOutcome({ status: 'failed', error: { code: e.code } })?.regenerate).toBe('allowed');
  });

  it('域名解析失败 → 请求没出去，可重发（allowed）', () => {
    const e = normalizeError(new Error('getaddrinfo ENOTFOUND api.example.com'), 'submitting');
    expect(readTaskOutcome({ status: 'failed', error: { code: e.code } })?.regenerate).toBe('allowed');
    expect(e.code).not.toBe('submission_uncertain');
  });

  it('提交阶段被明确拒绝（401/429/451）不算不确定', () => {
    expect(normalizeError(new Error('401 Unauthorized'), 'submitting').code).toBe('auth_failed');
    expect(normalizeError(new Error('429 too many requests'), 'submitting').code).toBe('rate_limited');
    expect(normalizeError(new Error('451 unsafe'), 'submitting').code).toBe('content_rejected');
  });

  it('生成阶段超时仍是普通超时——可重发（allowed）', () => {
    const e = normalizeError(new Error('request timeout'), 'generating');
    expect(e.code).toBe('timeout');
    expect(readTaskOutcome({ status: 'failed', error: { code: e.code } })?.regenerate).toBe('allowed');
  });

  it('不传阶段时行为与旧版一致，不误判', () => {
    expect(normalizeError(new Error('request timeout')).code).toBe('timeout');
  });
});

describe('unchangedAfterModeration', () => {
  const rejected = normalizeError(new Error('451 unsafe'));

  it('审核失败且提示词一字未改 → 拦下', () => {
    expect(unchangedAfterModeration(rejected, 'a cat', 'a cat')).toBe(true);
  });

  it('改了提示词 → 放行', () => {
    expect(unchangedAfterModeration(rejected, 'a cat', 'a cat, fluffy')).toBe(false);
  });

  it('上一次不是审核失败 → 不拦', () => {
    expect(unchangedAfterModeration(normalizeError(new Error('timeout')), 'a cat', 'a cat')).toBe(false);
  });

  it('没有历史失败 → 不拦', () => {
    expect(unchangedAfterModeration(null, 'a cat', 'a cat')).toBe(false);
  });
});
