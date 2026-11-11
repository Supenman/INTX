import { describe, expect, it } from 'vitest';
import {
  canRegenerate,
  isRegenerateBlocked,
  readTaskOutcome,
  type OutcomeSource,
} from './outcome';

const src = (over: Partial<OutcomeSource> = {}): OutcomeSource => ({ status: 'failed', ...over });
const err = (code: string): OutcomeSource['error'] => ({ code, message: 'x' });

/**
 * 这组测试守的是「别让用户白花钱」：凡是上游可能已经出图、已经计费、
 * 或者不改条件重试必然还是同样结果的失败，都不能落到 allowed。
 *
 * 三态是照 BeefTV 的判定骨架写的，但映射按 INTX 错误码重做——它没有
 * local_save_failed，我们有；它有 /recover 免费取回，我们没有。
 */
describe('readTaskOutcome · 非终态与成功', () => {
  it('排队 / 运行中一律 blocked，不给重发', () => {
    expect(readTaskOutcome(src({ status: 'queued' }))).toEqual({
      phase: 'working', regenerate: 'blocked', reason: 'task_queued',
    });
    expect(readTaskOutcome(src({ status: 'running', phase: 'generating' }))?.reason).toBe('task_running');
    expect(readTaskOutcome(src({ status: 'running', phase: 'downloading' }))?.reason).toBe('result_downloading');
    expect(isRegenerateBlocked(readTaskOutcome(src({ status: 'running' })))).toBe(true);
  });

  it('成功可以再生成一次', () => {
    expect(readTaskOutcome(src({ status: 'succeeded' }))).toEqual({
      phase: 'ready', regenerate: 'allowed', reason: 'result_ready',
    });
  });

  it('取消没扣钱，直接 allowed', () => {
    expect(readTaskOutcome(src({ status: 'canceled' }))?.reason).toBe('not_charged');
    expect(readTaskOutcome(src({ status: 'canceled' }))?.regenerate).toBe('allowed');
  });
});

describe('readTaskOutcome · 必须先确认的失败', () => {
  it('提交不确定 → 先去厂商后台确认', () => {
    const o = readTaskOutcome(src({ error: err('submission_uncertain') }));
    expect(o).toEqual({ phase: 'failed', regenerate: 'confirm', reason: 'submission_unknown' });
  });

  it('产物已出但存盘失败 → 已经计费，先清磁盘', () => {
    const o = readTaskOutcome(src({ error: err('local_save_failed') }));
    expect(o?.reason).toBe('already_charged_save_failed');
    expect(o?.regenerate).toBe('confirm');
  });

  it('鉴权失败 → 先改配置', () => {
    expect(readTaskOutcome(src({ error: err('auth_failed') }))?.reason).toBe('config_required');
  });

  it('审核拒绝 / 参数非法 → 先改提示词', () => {
    expect(readTaskOutcome(src({ error: err('content_rejected') }))?.reason).toBe('input_rejected');
    expect(readTaskOutcome(src({ error: err('invalid_params') }))?.reason).toBe('input_rejected');
  });

  it('confirm 不是 blocked：允许把状态重置回队列，但 UI 要写明先做什么', () => {
    const o = readTaskOutcome(src({ error: err('auth_failed') }));
    expect(canRegenerate(o)).toBe(true);
    expect(isRegenerateBlocked(o)).toBe(false);
  });
});

describe('readTaskOutcome · 可以直接重发', () => {
  it.each(['timeout', 'upstream_5xx', 'network', 'rate_limited', 'unknown'])(
    '%s 归 transient_failure',
    (code) => {
      const o = readTaskOutcome(src({ error: err(code) }));
      expect(o).toEqual({ phase: 'failed', regenerate: 'allowed', reason: 'transient_failure' });
    },
  );

  it('没写错误码的失败也按可重试处理，不把用户卡死', () => {
    expect(readTaskOutcome(src())?.regenerate).toBe('allowed');
  });
});

describe('readTaskOutcome · 优先级', () => {
  it('分镜部分成功优先于错误码：已出的图已经计费，不能整单重发', () => {
    const o = readTaskOutcome(src({ error: err('timeout'), resultAssetIds: ['as_1', 'as_2'] }));
    expect(o?.reason).toBe('partial_results');
    expect(o?.regenerate).toBe('confirm');
  });

  it('上游任务号存在但没拿到产物 → 先去查，别再买一张', () => {
    const o = readTaskOutcome(src({ error: err('timeout'), upstreamRef: 'req-42' }));
    expect(o?.reason).toBe('provider_result_pending');
    expect(o?.regenerate).toBe('confirm');
  });

  it('明确的确认码优先于上游任务号', () => {
    const o = readTaskOutcome(src({ error: err('submission_uncertain'), upstreamRef: 'req-42' }));
    expect(o?.reason).toBe('submission_unknown');
  });
});

describe('readTaskOutcome · 容错', () => {
  it('信息不足返回 null，UI 走兜底而不是猜', () => {
    expect(readTaskOutcome(null)).toBeNull();
    expect(readTaskOutcome({ status: 'weird_status' })).toBeNull();
  });

  it('未知错误码不崩，按可重试处理', () => {
    expect(readTaskOutcome(src({ error: err('some_new_code') }))?.regenerate).toBe('allowed');
  });

  it('旧存档里 status 带空格也能认', () => {
    expect(readTaskOutcome(src({ status: '  succeeded  ' }))?.phase).toBe('ready');
  });

  it('只有 error 没有 status 也按失败处理（旧数据可能缺字段）', () => {
    expect(readTaskOutcome({ status: '', error: err('timeout') })?.phase).toBe('failed');
  });
});
