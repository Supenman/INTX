import { describe, expect, it } from 'vitest';

import type { GenerationParams, Task } from '@/domain/task/model';
import { readTaskOutcome } from '@/domain/task/outcome';
import { imageTaskParams } from './imageParams';
import { ProviderResultPendingError, pendingResultFrom } from './pendingResult';
import { createMemoryTaskLog, type TaskLog } from './taskLog';
import { GenerationTaskError, inspectRunWithTask } from './withTask';

const params: GenerationParams = {
  kind: 'image',
  prompt: '一只猫',
  model: 'mock/image',
  providerId: 'openai-compatible',
  inputAssetIds: [],
};

async function rejected(error: unknown): Promise<{ error: unknown; log: TaskLog }> {
  const log = createMemoryTaskLog();
  try {
    await inspectRunWithTask({ params, log, submit: () => Promise.reject(error) });
  } catch (caught) {
    return { error: caught, log };
  }
  throw new Error('本该抛错');
}

function onlyTask(log: TaskLog): Task {
  const tasks = log.list();
  expect(tasks).toHaveLength(1);
  return tasks[0];
}

describe('已收单但没拿到图：confirm 是硬底线', () => {
  it('只回 task_id → provider_result_pending + upstreamRef + confirm', async () => {
    const { error, log } = await rejected(
      pendingResultFrom({ task_id: '732e0ecf-3834-4193-9840-99b795bb2a0b' }),
    );
    const task = onlyTask(log);

    expect(error).toBeInstanceOf(GenerationTaskError);
    expect((error as GenerationTaskError).errorCode).toBe('provider_result_pending');
    expect(task.status).toBe('failed');
    expect(task.error?.code).toBe('provider_result_pending');
    expect(task.upstreamRef).toBe('732e0ecf-3834-4193-9840-99b795bb2a0b');
    expect(readTaskOutcome(task)).toEqual({
      phase: 'failed',
      regenerate: 'confirm',
      reason: 'provider_result_pending',
    });
    expect((error as Error).message).toContain('别直接重试');
  });

  it('2xx 空响应、连任务号都没有也还是 confirm，绝不退化成 allowed', async () => {
    const { log } = await rejected(pendingResultFrom({ data: [] }));
    const task = onlyTask(log);
    expect(task.upstreamRef).toBeNull();
    expect(readTaskOutcome(task)?.regenerate).toBe('confirm');
  });

  it('ProviderResultPendingError 被跨层转成普通 Error：码不退化、任务号不丢', async () => {
    const crossed = new Error(new ProviderResultPendingError({ taskId: 'tk-x' }).message);
    const { log } = await rejected(crossed);
    const task = onlyTask(log);
    // 曾经在这里被降级成 submission_uncertain（「可能没收到」），任务号也没了
    expect(task.error?.code).toBe('provider_result_pending');
    expect(task.upstreamRef).toBe('tk-x');
    expect(readTaskOutcome(task)).toMatchObject({
      regenerate: 'confirm',
      reason: 'provider_result_pending',
    });
  });
});

describe('其他失败按 normalizeError 三态收敛', () => {
  it('请求没离开本机（ECONNREFUSED）→ allowed', async () => {
    const { log } = await rejected(new Error('connect ECONNREFUSED 127.0.0.1:9'));
    const task = onlyTask(log);
    expect(task.status).toBe('failed');
    expect(task.error?.code).toBe('network');
    expect(readTaskOutcome(task)?.regenerate).toBe('allowed');
  });

  it('提交阶段超时 → submission_uncertain → confirm', async () => {
    const { log } = await rejected(new Error('Request timeout exceeded'));
    const task = onlyTask(log);
    expect(task.error?.code).toBe('submission_uncertain');
    expect(readTaskOutcome(task)?.regenerate).toBe('confirm');
  });

  it('401 → config_required → confirm（去配置，不是原样重试）', async () => {
    const { log } = await rejected(new Error('HTTP 401: Unauthorized'));
    expect(onlyTask(log).error?.code).toBe('auth_failed');
    expect(readTaskOutcome(onlyTask(log))).toMatchObject({ regenerate: 'confirm', reason: 'config_required' });
  });

  it('上游明确拒绝参数 → input_rejected → confirm（改参数后可重发）', async () => {
    const { log } = await rejected(new Error('invalid_params: 不支持参考图'));
    expect(onlyTask(log).error?.code).toBe('invalid_params');
    expect(readTaskOutcome(onlyTask(log))).toMatchObject({ regenerate: 'confirm', reason: 'input_rejected' });
  });

  it('451 安全审核 → content_rejected → confirm（改提示词，别原样再买一张）', async () => {
    const { log } = await rejected(new Error('HTTP 451: unsafe'));
    expect(onlyTask(log).error?.code).toBe('content_rejected');
    expect(readTaskOutcome(onlyTask(log))?.regenerate).toBe('confirm');
  });

  it('取消 → canceled / allowed，且不留 upstreamRef', async () => {
    const controller = new AbortController();
    controller.abort();
    const log = createMemoryTaskLog();
    await expect(
      inspectRunWithTask({
        params,
        log,
        signal: controller.signal,
        submit: () => Promise.reject(new DOMException('Aborted', 'AbortError')),
      }),
    ).rejects.toThrow();
    const task = onlyTask(log);
    expect(task.status).toBe('canceled');
    expect(task.upstreamRef).toBeNull();
    expect(readTaskOutcome(task)).toMatchObject({ regenerate: 'allowed', reason: 'not_charged' });
  });
});

describe('成功路径与参数快照', () => {
  it('成功落 resultAssetIds，outcome = result_ready / allowed', async () => {
    const log = createMemoryTaskLog();
    const result = await inspectRunWithTask({
      params,
      log,
      submit: async () => [{ id: 'img-1' }, { id: 'img-2' }],
      resultIds: (items) => items.map((item) => item.id),
    });
    expect(result.result).toHaveLength(2);
    expect(result.task.status).toBe('succeeded');
    expect(result.task.resultAssetIds).toEqual(['img-1', 'img-2']);
    expect(result.outcome).toMatchObject({ phase: 'ready', regenerate: 'allowed', reason: 'result_ready' });
  });

  it('参数快照只含可回溯字段，apiKey / baseUrl / dataUrl 一律不落盘', () => {
    const snapshot = imageTaskParams(
      {
        model: 'openmoss/MOSS-Image-SFT',
        apiFormat: 'openai-compatible',
        size: '1:1',
        count: '3',
        apiKey: 'ms-SHOULD-NOT-BE-PERSISTED',
        baseUrl: 'https://api-inference.modelscope.cn/v1?token=SECRET',
      } as Parameters<typeof imageTaskParams>[0] & { apiKey: string; baseUrl: string },
      '一只猫',
      [{ id: 'data:image/png;base64,AAAA', name: 'ref.png' }, { id: 'asset-2', name: 'ok.png' }],
      true,
    );
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('ms-SHOULD-NOT-BE-PERSISTED');
    expect(serialized).not.toContain('api-inference.modelscope.cn');
    expect(serialized).not.toContain('SECRET');
    expect(serialized).not.toContain('base64,AAAA');
    expect(snapshot.inputAssetIds).toEqual(['ref.png', 'asset-2']);
    expect(snapshot.count).toBe(3);
    expect(snapshot.extras).toEqual({ mode: 'edit' });
  });
});
