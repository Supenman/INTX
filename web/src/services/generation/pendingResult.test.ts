import { describe, expect, it } from 'vitest';

import { normalizeError } from '@/domain/task/model';
import {
  ProviderResultPendingError,
  classifyImagePayload,
  describePayload,
  pendingResultFrom,
  readTaskIdFromMessage,
  readUpstreamTaskId,
} from './pendingResult';

describe('HTTP 2xx 但没拿到图的分类', () => {
  it('有 data 数组就是正常出图', () => {
    expect(classifyImagePayload({ data: [{ b64_json: 'AAAA' }] })).toBe('ready');
  });

  it('只回 task_id 判已收单，并抽出任务号', () => {
    const payload = { task_id: '732e0ecf-3834-4193-9840-99b795bb2a0b' };
    expect(classifyImagePayload(payload)).toBe('pending');
    expect(readUpstreamTaskId(payload)).toBe('732e0ecf-3834-4193-9840-99b795bb2a0b');
  });

  it('data 为空数组也判已收单，不能当空结果允许重发', () => {
    expect(classifyImagePayload({ data: [] })).toBe('pending');
    expect(classifyImagePayload({})).toBe('pending');
  });

  it('上游明确拒绝（业务码 / error）走错误分类，不算已收单', () => {
    expect(classifyImagePayload({ code: 1, msg: '参数错' })).toBe('rejected');
    expect(classifyImagePayload({ error: { message: 'unsafe' } })).toBe('rejected');
  });

  it('嵌套任务号 / 异步状态里的操作名也能抽出来', () => {
    expect(readUpstreamTaskId({ output: { task_id: 'tk-1' } })).toBe('tk-1');
    expect(readUpstreamTaskId({ task: { name: 'operations/abc', done: false } })).toBe('operations/abc');
  });

  it('普通响应 id 不被误当任务号', () => {
    expect(readUpstreamTaskId({ id: 'resp-1' })).toBeNull();
  });
});

describe('已收单错误的留证与兜底识别', () => {
  it('message 带任务号、明确劝阻直接重试', () => {
    const error = pendingResultFrom({ task_id: 'tk-99' });
    expect(error).toBeInstanceOf(ProviderResultPendingError);
    expect(error.taskId).toBe('tk-99');
    expect(error.message).toContain('tk-99');
    expect(error.message).toContain('别直接重试');
    expect(error.message.startsWith('上游已经收单')).toBe(true);
  });

  it('没有任务号时仍靠 code 保住 confirm 语义', () => {
    const error = pendingResultFrom({ data: [] });
    expect(error.taskId).toBeNull();
    expect(normalizeError(error).code).toBe('provider_result_pending');
  });

  it('跨层被转成普通 Error 后，normalizeError 仍识别「上游已经收单」', () => {
    const crossed = new Error(pendingResultFrom({ task_id: 'tk-1' }).message);
    expect(normalizeError(crossed).code).toBe('provider_result_pending');
    // 提交阶段也不能被降级成 submission_uncertain
    expect(normalizeError(crossed, 'submitting').code).toBe('provider_result_pending');
  });

  it('从只剩文案的错误里把任务号捞回来，捞不到不猜', () => {
    const message = pendingResultFrom({ task_id: '732e0ecf-3834' }).message;
    expect(readTaskIdFromMessage(message)).toBe('732e0ecf-3834');
    expect(readTaskIdFromMessage('上游超时了')).toBeNull();
  });

  it('留证不写 base64 / 完整长字符串 / 完整 URL', () => {
    const described = describePayload({
      data: [{ b64_json: 'A'.repeat(5000) }],
      url: 'https://secret-host.example.com/very/long/path?token=abc',
      task_status: 'SUCCEED',
    });
    expect(described).not.toContain('AAAA');
    expect(described).not.toContain('secret-host');
    expect(described).not.toContain('token=abc');
    expect(described).toContain('data:[1]');
    expect(described).toContain('task_status:SUCCEED');
  });
});
