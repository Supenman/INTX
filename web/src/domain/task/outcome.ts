/**
 * 任务结果收敛：把「这次生成到底能不能重发」算成一张纯函数表。
 *
 * 设计判断来自 BeefTV v2.2.0 `web/src/lib/task-outcome.ts`
 * （BeefTV Source Available License 1.0, Part A §3；版权与许可证见 THIRD_PARTY_NOTICES.md）。
 *
 * 它用 `regenerate: allowed | confirm | blocked` 三态，而不是布尔 retryable：
 * 布尔表达不了「先确认 / 改条件之后才能重发」——这类失败既不是能直接重试，
 * 也不是永远不许重试。我们上一轮把 submission_uncertain 硬编码成 CanvasNode
 * 里的一个特判分支，正是它要解决的问题：判定逻辑散在渲染里，每加一个错误码
 * 就要改一次 UI。现在 UI 只查 regenerate，新增错误码只改这张表。
 *
 * 没有照搬的部分（INTX 能力不同，照抄会错）：
 * - 去掉 `retrievable` 阶段：它有 /recover 免费取回原任务，我们无后端做不到。
 *   所以「提交不确定」在这里落到 confirm（人去厂商后台确认后重发），不是 blocked。
 * - 去掉 TaskOutcomeCopy 的中文文案：reason 是机器码，展示文案集中放 ui 层。
 *   它自己的 AGENTS.md 第 68 行也禁止解析 msg 判类型，我们保持这个边界。
 * - 去掉 CanvasNodeOutcomeMetadata 回退：我们直接读 Task，不需要兼容旧节点元数据。
 */
import type { TaskPhase, TaskStatus } from './model';

export const REGENERATE_POLICIES = ['allowed', 'confirm', 'blocked'] as const;
export type RegeneratePolicy = (typeof REGENERATE_POLICIES)[number];

export type OutcomePhase = 'working' | 'ready' | 'failed';

/** 机器码，不是给人看的文案。UI 按它挑提示语，不解析错误文本。 */
export type OutcomeReason =
  | 'task_queued'
  | 'task_running'
  | 'result_downloading'
  | 'result_ready'
  | 'not_charged'
  | 'submission_unknown'
  | 'already_charged_save_failed'
  | 'config_required'
  | 'input_rejected'
  | 'partial_results'
  | 'provider_result_pending'
  | 'transient_failure';

export interface TaskOutcome {
  phase: OutcomePhase;
  regenerate: RegeneratePolicy;
  reason: OutcomeReason;
}

/** 只挑判定需要的字段，Task 天然满足这个形状，旧存档也能手写构造来验。 */
export interface OutcomeSource {
  status: TaskStatus | string;
  phase?: TaskPhase | string | null;
  error?: { code?: string; message?: string } | null;
  resultAssetIds?: readonly string[] | null;
  upstreamRef?: string | null;
}

/**
 * 上游已经扣过钱、或者必须先改条件才能再发一次的码。
 *
 * 与 BeefTV 的 LEGACY_INPUT_REJECTED / LEGACY_RETRIEVABLE 对应，但按 INTX
 * 的错误码重新映射：它没有 `local_save_failed`，我们有；它有 `/recover`，我们没有。
 */
const CONFIRM_BY_CODE: Readonly<Record<string, OutcomeReason>> = {
  submission_uncertain: 'submission_unknown',
  local_save_failed: 'already_charged_save_failed',
  auth_failed: 'config_required',
  content_rejected: 'input_rejected',
  invalid_params: 'input_rejected',
  provider_result_pending: 'provider_result_pending',
};

const ok = (
  phase: OutcomePhase,
  regenerate: RegeneratePolicy,
  reason: OutcomeReason,
): TaskOutcome => ({ phase, regenerate, reason });

/**
 * 从任务字段推导结果。返回 null 表示「信息不足，不要瞎猜」——UI 遇到 null
 * 走兜底，不允许自己根据文案猜一个状态出来。
 */
export function readTaskOutcome(source: OutcomeSource | null | undefined): TaskOutcome | null {
  if (!source) return null;
  const status = typeof source.status === 'string' ? source.status.trim() : '';
  const code = typeof source.error?.code === 'string' ? source.error.code.trim() : '';
  const hasResults = Array.isArray(source.resultAssetIds) && source.resultAssetIds.length > 0;

  if (status === 'queued') return ok('working', 'blocked', 'task_queued');
  if (status === 'running') {
    return source.phase === 'downloading'
      ? ok('working', 'blocked', 'result_downloading')
      : ok('working', 'blocked', 'task_running');
  }
  if (status === 'succeeded') return ok('ready', 'allowed', 'result_ready');

  // 用户主动取消 / 请求根本没发出去：没扣钱，可以直接重发
  if (status === 'canceled') return ok('failed', 'allowed', 'not_charged');

  if (status === 'failed' || code || source.error) {
    // 分镜部分成功：前几格已经落盘、已经计费，整单重发会重复扣费
    if (hasResults) return ok('failed', 'confirm', 'partial_results');

    const confirmReason = CONFIRM_BY_CODE[code];
    if (confirmReason) return ok('failed', 'confirm', confirmReason);

    // 上游给过任务号却没拿到产物：先去厂商后台确认，别直接再买一张
    if (typeof source.upstreamRef === 'string' && source.upstreamRef.trim()) {
      return ok('failed', 'confirm', 'provider_result_pending');
    }

    // 剩下都是限流 / 超时 / 5xx / 网络 / 未知：原样重试是合理的
    return ok('failed', 'allowed', 'transient_failure');
  }

  return null;
}

/** 任务还在跑，或者结果已经在了但不允许重发。store 层也用这条守住入口。 */
export function isRegenerateBlocked(outcome: TaskOutcome | null): boolean {
  return outcome?.regenerate === 'blocked';
}

/** allowed 和 confirm 都允许把状态重置回队列；confirm 的「确认」由 UI 文案承担。 */
export function canRegenerate(outcome: TaskOutcome | null): boolean {
  return outcome?.regenerate === 'allowed' || outcome?.regenerate === 'confirm';
}
