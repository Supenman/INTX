import { describe, expect, it, vi } from 'vitest';

import { readTaskOutcome } from '@/domain/task/outcome';
import { createMemoryTaskLog } from './taskLog';
import {
  noteVideoPoll,
  resumableVideoTasks,
  submitVideoTask,
  videoHandleFromTask,
  type VideoConfigView,
  type VideoTaskHandle,
} from './videoTasks';

const config: VideoConfigView = {
  model: 'veo-3',
  apiFormat: 'gemini',
  size: '16:9',
  videoSeconds: '8',
};
const handle: VideoTaskHandle = { id: 'task-123', provider: 'gemini', model: 'veo-3' };

async function submitted(log = createMemoryTaskLog()) {
  return submitVideoTask({
    config,
    prompt: '海边日落',
    log,
    transport: { submit: async () => handle },
  });
}

describe('视频提交即落 upstreamRef，重启可恢复', () => {
  it('POST 一收单就写任务号，任务停在 running/generating', async () => {
    const log = createMemoryTaskLog();
    const { task, handle: got } = await submitted(log);
    expect(got).toEqual(handle);
    expect(task.status).toBe('running');
    expect(task.phase).toBe('generating');
    expect(task.upstreamRef).toBe('task-123');
    expect(task.params.providerId).toBe('gemini');
    expect(task.params.model).toBe('veo-3');
  });

  it('从台账能重建查单句柄，接着查那一单而不是重新提交', async () => {
    const log = createMemoryTaskLog();
    const { task } = await submitted(log);
    expect(videoHandleFromTask(task)).toEqual(handle);
    expect(await resumableVideoTasks(log)).toEqual([
      expect.objectContaining({
        handle,
        outcome: expect.objectContaining({ regenerate: 'blocked' }),
      }),
    ]);
  });

  it('台账里不写 config（apiKey / baseUrl）', async () => {
    const log = createMemoryTaskLog();
    const { task } = await submitVideoTask({
      config: { ...config, apiKey: 'ms-SECRET', baseUrl: 'https://host/v1?token=X' } as VideoConfigView & { apiKey: string; baseUrl: string },
      prompt: '海边日落',
      log,
      transport: { submit: async () => handle },
    });
    expect(JSON.stringify(task)).not.toContain('ms-SECRET');
    expect(JSON.stringify(task)).not.toContain('token=X');
  });
});

describe('查单结论落台账，中断不诱导重发', () => {
  it('pending 不改状态，任务仍可恢复', async () => {
    const log = createMemoryTaskLog();
    const { task } = await submitted(log);
    const after = await noteVideoPoll({ status: 'pending' }, task, log);
    expect(after.status).toBe('running');
    expect(after.upstreamRef).toBe('task-123');
    expect(await resumableVideoTasks(log)).toHaveLength(1);
  });

  it('查单 FAILED 保留 upstreamRef → confirm，不标 canceled', async () => {
    const log = createMemoryTaskLog();
    const { task } = await submitted(log);
    const after = await noteVideoPoll({ status: 'failed', error: 'HTTP 500' }, task, log);
    expect(after.status).toBe('failed');
    expect(after.upstreamRef).toBe('task-123');
    expect(readTaskOutcome(after)).toMatchObject({
      regenerate: 'confirm',
      reason: 'provider_result_pending',
    });
  });

  it('completed → succeeded', async () => {
    const log = createMemoryTaskLog();
    const { task } = await submitted(log);
    const after = await noteVideoPoll({ status: 'completed' }, task, log);
    expect(after.status).toBe('succeeded');
    expect(readTaskOutcome(after)).toMatchObject({ phase: 'ready', regenerate: 'allowed' });
  });

  it('提交前就取消 → canceled / allowed（请求没发出去，不吓唬「可能扣费」）', async () => {
    const controller = new AbortController();
    controller.abort();
    const log = createMemoryTaskLog();
    const submit = vi.fn(() => Promise.reject(new DOMException('Aborted', 'AbortError')));
    await expect(
      submitVideoTask({
        config,
        prompt: '海边日落',
        log,
        signal: controller.signal,
        transport: { submit },
      }),
    ).rejects.toThrow();
    expect(submit).not.toHaveBeenCalled();
    const task = (await log.list())[0]!;
    expect(task.status).toBe('canceled');
    expect(task.upstreamRef).toBeNull();
    expect(readTaskOutcome(task)).toMatchObject({ regenerate: 'allowed', reason: 'not_charged' });
  });

  it('提交过程中取消（还没拿到任务号）→ submission_uncertain / confirm，不退化成 allowed', async () => {
    const controller = new AbortController();
    const log = createMemoryTaskLog();
    await expect(
      submitVideoTask({
        config,
        prompt: '海边日落',
        log,
        signal: controller.signal,
        transport: {
          submit: () => {
            controller.abort();
            return Promise.reject(new DOMException('Aborted', 'AbortError'));
          },
        },
      }),
    ).rejects.toThrow();
    const task = (await log.list())[0]!;
    expect(task.status).toBe('failed');
    expect(task.error?.code).toBe('submission_uncertain');
    expect(readTaskOutcome(task)).toMatchObject({
      regenerate: 'confirm',
      reason: 'submission_unknown',
    });
  });

  it('提交失败：queued→running→failed 是合法迁移，本地网络错判 allowed', async () => {
    const log = createMemoryTaskLog();
    await expect(
      submitVideoTask({
        config,
        prompt: '海边日落',
        log,
        transport: { submit: () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:9')) },
      }),
    ).rejects.toThrow();
    const task = (await log.list())[0]!;
    expect(task.status).toBe('failed');
    expect(task.error?.code).toBe('network');
    expect(readTaskOutcome(task)?.regenerate).toBe('allowed');
    expect(task.upstreamRef).toBeNull();
  });
});
