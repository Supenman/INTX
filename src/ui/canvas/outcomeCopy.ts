/**
 * 失败态的展示文案。集中放一张表，CanvasNode 只查字段、不写分支。
 *
 * 之所以不放在 domain：reason 是机器码，文案是展示层的事。BeefTV 把
 * TaskOutcomeCopy 塞在 lib/task-outcome.ts 里，导致判定逻辑和中文文案混在
 * 同一个文件；它自己 AGENTS.md 第 68 行还禁止解析 msg 判类型。我们把这个
 * 边界守干净——加错误码改 domain 的表，改文案改这里，两处都不动渲染。
 */
import type { OutcomeReason, TaskOutcome } from '@/domain';

interface OutcomeCopy {
  /** 前缀符号，让「不确定」和「明确失败」一眼可分 */
  badge: string;
  /** 悬停说明：告诉用户下一步该做什么、以及为什么不能直接重试 */
  hint: string;
  /** 按钮文字；blocked 时不会渲染按钮，这里给空串 */
  action: string;
}

const COPY: Readonly<Record<OutcomeReason, OutcomeCopy>> = {
  task_queued: { badge: '', hint: '排队中', action: '' },
  task_running: { badge: '', hint: '生成中', action: '' },
  result_downloading: { badge: '', hint: '正在取回结果', action: '' },
  result_ready: { badge: '✓', hint: '已完成', action: '重置状态' },

  not_charged: {
    badge: '✕',
    hint: '这次没有产生费用（用户取消或请求未发出），可以直接重发。',
    action: '重新生成',
  },
  submission_unknown: {
    badge: '?',
    hint: '请求发出后没等到回复。上游可能已经收到并开始出图，也可能没有。先去厂商后台看一眼账单和任务列表，确认没出图之后再重发，否则可能扣两次钱。',
    action: '确认没过，可重发',
  },
  already_charged_save_failed: {
    badge: '?',
    hint: '上游已经出图、这次已经计费，只是没存到本机。先清出磁盘空间再重发；直接重试等于再买一张。',
    action: '清完磁盘再重发',
  },
  config_required: {
    badge: '✕',
    hint: '鉴权没通过，原样重试还是会被拒。先去配置里改好 API Key，再回来重发。',
    action: '改好配置再重发',
  },
  input_rejected: {
    badge: '✕',
    hint: '内容或参数被上游拒绝，同一份提示词再发一次还是会被拒。改一下提示词再重发。',
    action: '改提示词再重发',
  },
  partial_results: {
    badge: '!',
    hint: '这批里有几格已经出图并计费，已保留在节点上。整单重发会重复扣费，确认确实要补出剩下的再点。',
    action: '确认后重发（已出的保留）',
  },
  provider_result_pending: {
    badge: '?',
    hint: '上游给过任务号但本地没拿到产物。先去厂商后台确认那次有没有出图，再决定要不要重发。',
    action: '确认后重发',
  },
  transient_failure: {
    badge: '✕',
    hint: '限流、超时、上游异常或网络问题。原样重试是合理的。',
    action: '重置状态',
  },
};

const FALLBACK: OutcomeCopy = {
  badge: '✕',
  hint: '这次生成失败了。',
  action: '重置状态',
};

export function outcomeCopy(outcome: TaskOutcome | null): OutcomeCopy {
  return outcome ? COPY[outcome.reason] : FALLBACK;
}
