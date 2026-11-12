import type { CostRecord, Task, TaskKind, TaskStatus } from '../task/model';
import type { ProviderConfig, ProviderScope } from '../provider/model';

/**
 * 审计台账。
 *
 * 任务日志（tasks.jsonl / IndexedDB）已经在每次状态变化时落盘整个 Task，
 * 这里不新增任何存储，只是把那些「每次生成一条」的记录变成可查询、可汇总、
 * 可导出审计的视图。数据源是现成的，缺的只是这层索引。
 *
 * 公司内部自用的审计诉求：谁、何时、用哪家厂商（是否出境）、出了什么、
 * 花了多少、成功还是失败——全部能从 Task 还原，不需要额外埋点。
 */

/** 提示词在台账里最多显示这么长，完整内容去任务详情或复现包看。 */
const PROMPT_PREVIEW_MAX = 200;

export interface AuditEntry {
  taskId: string;
  nodeId: string | null;
  kind: TaskKind;
  status: TaskStatus;
  providerId: string;
  providerName: string;
  /** 厂商数据归属；未配置按 external 处理（宁可多标）。 */
  providerScope: ProviderScope;
  model: string;
  /** 截断后的提示词预览 */
  promptPreview: string;
  createdAt: number;
  finishedAt: number | null;
  durationMs: number | null;
  resultCount: number;
  cost: CostRecord | null;
  /** providerScope === 'external' 即为出境 */
  dataEgress: boolean;
}

export interface AuditFilter {
  providerId?: string;
  status?: TaskStatus;
  kind?: TaskKind;
  /** 只看出境 / 只看内部 */
  egress?: boolean;
}

export interface AuditSummary {
  total: number;
  succeeded: number;
  failed: number;
  canceled: number;
  egressCount: number;
  resultCount: number;
  /** 主币种合计；没有任何成本记录时为 null。多币种时的完整明细见 costByCurrency。 */
  totalCost: CostRecord | null;
  /** 按币种拆分的合计。USD 与 CNY 不能相加，所以分开列。 */
  costByCurrency: CostRecord[];
}

function scopeOf(config: ProviderConfig | undefined): ProviderScope {
  return config?.scope === 'internal' ? 'internal' : 'external';
}

function preview(prompt: string): string {
  if (prompt.length <= PROMPT_PREVIEW_MAX) return prompt;
  return `${prompt.slice(0, PROMPT_PREVIEW_MAX)}…`;
}

/** 把任务列表（已 fold 成每个任务一条）转成审计条目，按时间倒序。 */
export function buildAuditEntries(
  tasks: readonly Task[],
  configs: readonly ProviderConfig[],
): AuditEntry[] {
  const byId = new Map(configs.map((c) => [c.id, c]));

  return tasks
    .map((t): AuditEntry => {
      const config = byId.get(t.params.providerId);
      const scope = scopeOf(config);
      const durationMs =
        t.finishedAt !== null ? t.finishedAt - (t.startedAt ?? t.createdAt) : null;
      return {
        taskId: t.id,
        nodeId: t.nodeId,
        kind: t.kind,
        status: t.status,
        providerId: t.params.providerId,
        providerName: config?.name ?? t.params.providerId,
        providerScope: scope,
        model: t.params.model,
        promptPreview: preview(t.params.prompt),
        createdAt: t.createdAt,
        finishedAt: t.finishedAt,
        durationMs,
        resultCount: t.resultAssetIds.length,
        cost: t.cost,
        dataEgress: scope === 'external',
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function filterAudit(entries: readonly AuditEntry[], filter: AuditFilter): AuditEntry[] {
  return entries.filter((e) => {
    if (filter.providerId !== undefined && e.providerId !== filter.providerId) return false;
    if (filter.status !== undefined && e.status !== filter.status) return false;
    if (filter.kind !== undefined && e.kind !== filter.kind) return false;
    if (filter.egress !== undefined && e.dataEgress !== filter.egress) return false;
    return true;
  });
}

export function summarizeAudit(entries: readonly AuditEntry[]): AuditSummary {
  let totalCost: CostRecord | null = null;
  let resultCount = 0;
  let egressCount = 0;
  let succeeded = 0;
  let failed = 0;
  let canceled = 0;
  // 按币种分桶：USD 和 CNY 不能相加，混在一起要么丢数、要么给出一个假总额。
  const buckets = new Map<string, number>();

  for (const e of entries) {
    if (e.status === 'succeeded') succeeded += 1;
    else if (e.status === 'failed') failed += 1;
    else if (e.status === 'canceled') canceled += 1;
    if (e.dataEgress) egressCount += 1;
    resultCount += e.resultCount;

    if (e.cost) {
      buckets.set(e.cost.currency, (buckets.get(e.cost.currency) ?? 0) + e.cost.amount);
    }
  }

  const costByCurrency: CostRecord[] = [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([currency, amount]) => ({
      amount: Math.round(amount * 1e6) / 1e6,
      currency,
      basis: '汇总',
    }));

  // 单一币种时 totalCost 就是它；多币种时取条目最多的那种做「主币种」展示，其余走 costByCurrency
  totalCost = costByCurrency.length > 0 ? costByCurrency[0]! : null;

  return {
    total: entries.length,
    succeeded,
    failed,
    canceled,
    egressCount,
    resultCount,
    totalCost,
    costByCurrency,
  };
}

/** 把审计条目导出成 CSV，供合规留痕或二次分析。 */
export function auditToCsv(entries: readonly AuditEntry[]): string {
  const header = [
    'taskId',
    'createdAt',
    'provider',
    'scope',
    'model',
    'kind',
    'status',
    'egress',
    'resultCount',
    'cost',
    'currency',
    'durationMs',
    'prompt',
  ];
  const esc = (v: string | number | null) => {
    const s = v === null ? '' : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
  const rows = entries.map((e) =>
    [
      e.taskId,
      new Date(e.createdAt).toISOString(),
      e.providerName,
      e.providerScope,
      e.model,
      e.kind,
      e.status,
      e.dataEgress ? 'yes' : 'no',
      e.resultCount,
      e.cost?.amount ?? '',
      e.cost?.currency ?? '',
      e.durationMs ?? '',
      e.promptPreview,
    ]
      .map(esc)
      .join(','),
  );
  return [header.map(esc).join(','), ...rows].join('\n');
}
