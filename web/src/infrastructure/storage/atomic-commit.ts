import type { AssetSnapshot } from '../../application/ports/snapshotRepositories';
import type { StorageError, Stored } from '../../application/ports/taskRepository';
import type { Task } from '../../domain/task/model';
import { err, ok, type Result } from '../../domain/shared/result';
import { intxDatabase } from './intx-database';
import { assetSnapshotCodec, encodeSnapshot, nextSnapshot } from './snapshot-storage';
import { changeTask, copyTask, decodeTasks } from './task-storage';

const STORE = 'app_state';
const TASK_KEY = 'infinite-canvas:intx_task_log';
const ASSET_KEY = 'infinite-canvas:asset_store';

/** 媒体文件与它归属的素材快照一起写，避免素材记录指向还没落盘的文件。 */
export interface AtomicMediaWrite { store: string; key: string; blob: Blob }

export interface AtomicRecoveryInput {
  task: Task;
  /** 台账里这个任务的当前 revision；事务内会重新核对。 */
  taskRevision: number;
  assets: AssetSnapshot;
  /** 素材快照的当前 revision；事务内会重新核对。 */
  assetsRevision: number;
  media?: readonly AtomicMediaWrite[];
}

export interface AtomicRecoveryCommitted {
  task: Stored<Task>;
  assets: Stored<AssetSnapshot>;
}

const unavailable = (): StorageError => ({ code: 'unavailable', message: 'IndexedDB 多仓库事务不可用，未启用备用存储' });
const rolledBack = (failure: 'read_failed' | 'write_failed'): StorageError => ({
  code: failure,
  message: failure === 'read_failed'
    ? '读取任务或素材存储失败，未将错误当作空数据'
    : '保存任务与素材失败，事务已回滚，两边都未确认保存',
});

/**
 * 任务核销与素材快照（以及可选媒体文件）在同一个事务里提交。
 * 任何一步校验或写入失败都整体回滚：不会出现「素材已保存、任务未核销」的半截状态。
 */
export async function commitRecoveryAtomically(
  input: AtomicRecoveryInput,
  options: { dbName?: string } = {},
): Promise<Result<AtomicRecoveryCommitted, StorageError>> {
  const task = copyTask(input.task);
  if (!task.ok) return task;
  const assets = assetSnapshotCodec.copy(input.assets);
  if (!assets.ok) return assets;
  const media = [...(input.media ?? [])];
  const stores = [STORE, ...new Set(media.map((item) => item.store))];

  let db;
  try { db = await intxDatabase(options.dbName ?? 'infinite-canvas', stores); }
  catch { return err(unavailable()); }

  let abortTx: (() => void) | undefined;
  let completed: Promise<boolean> | undefined;
  let failure: 'read_failed' | 'write_failed' = 'read_failed';
  try {
    const tx = db.transaction(stores, 'readwrite');
    abortTx = () => { try { tx.abort(); } catch { /* 事务可能已关闭。 */ } };
    completed = tx.done.then(() => true, () => false);
    const state = tx.objectStore(STORE);

    // 校验失败要显式回滚：事务里发过 put 之前虽然没写入，也不能等它自然提交。
    const reject = async <V>(result: Result<V, StorageError>) => { abortTx?.(); await completed; return result; };

    const decodedTasks = decodeTasks(await state.get(TASK_KEY));
    if (!decodedTasks.ok) return reject(decodedTasks);
    const nextTask = changeTask(decodedTasks.value, task.value, input.taskRevision);
    if (!nextTask.ok) return reject(nextTask);

    const decodedAssets = assetSnapshotCodec.decode(await state.get(ASSET_KEY));
    if (!decodedAssets.ok) return reject(decodedAssets);
    const nextAssets = nextSnapshot(assets.value, input.assetsRevision, decodedAssets.value.revision);
    if (!nextAssets.ok) return reject(nextAssets);

    failure = 'write_failed';
    for (const item of media) await tx.objectStore(item.store).put(item.blob, item.key);
    await state.put(JSON.stringify(decodedTasks.value), TASK_KEY);
    await state.put(encodeSnapshot(nextAssets.value), ASSET_KEY);

    if (!await completed) return err(rolledBack('write_failed'));
    return ok({ task: nextTask.value, assets: nextAssets.value });
  } catch {
    if (abortTx) {
      abortTx();
      await completed;
    }
    return err(rolledBack(failure));
  }
}
