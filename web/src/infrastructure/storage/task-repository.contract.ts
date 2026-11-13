import { beforeEach, describe, expect, it } from 'vitest';
import type { StorageError, TaskRepository } from '../../application/ports/taskRepository';
import type { Result } from '../../domain/shared/result';
import { createTask, type Task } from '../../domain/task/model';

/** 人工、无凭证、无请求的完整 Task 样本。 */
export function sampleTask(id = 'task-a'): Task {
  return {
    ...createTask({ id, now: 1000, nodeId: 'node-a', kind: 'image', params: {
      kind: 'image', prompt: '人工测试风景', model: 'test/image', providerId: 'test',
      inputAssetIds: ['input-a', 'input-b'], aspectRatio: '16:9', resolution: '1024x576',
      count: 2, durationSec: 5, extras: { seed: 42, label: '样本', enabled: true },
    } }),
    status: 'running', phase: 'generating', upstreamProgress: 0.25,
    upstreamRef: 'test-upstream-a', resultAssetIds: ['result-a', 'result-b'], attempt: 2,
    startedAt: 1001, finishedAt: null, cost: { amount: 0.5, currency: 'CNY', basis: '人工估算' },
    error: { code: 'provider_result_pending', message: '人工无请求样本' },
  };
}

export function valueOf<T>(result: Result<T, StorageError>): T {
  if (!result.ok) throw new Error(`测试预期成功，实际 ${result.error.code}`);
  return result.value;
}

export function taskRepositoryContract(label: string, make: () => TaskRepository) {
  describe(`${label} 共享任务合同`, () => {
    let repo: TaskRepository;
    beforeEach(() => { repo = make(); });

    it('不存在是合法空，get 返回 null', async () => {
      expect(await repo.list()).toEqual({ ok: true, value: [] });
      expect(await repo.get('missing')).toEqual({ ok: true, value: null });
    });

    it('create 接收完整 Task，revision 从 1 开始，get/list 数据等价', async () => {
      const task = sampleTask();
      const expected = { value: task, revision: 1 };
      expect(valueOf(await repo.create(task))).toEqual(expected);
      expect(valueOf(await repo.get(task.id))).toEqual(expected);
      expect(valueOf(await repo.list())).toEqual([expected]);
      expect(Object.hasOwn(valueOf(await repo.list())[0].value, 'revision')).toBe(false);
    });

    it('重复 create 返回 already_exists，不能改原值', async () => {
      const task = sampleTask();
      await repo.create(task);
      expect(await repo.create({ ...task, upstreamRef: '不能覆盖' })).toEqual({ ok: false, error: {
        code: 'already_exists', id: task.id, message: expect.any(String),
      } });
      expect(valueOf(await repo.get(task.id))).toEqual({ value: task, revision: 1 });
    });

    it('replace 保留位置，只替换目标且递增 revision', async () => {
      const a = sampleTask('a');
      const b = sampleTask('b');
      await repo.create(a);
      await repo.create(b);
      const next = { ...a, status: 'succeeded' as const, phase: null, error: null, finishedAt: 2000 };
      expect(valueOf(await repo.replace(next, 1))).toEqual({ value: next, revision: 2 });
      expect(valueOf(await repo.list())).toEqual([{ value: b, revision: 1 }, { value: next, revision: 2 }]);
    });

    it('replace 缺失返回 not_found，不偷偷创建', async () => {
      const task = sampleTask();
      expect(await repo.replace(task, 0)).toEqual({ ok: false, error: {
        code: 'not_found', id: task.id, message: expect.any(String),
      } });
      expect(valueOf(await repo.list())).toEqual([]);
    });

    it('旧 revision 返回显式 conflict，不覆盖、不自动重试', async () => {
      const task = sampleTask();
      await repo.create(task);
      const next = { ...task, upstreamRef: 'new-ref' };
      await repo.replace(next, 1);
      expect(await repo.replace(task, 1)).toEqual({ ok: false, error: {
        code: 'conflict', expectedRevision: 1, actualRevision: 2, message: expect.any(String),
      } });
      expect(valueOf(await repo.get(task.id))).toEqual({ value: next, revision: 2 });
    });

    it('两个同任务旧快照至多一个成功，另一份 conflict', async () => {
      const task = sampleTask();
      await repo.create(task);
      const results = await Promise.all([
        repo.replace({ ...task, upstreamRef: 'first' }, 1),
        repo.replace({ ...task, upstreamRef: 'second' }, 1),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: {
        code: 'conflict', expectedRevision: 1, actualRevision: 2, message: expect.any(String),
      } }]);
      expect(valueOf(await repo.get(task.id))).toEqual(valueOf(results.find((r) => r.ok)!));
    });

    it('不同任务并发更新不丢数据', async () => {
      const a = sampleTask('a'); const b = sampleTask('b');
      await Promise.all([repo.create(a), repo.create(b)]);
      const nextA = { ...a, upstreamRef: 'a-new' }; const nextB = { ...b, upstreamRef: 'b-new' };
      expect((await Promise.all([repo.replace(nextA, 1), repo.replace(nextB, 1)])).every((r) => r.ok)).toBe(true);
      expect(valueOf(await repo.get('a'))).toEqual({ value: nextA, revision: 2 });
      expect(valueOf(await repo.get('b'))).toEqual({ value: nextB, revision: 2 });
    });

    it('create 与 replace 在 await 前复制入参，不受外部修改影响', async () => {
      const task = sampleTask(); const original = structuredClone(task);
      const pending = repo.create(task);
      task.resultAssetIds.push('外部改动'); task.params.prompt = '外部改动';
      expect(valueOf(await pending)).toEqual({ value: original, revision: 1 });
      const next = structuredClone(original); next.upstreamRef = 'replace';
      const expected = structuredClone(next); const replacing = repo.replace(next, 1);
      next.params.prompt = '外部改动'; next.resultAssetIds.length = 0;
      expect(valueOf(await replacing)).toEqual({ value: expected, revision: 2 });
      expect(valueOf(await repo.get(task.id))).toEqual({ value: expected, revision: 2 });
    });

    it('create/get/list/replace 返回值不暴露内部引用', async () => {
      const task = sampleTask();
      const created = valueOf(await repo.create(task)); created.value.params.prompt = 'create 修改';
      const read = valueOf(await repo.get(task.id))!; read.value.resultAssetIds.length = 0;
      const list = valueOf(await repo.list()); list[0].revision = 999; list[0].value.params.prompt = 'list 修改'; list.length = 0;
      expect(valueOf(await repo.get(task.id))).toEqual({ value: task, revision: 1 });
      const replaced = valueOf(await repo.replace(task, 1)); replaced.value.cost!.basis = 'replace 修改';
      expect(valueOf(await repo.get(task.id))).toEqual({ value: task, revision: 2 });
    });

    it.each([-1, 1.5, NaN, Infinity])('拒绝非法 expectedRevision %s，不变更原值', async (r) => {
      const task = sampleTask(); await repo.create(task);
      expect(await repo.replace(task, r)).toEqual({ ok: false, error: { code: 'corrupt_data', message: expect.any(String) } });
      expect(valueOf(await repo.get(task.id))).toEqual({ value: task, revision: 1 });
    });

    it('非法 Task 不写入、不丢已有数据', async () => {
      const task = sampleTask(); await repo.create(task);
      const bad = { ...task, upstreamProgress: 2 };
      expect(await repo.create(bad)).toEqual({ ok: false, error: { code: 'corrupt_data', message: expect.any(String) } });
      expect(await repo.replace(bad, 1)).toEqual({ ok: false, error: { code: 'corrupt_data', message: expect.any(String) } });
      expect(valueOf(await repo.get(task.id))).toEqual({ value: task, revision: 1 });
    });

    it('拒绝序列化后会损坏的稀疏引用数组', async () => {
      const task = sampleTask();
      task.resultAssetIds = Array(1) as string[];
      expect(await repo.create(task)).toEqual({ ok: false, error: { code: 'corrupt_data', message: expect.any(String) } });
      expect(valueOf(await repo.list())).toEqual([]);
    });

    it('字典特殊 id 不污染原型，照常递增', async () => {
      for (const id of ['__proto__', 'constructor', 'toString']) {
        const task = sampleTask(id);
        expect(valueOf(await repo.create(task)).revision).toBe(1);
        expect(valueOf(await repo.replace(task, 1)).revision).toBe(2);
        expect(valueOf(await repo.get(id))).toEqual({ value: task, revision: 2 });
      }
    });
  });
}
