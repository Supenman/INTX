import { beforeEach, describe, expect, it } from 'vitest';
import { createTask, transition, type Task } from '@/domain';
import { useTaskStore } from '@/app/stores/taskStore';
import { foldEvents, type TaskLog, type TaskLogEvent } from '@/infra/repository/taskLog';
import { INTERRUPTED_MESSAGE, restoreTasks, settleInterrupted, startTaskLog } from './taskRecovery';

function task(id: string, status: 'queued' | 'running' | 'succeeded' = 'queued'): Task {
  const t = createTask({
    id,
    kind: 'image',
    params: { kind: 'image', prompt: 'x', model: 'm', providerId: 'p', inputAssetIds: [] },
    nodeId: 'n1',
    now: 100,
  });
  let cur = t;
  if (status !== 'queued') {
    const r = transition(cur, 'running', { now: 110 });
    if (r.ok) cur = r.value;
  }
  if (status === 'succeeded') {
    const r = transition(cur, 'succeeded', { now: 200 });
    if (r.ok) cur = r.value;
  }
  return cur;
}

/** 内存版日志，避免测试依赖 IndexedDB 或文件系统。 */
function memoryLog(seed: TaskLogEvent[] = []): TaskLog & { events: TaskLogEvent[] } {
  const events = [...seed];
  return {
    events,
    async append(tasks) {
      for (const t of tasks) events.push({ at: Date.now() + events.length, task: t });
    },
    async readEvents() {
      return [...events];
    },
    async clear() {
      events.length = 0;
    },
  };
}

beforeEach(() => {
  useTaskStore.setState({ tasks: {} });
});

describe('日志折叠', () => {
  it('同一任务只保留最后一条状态', () => {
    const q = task('t1');
    const r = transition(q, 'running', { now: 110 });
    const s = r.ok ? transition(r.value, 'succeeded', { now: 200 }) : r;
    const events: TaskLogEvent[] = [
      { at: 1, task: q },
      { at: 2, task: r.ok ? r.value : q },
      ...(s.ok ? [{ at: 3, task: s.value }] : []),
    ];
    const folded = foldEvents(events);
    expect(folded).toHaveLength(1);
    expect(folded[0]?.status).toBe('succeeded');
  });

  it('乱序事件按时间取最后，而不是按数组顺序', () => {
    const q = task('t1');
    const r = transition(q, 'running', { now: 110 });
    const running = r.ok ? r.value : q;
    expect(foldEvents([{ at: 9, task: running }, { at: 2, task: q }])[0]?.status).toBe('running');
  });
});

describe('崩溃恢复', () => {
  it('残留的 running 任务被收敛为带原因的 canceled', () => {
    const running = task('t1', 'running');
    const settled = settleInterrupted(running, 500);
    expect(settled.status).toBe('canceled');
    expect(settled.error?.message).toBe(INTERRUPTED_MESSAGE);
    expect(settled.finishedAt).toBe(500);
  });

  it('残留的 queued 任务也一样收敛', () => {
    expect(settleInterrupted(task('t1', 'queued')).status).toBe('canceled');
  });

  it('已经成功的任务不动', () => {
    const done = task('t1', 'succeeded');
    expect(settleInterrupted(done)).toBe(done);
  });

  it('恢复后 store 里是终态，且把收敛结果写回日志（避免下次重复处理）', async () => {
    const log = memoryLog([{ at: 1, task: task('t1', 'running') }]);
    const report = await restoreTasks(log);

    expect(report).toEqual({ restored: 1, interrupted: 1 });
    expect(useTaskStore.getState().tasks.t1?.status).toBe('canceled');
    // 日志中原有一条 + 收敛后补写的一条
    expect(log.events).toHaveLength(2);
    expect(log.events.at(-1)?.task.status).toBe('canceled');

    // 再启动一次：不该又算作"中断"
    const second = await restoreTasks(log);
    expect(second.interrupted).toBe(0);
  });

  it('日志里的终态覆盖项目缓存里的旧状态', async () => {
    useTaskStore.setState({ tasks: { t1: task('t1', 'running') } });
    const log = memoryLog([{ at: 5, task: task('t1', 'succeeded') }]);
    await restoreTasks(log);
    expect(useTaskStore.getState().tasks.t1?.status).toBe('succeeded');
  });
});

describe('日志订阅', () => {
  it('任务变化会被追加，且防抖后只写一批', async () => {
    const log = memoryLog();
    const stop = startTaskLog(log, 10);
    useTaskStore.setState({ tasks: { t1: task('t1') } });
    await new Promise((r) => setTimeout(r, 60));
    expect(log.events).toHaveLength(1);
    stop();
  });

  it('停止订阅后不再写入', async () => {
    const log = memoryLog();
    const stop = startTaskLog(log, 5);
    stop();
    useTaskStore.setState({ tasks: { t1: task('t1') } });
    await new Promise((r) => setTimeout(r, 30));
    expect(log.events).toHaveLength(0);
  });
});
