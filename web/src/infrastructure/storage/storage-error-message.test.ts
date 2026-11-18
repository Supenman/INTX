import { describe, expect, it } from 'vitest';
import {
  assetSnapshotCodec, projectSnapshotCodec, snapshotCorruptData, snapshotInvalidData,
} from './snapshot-storage';
import { copyTask, corruptData, decodeTasks, invalidTaskData } from './task-storage';
import { sampleTask } from './task-repository.contract';

/**
 * 写入前校验失败和读取时发现数据损坏是两回事，但历史上一共用「数据损坏」文案。
 * 用户看到那句话会以为已保存的画布丢了，实际只是这次草稿里某个字段非法。
 * 错误码仍是稳定的 corrupt_data，这里钉住的是文案必须分家。
 */
describe('存储错误文案', () => {
  it('项目草稿非法：说清是这次写入被拒，且已保存数据未受影响', () => {
    const result = projectSnapshotCodec.copy({ projects: [3], deletedProjects: [] } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('corrupt_data');
    expect(result.error.message).toContain('本次要保存');
    expect(result.error.message).toContain('未受影响');
    expect(result.error.message).not.toContain('数据损坏');
  });

  it('素材草稿非法同样使用写入侧文案', () => {
    const result = assetSnapshotCodec.copy({ assets: [3] } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe(snapshotInvalidData().message);
  });

  it('读取到损坏数据仍报「数据损坏」，与写入侧文案不同', () => {
    const decoded = projectSnapshotCodec.decode('{人工损坏的 JSON');
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.error.message).toBe(snapshotCorruptData().message);
    expect(decoded.error.message).toContain('数据损坏');
    expect(decoded.error.message).not.toBe(snapshotInvalidData().message);
  });

  it('任务草稿非法与任务数据损坏也分开', () => {
    const copied = copyTask({ ...sampleTask(), attempt: '1' } as never);
    expect(copied.ok).toBe(false);
    if (copied.ok) return;
    expect(copied.error.message).toBe(invalidTaskData().message);
    expect(copied.error.message).not.toContain('数据损坏');

    const decoded = decodeTasks('{人工损坏的 JSON');
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.error.message).toBe(corruptData().message);
    expect(decoded.error.message).toContain('数据损坏');
  });
});
