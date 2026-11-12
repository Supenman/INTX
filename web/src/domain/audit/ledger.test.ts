import { describe, expect, it } from 'vitest';
import { createTask, type Task } from '../task/model';
import type { ProviderConfig } from '../provider/model';
import { auditToCsv, buildAuditEntries, filterAudit, summarizeAudit } from './ledger';

function makeTask(over: Partial<Task> & Pick<Task, 'id'>): Task {
  const base = createTask({
    kind: 'image',
    params: {
      kind: 'image',
      prompt: 'a cat',
      model: 'demo/image',
      providerId: 'demo',
      inputAssetIds: [],
    },
  });
  return { ...base, ...over, params: { ...base.params, ...(over.params ?? {}) } } as Task;
}

const configs: ProviderConfig[] = [
  {
    id: 'demo',
    name: '本地演示',
    adapter: 'mock',
    baseUrl: '',
    apiKey: '',
    scope: 'internal',
    models: [{ id: 'demo/image', label: '演示出图', capabilities: ['image'] }],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    adapter: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-xxx',
    scope: 'external',
    models: [{ id: 'gpt-image-1', label: 'gpt-image-1', capabilities: ['image'], pricing: { perImage: 0.04, currency: 'USD' } }],
  },
];

describe('buildAuditEntries', () => {
  it('把任务转成审计条目并标注出境', () => {
    const internal = makeTask({ id: 't1', params: { kind: 'image', prompt: 'a cat', model: 'demo/image', providerId: 'demo', inputAssetIds: [] } });
    const external = makeTask({
      id: 't2',
      params: { kind: 'image', prompt: 'a dog', model: 'gpt-image-1', providerId: 'openai', inputAssetIds: [] },
    });
    const entries = buildAuditEntries([internal, external], configs);
    const demo = entries.find((e) => e.taskId === 't1')!;
    const oai = entries.find((e) => e.taskId === 't2')!;
    expect(demo.dataEgress).toBe(false);
    expect(demo.providerScope).toBe('internal');
    expect(oai.dataEgress).toBe(true);
    expect(oai.providerName).toBe('OpenAI');
  });

  it('未配置 scope 的厂商按 external 处理（宁可多标）', () => {
    const t = makeTask({ id: 't3', params: { kind: 'image', prompt: 'x', model: 'm', providerId: 'unknown', inputAssetIds: [] } });
    const entry = buildAuditEntries([t], configs)[0]!;
    expect(entry.dataEgress).toBe(true);
    expect(entry.providerName).toBe('unknown');
  });

  it('截断过长提示词', () => {
    const long = '阿'.repeat(500);
    const t = makeTask({ id: 't4', params: { kind: 'image', prompt: long, model: 'demo/image', providerId: 'demo', inputAssetIds: [] } });
    const entry = buildAuditEntries([t], configs)[0]!;
    expect(entry.promptPreview.length).toBeLessThanOrEqual(201);
    expect(entry.promptPreview.endsWith('…')).toBe(true);
  });

  it('按创建时间倒序', () => {
    const a = makeTask({ id: 'a', createdAt: 100, params: { kind: 'image', prompt: 'a', model: 'demo/image', providerId: 'demo', inputAssetIds: [] } });
    const b = makeTask({ id: 'b', createdAt: 200, params: { kind: 'image', prompt: 'b', model: 'demo/image', providerId: 'demo', inputAssetIds: [] } });
    const entries = buildAuditEntries([a, b], configs);
    expect(entries[0]!.taskId).toBe('b');
  });
});

describe('filterAudit', () => {
  const tasks: Task[] = [
    makeTask({ id: 'e1', status: 'succeeded', params: { kind: 'image', prompt: 'x', model: 'gpt-image-1', providerId: 'openai', inputAssetIds: [] } }),
    makeTask({ id: 'e2', status: 'failed', params: { kind: 'image', prompt: 'y', model: 'demo/image', providerId: 'demo', inputAssetIds: [] } }),
  ];
  const entries = buildAuditEntries(tasks, configs);

  it('按状态过滤', () => {
    expect(filterAudit(entries, { status: 'failed' }).map((e) => e.taskId)).toEqual(['e2']);
  });
  it('按出境过滤', () => {
    expect(filterAudit(entries, { egress: true }).map((e) => e.taskId)).toEqual(['e1']);
  });
  it('按厂商过滤', () => {
    expect(filterAudit(entries, { providerId: 'demo' }).map((e) => e.taskId)).toEqual(['e2']);
  });
});

describe('summarizeAudit', () => {
  it('汇总次数、出境数与成本合计', () => {
    const tasks: Task[] = [
      makeTask({
        id: 's1', status: 'succeeded', resultAssetIds: ['a1'],
        cost: { amount: 0.04, currency: 'USD', basis: 'image × 1 @ gpt-image-1' },
        params: { kind: 'image', prompt: 'x', model: 'gpt-image-1', providerId: 'openai', inputAssetIds: [] },
      }),
      makeTask({
        id: 's2', status: 'succeeded', resultAssetIds: ['a2', 'a3'],
        cost: { amount: 0.08, currency: 'USD', basis: 'image × 2 @ gpt-image-1' },
        params: { kind: 'image', prompt: 'y', model: 'gpt-image-1', providerId: 'openai', inputAssetIds: [] },
      }),
      makeTask({ id: 'f1', status: 'failed', resultAssetIds: [], params: { kind: 'image', prompt: 'z', model: 'demo/image', providerId: 'demo', inputAssetIds: [] } }),
    ];
    const summary = summarizeAudit(buildAuditEntries(tasks, configs));
    expect(summary.total).toBe(3);
    expect(summary.succeeded).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.egressCount).toBe(2);
    expect(summary.resultCount).toBe(3);
    expect(summary.totalCost).toEqual({ amount: 0.12, currency: 'USD', basis: '汇总' });
  });

  it('无成本记录时 totalCost 为 null', () => {
    const tasks: Task[] = [makeTask({ id: 'n1', status: 'succeeded', params: { kind: 'image', prompt: 'x', model: 'demo/image', providerId: 'demo', inputAssetIds: [] } })];
    const summary = summarizeAudit(buildAuditEntries(tasks, configs));
    expect(summary.totalCost).toBeNull();
    expect(summary.costByCurrency).toEqual([]);
  });

  /**
   * 回归：不同币种绝不累加。
   *
   * 旧实现 addCost 遇到币种不同就「以先到者为准」直接返回，后一笔钱被静默吞掉——
   * 台账总额看着正常，实际少算了。这里钉住：USD 与 CNY 必须分开列。
   */
  it('多币种分开统计，不静默丢数也不相加', () => {
    const tasks: Task[] = [
      makeTask({
        id: 'usd1', status: 'succeeded',
        cost: { amount: 0.04, currency: 'USD', basis: 'image × 1' },
        params: { kind: 'image', prompt: 'x', model: 'gpt-image-1', providerId: 'openai', inputAssetIds: [] },
      }),
      makeTask({
        id: 'cny1', status: 'succeeded',
        cost: { amount: 0.5, currency: 'CNY', basis: 'image × 1' },
        params: { kind: 'image', prompt: 'y', model: 'seedream', providerId: 'volc', inputAssetIds: [] },
      }),
    ];
    const summary = summarizeAudit(buildAuditEntries(tasks, configs));
    const byCur = new Map(summary.costByCurrency.map((c) => [c.currency, c.amount]));
    expect(byCur.get('USD')).toBe(0.04);
    expect(byCur.get('CNY')).toBe(0.5);
    // 不能出现一个把两种钱加起来的假总额（0.54）
    expect(summary.costByCurrency).toHaveLength(2);
  });
});

describe('auditToCsv', () => {
  it('输出表头与数据行，并转义含逗号/引号的提示词', () => {
    const tasks: Task[] = [
      makeTask({ id: 'c1', status: 'succeeded', params: { kind: 'image', prompt: '他说"你好,世界"', model: 'gpt-image-1', providerId: 'openai', inputAssetIds: [] } }),
    ];
    const csv = auditToCsv(buildAuditEntries(tasks, configs));
    const lines = csv.split('\n');
    expect(lines[0]).toContain('taskId');
    expect(lines[1]).toContain('"他说""你好,世界"""');
  });
});
