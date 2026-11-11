import { createId } from '../shared/id';
import { err, ok, type Result } from '../shared/result';
import type { AssetKind } from '../asset/model';

/**
 * Task —— 一次生成任务的完整生命周期。
 *
 * 三个设计要点（都是对旧实现的纠偏）：
 *
 * 1. `params` 是**快照**。旧代码直接读节点的 data 去请求，节点参数一改，
 *    历史记录就还原不出"当时到底发了什么"。这里提交那一刻冻结参数。
 *
 * 2. `upstreamProgress` 允许 null。旧代码后端写死 10→30→70→100，
 *    前端还挂着 `// Fake progress animation`，两边一起演戏。
 *    没有真进度就明确表示为"不确定"，UI 用不确定态动画。
 *
 * 3. `error.code` 是枚举。旧代码把任意异常字符串塞进 `task.error`，
 *    前端只能原样显示。有了 code，UI 才能给出对应动作：
 *    auth_failed → 去配置；rate_limited → 稍后重试；content_rejected → 改提示词。
 */

export const TASK_KINDS = ['text', 'image', 'video'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const TASK_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'canceled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** 真实阶段。注意这是"阶段"不是"百分比"——阶段是离散且可信的。 */
export const TASK_PHASES = ['submitting', 'generating', 'downloading'] as const;
export type TaskPhase = (typeof TASK_PHASES)[number];

export type ErrorCode =
  | 'auth_failed'
  | 'rate_limited'
  | 'content_rejected'
  | 'timeout'
  | 'upstream_5xx'
  | 'network'
  | 'invalid_params'
  | 'unknown';

export interface TaskError {
  code: ErrorCode;
  message: string;
  /** 是否值得原样重试。auth_failed 重试没用，要先改配置。 */
  retryable: boolean;
}

/**
 * 一次生成的成本估算。金额来自模型单价（见 ModelPricing）的本地估算，
 * 不是厂商返回的精确账单——公司内部分摊看的是相对值。
 *
 * `basis` 记录「这笔钱怎么算出来的」，审计时能回溯，而不是一个孤立的数字。
 * 没有单价可估时整条为 null，绝不编一个 0 假装「免费」。
 */
export interface CostRecord {
  amount: number;
  currency: string;
  /** 例如 'image × 1 @ demo/image' 或 'text ≈ 240 tokens @ gpt-4o-mini' */
  basis: string;
}

/** 生成参数快照。字段全部显式，不塞 unknown 开放字典。 */
export interface GenerationParams {
  kind: TaskKind;
  prompt: string;
  /** 模型标识，格式 providerId/modelName */
  model: string;
  providerId: string;
  /** 输入资产引用（顺序有意义：第一张常被厂商当主参考图） */
  inputAssetIds: readonly string[];
  aspectRatio?: string;
  resolution?: string;
  durationSec?: number;
  /** 厂商特定参数，键值对由适配器解释 */
  extras?: Readonly<Record<string, string | number | boolean>>;
}

export interface Task {
  id: string;
  /** 发起它的节点。可为 null：未来 Agent 直接建任务，不挂在节点上。 */
  nodeId: string | null;
  kind: TaskKind;
  params: GenerationParams;
  status: TaskStatus;
  phase: TaskPhase | null;
  /** 上游厂商的真实进度 0–1；拿不到就是 null，不要编造 */
  upstreamProgress: number | null;
  resultAssetIds: string[];
  error: TaskError | null;
  /** 厂商侧的任务引用，后端重启后可凭它续上轮询 */
  upstreamRef: string | null;
  attempt: number;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  /** 成本估算（见 CostRecord）。生成本地估算，未配置单价则为 null。 */
  cost: CostRecord | null;
}

/** 哪些状态是终态——终态之间不允许再迁移。 */
const TERMINAL: ReadonlySet<TaskStatus> = new Set(['succeeded', 'failed', 'canceled']);

/** 合法迁移表。用表驱动而不是散落的 if，新增状态时改一处。 */
const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  queued: ['running', 'canceled'],
  running: ['succeeded', 'failed', 'canceled'],
  succeeded: [],
  failed: ['queued'], // 允许重试：回到队列
  canceled: ['queued'], // 允许重来
};

export type TaskTransitionError =
  | { code: 'illegal_transition'; from: TaskStatus; to: TaskStatus }
  | { code: 'terminal_state'; message: string }
  | { code: 'invalid_progress'; value: number };

export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL.has(status);
}

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface CreateTaskInput {
  kind: TaskKind;
  params: GenerationParams;
  nodeId?: string | null;
  now?: number;
  id?: string;
}

export function createTask(input: CreateTaskInput): Task {
  const now = input.now ?? Date.now();
  return {
    id: input.id ?? createId('tk'),
    nodeId: input.nodeId ?? null,
    kind: input.kind,
    params: freezeParams(input.params),
    status: 'queued',
    phase: null,
    upstreamProgress: null,
    resultAssetIds: [],
    error: null,
    upstreamRef: null,
    attempt: 1,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
    cost: null,
  };
}

function freezeParams(p: GenerationParams): GenerationParams {
  const out: GenerationParams = {
    kind: p.kind,
    prompt: p.prompt,
    model: p.model,
    providerId: p.providerId,
    inputAssetIds: Object.freeze([...p.inputAssetIds]),
  };
  if (p.aspectRatio !== undefined) out.aspectRatio = p.aspectRatio;
  if (p.resolution !== undefined) out.resolution = p.resolution;
  if (p.durationSec !== undefined) out.durationSec = p.durationSec;
  if (p.extras !== undefined) out.extras = Object.freeze({ ...p.extras });
  return out;
}

export interface TransitionOptions {
  now?: number;
  upstreamRef?: string | null;
  phase?: TaskPhase | null;
  error?: TaskError | null;
  resultAssetIds?: string[];
  /** 成本估算，成功时由用例层算好传入并冻结进任务。 */
  cost?: CostRecord | null;
}

/**
 * 状态迁移的单一入口。所有状态变化都走这里，
 * 保证「终态不可再变」「非法迁移被拒绝」这两条不靠自觉。
 */
export function transition(task: Task, to: TaskStatus, opts: TransitionOptions = {}): Result<Task, TaskTransitionError> {
  const now = opts.now ?? Date.now();

  if (isTerminal(task.status) && to !== 'queued') {
    return err({
      code: 'terminal_state',
      message: `任务已处于终态 ${task.status}，不能再迁移到 ${to}`,
    });
  }
  if (!canTransition(task.status, to)) {
    return err({ code: 'illegal_transition', from: task.status, to });
  }

  const next: Task = { ...task, status: to };

  if (to === 'running') {
    next.startedAt = task.startedAt ?? now;
    next.phase = opts.phase ?? 'submitting';
    next.error = null;
  }
  if (to === 'queued') {
    // 重试路径：保留 params 快照，attempt 累加，清空上次的失败痕迹
    next.startedAt = null;
    next.finishedAt = null;
    next.phase = null;
    next.error = null;
    next.upstreamProgress = null;
    next.upstreamRef = null;
    if (isTerminal(task.status)) {
      next.attempt = task.attempt + 1;
    }
  }
  if (to === 'succeeded' || to === 'failed' || to === 'canceled') {
    next.finishedAt = now;
    next.phase = null;
  }
  if (to === 'failed') {
    next.error = opts.error ?? { code: 'unknown', message: '未知错误', retryable: true };
  }
  // 取消也可以带原因（例如「应用重启，任务没跑完」）。
  // 没有原因时保持 null，别编一个。
  if (to === 'canceled' && opts.error) {
    next.error = opts.error;
  }
  if (opts.resultAssetIds) {
    next.resultAssetIds = [...opts.resultAssetIds];
  }
  if (opts.cost !== undefined) {
    next.cost = opts.cost;
  }
  if (opts.phase !== undefined && next.status === 'running') {
    next.phase = opts.phase;
  }
  if (opts.upstreamRef !== undefined) {
    next.upstreamRef = opts.upstreamRef;
  }
  return ok(next);
}

/** 更新上游进度。非法值直接拒绝，不做静默 clamp——静默反而掩盖适配器 bug。 */
export function setProgress(task: Task, value: number | null): Result<Task, TaskTransitionError> {
  if (value === null) {
    return ok({ ...task, upstreamProgress: null });
  }
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    return err({ code: 'invalid_progress', value });
  }
  return ok({ ...task, upstreamProgress: value });
}

/** 把任意异常归一化成 TaskError。适配器抛什么都能收敛到可展示的结构。 */
export function normalizeError(e: unknown): TaskError {
  const raw = e instanceof Error ? e.message : String(e);
  const lower = raw.toLowerCase();

  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('api key')) {
    return { code: 'auth_failed', message: '鉴权失败，请检查 API Key 配置', retryable: false };
  }
  if (lower.includes('429') || lower.includes('rate limit')) {
    return { code: 'rate_limited', message: '请求过于频繁，请稍后重试', retryable: true };
  }
  /**
   * HTTP 451 / unsafe：上游的安全审核拦下了**生成出来的图**，不是请求没发出去。
   * 第一次真机出图就撞上这条：原文是「The generated images appear to be unsafe.
   * Try modifying the prompt or seeds.」旧代码不认识它，落进 unknown，于是卡片上
   * 糊着一段英文原文加 request id，用户既读不懂也不知道下一步该做什么。
   *
   * 不能归成 5xx 或 network：那不是「过一会儿再试」能解决的，原样重试大概率
   * 还是同一张被拦的图。所以 retryable 给 false，让 UI 引导去改提示词。
   */
  if (/\b451\b/.test(raw) || lower.includes('unsafe') || lower.includes('moderation')) {
    return {
      code: 'content_rejected',
      message: '上游安全审核拦下了这次出图（HTTP 451），改一下提示词或换个 seed 再试',
      retryable: false,
    };
  }
  if (lower.includes('content') && (lower.includes('policy') || lower.includes('reject'))) {
    return { code: 'content_rejected', message: '内容被上游拒绝，请调整提示词', retryable: false };
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return { code: 'timeout', message: '请求超时，可重试', retryable: true };
  }
  if (/\b5\d\d\b/.test(raw)) {
    return { code: 'upstream_5xx', message: '上游服务异常，可稍后重试', retryable: true };
  }
  if (lower.includes('network') || lower.includes('fetch failed') || lower.includes('econnrefused')) {
    return { code: 'network', message: '网络不可达，请检查连接', retryable: true };
  }
  return { code: 'unknown', message: raw || '未知错误', retryable: true };
}

/** 任务产出的主要资产类型。 */
export function expectedAssetKind(kind: TaskKind): AssetKind {
  return kind;
}
