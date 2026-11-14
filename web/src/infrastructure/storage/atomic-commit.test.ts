import 'fake-indexeddb/auto';
import { deleteDB, openDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';
import type { Task } from '../../domain/task/model';
import { planRecoveredTask } from '../../services/generation/taskLog';
import { commitRecoveryAtomically } from './atomic-commit';
import { createIndexedDBAssetRepository } from './indexeddb-snapshot-repositories';
import { createIndexedDBTaskRepository } from './indexeddb-task-repository';
import { sampleAssets, valueOf } from './snapshot-repositories.contract';
import { sampleTask } from './task-repository.contract';

const databases: string[] = [];
let sequence = 0;
function testName() { const name = `intx-atomic-commit-test-${++sequence}`; databases.push(name); return name; }
afterEach(async () => { for (const name of databases.splice(0)) await deleteDB(name); });

async function seeded() {
  const dbName = testName();
  const tasks = createIndexedDBTaskRepository({ dbName });
  const assets = createIndexedDBAssetRepository({ dbName });
  const task = valueOf(await tasks.create(sampleTask('task-a')));
  const asset = valueOf(await assets.save(sampleAssets(), 0));
  return { dbName, tasks, assets, task, asset };
}

const succeeded = (task: Task, ids: string[]): Task => ({ ...task, status: 'succeeded', phase: null, resultAssetIds: ids });

describe('任务与素材合并提交', () => {
  it('一个事务同时写入任务台账与素材快照', async () => {
    const { dbName, tasks, assets, task, asset } = await seeded();
    const target = { ...asset.value, assets: asset.value.assets.slice(0, 2) };
    // 走真实的恢复计划：它会剥掉存储层 revision，存储校验不接受多余字段。
    const planned = planRecoveredTask({ ...task.value, revision: task.revision }, ['recovered-1']);
    expect(planned.ok).toBe(true);
    const committed = await commitRecoveryAtomically({
      task: planned.ok ? planned.value : succeeded(task.value, []), taskRevision: task.revision,
      assets: target, assetsRevision: asset.revision,
    }, { dbName });
    expect(committed).toEqual({ ok: true, value: {
      task: { value: expect.objectContaining({ id: 'task-a', status: 'succeeded', resultAssetIds: ['recovered-1'] }), revision: task.revision + 1 },
      assets: { value: target, revision: asset.revision + 1 },
    } });
    expect(valueOf(await tasks.get('task-a'))).toEqual({ value: expect.objectContaining({ status: 'succeeded', resultAssetIds: ['recovered-1'] }), revision: task.revision + 1 });
    expect(valueOf(await assets.load())).toEqual({ value: target, revision: asset.revision + 1 });
  });

  it('素材 revision 过期时整体回滚，任务保持原样', async () => {
    const { dbName, tasks, asset, task } = await seeded();
    const before = valueOf(await tasks.get('task-a'));
    const committed = await commitRecoveryAtomically({
      task: succeeded(task.value, ['recovered-1']), taskRevision: task.revision,
      assets: sampleAssets('stale'), assetsRevision: asset.revision + 5,
    }, { dbName });
    expect(committed).toEqual({ ok: false, error: { code: 'conflict', message: expect.any(String), expectedRevision: asset.revision + 5, actualRevision: asset.revision } });
    expect(valueOf(await tasks.get('task-a'))).toEqual(before);
  });

  it('任务 revision 过期时整体回滚，素材保持原样', async () => {
    const { dbName, tasks, assets, task, asset } = await seeded();
    const before = valueOf(await assets.load());
    const committed = await commitRecoveryAtomically({
      task: succeeded(task.value, ['recovered-1']), taskRevision: task.revision + 3,
      assets: sampleAssets('edited'), assetsRevision: asset.revision,
    }, { dbName });
    expect(committed).toEqual({ ok: false, error: { code: 'conflict', message: expect.any(String), expectedRevision: task.revision + 3, actualRevision: task.revision } });
    expect(valueOf(await assets.load())).toEqual(before);
  });

  it('媒体文件与两份快照同事务写入；冲突时不留下孤立文件', async () => {
    const { dbName, task, asset } = await seeded();
    const blob = new Blob(['synthetic-media'], { type: 'video/mp4' });
    const committed = await commitRecoveryAtomically({
      task: succeeded(task.value, ['recovered-2']), taskRevision: task.revision,
      assets: asset.value, assetsRevision: asset.revision,
      media: [{ store: 'media_files', key: 'video:synthetic', blob }],
    }, { dbName });
    expect(committed.ok).toBe(true);
    const db = await openDB(dbName);
    expect(((await db.get('media_files', 'video:synthetic')) as Blob).size).toBe(blob.size);
    db.close();

    const conflicted = await commitRecoveryAtomically({
      task: succeeded(task.value, ['recovered-3']), taskRevision: task.revision,
      assets: asset.value, assetsRevision: 99,
      media: [{ store: 'media_files', key: 'video:orphan', blob }],
    }, { dbName });
    expect(conflicted.ok).toBe(false);
    const after = await openDB(dbName);
    expect(await after.get('media_files', 'video:orphan')).toBeUndefined();
    after.close();
  });

  it('存储损坏时拒绝覆盖，错误不当成空数据', async () => {
    const { dbName, task, asset } = await seeded();
    const db = await openDB(dbName);
    await db.put('app_state', JSON.stringify({ state: { assets: [{ id: 'bad' }] }, version: 0 }), 'infinite-canvas:asset_store');
    db.close();
    const committed = await commitRecoveryAtomically({
      task: succeeded(task.value, ['recovered-1']), taskRevision: task.revision,
      assets: asset.value, assetsRevision: asset.revision,
    }, { dbName });
    expect(committed).toEqual({ ok: false, error: { code: 'corrupt_data', message: expect.any(String) } });
  });
});
