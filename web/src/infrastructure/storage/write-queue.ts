import type { AssetRepository, AssetSnapshot, ProjectRepository, ProjectSnapshot } from '../../application/ports/snapshotRepositories';
import type { StorageError, Stored } from '../../application/ports/taskRepository';
import { err, ok, type Result } from '../../domain/shared/result';
import { assetSnapshotCodec, projectSnapshotCodec, snapshotCorruptData, validRevision, type SnapshotCodec } from './snapshot-storage';

type SaveResult<T> = Result<Stored<T>, StorageError>;
export interface SnapshotQueueState<T> {
  loadState: 'unloaded' | 'loading' | 'ready' | 'error';
  sequence: number;
  persistedSequence: number;
  revision: number | null;
  dirty: boolean;
  saving: boolean;
  error: StorageError | null;
  committedValue: T | null;
}
export interface SnapshotWriteQueue<T> {
  getState(): SnapshotQueueState<T>;
  subscribe(listener: (state: SnapshotQueueState<T>) => void): () => void;
  load(): Promise<SaveResult<T>>;
  enqueue(value: T): Result<number, StorageError>;
  flush(): Promise<SaveResult<T>>;
  retry(): Promise<SaveResult<T>>;
}
const notLoaded = (): StorageError => ({ code: 'unavailable', message: '集合尚未成功加载，已拒绝保存' });
const loadDirty = (): StorageError => ({ code: 'write_failed', message: '存在未保存草稿，已拒绝重新加载或自动处理冲突' });

/** One collection, one serial writer. No automatic retry/rebase. Captures detached edits at
 * enqueue time; flush targets its invocation sequence and bypasses the existing debounce.
 * load is cached after success, never writes, and cannot discard dirty drafts.
 * getState/subscriptions expose detached confirmed values; callers own draft/media hydration.
 */
function createQueue<T>(repository: { load(): Promise<SaveResult<T>>; save(value: T, revision: number): Promise<SaveResult<T>> }, codec: SnapshotCodec<T>, delay: number): SnapshotWriteQueue<T> {
  let state: SnapshotQueueState<T> = { loadState: 'unloaded', sequence: 0, persistedSequence: 0, revision: null, dirty: false, saving: false, error: null, committedValue: null };
  let draft: T | undefined;
  let invalid: StorageError | null = null;
  let blocked: StorageError | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let due = false;
  let writingSequence = 0;
  let activeLoad: Promise<SaveResult<T>> | undefined;
  const listeners = new Set<(state: SnapshotQueueState<T>) => void>();
  const waiters: { sequence: number; resolve(result: SaveResult<T>): void }[] = [];
  const snapshot = () => structuredClone(state);
  const confirmed = (): SaveResult<T> => ok({ value: structuredClone(state.committedValue as T), revision: state.revision as number });
  function update(patch: Partial<SnapshotQueueState<T>>) {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(snapshot());
  }
  function cancelDelay() { if (timer !== undefined) clearTimeout(timer); timer = undefined; }
  function settle(failure?: StorageError, onlyUncovered = false) {
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (failure && (!onlyUncovered || !state.saving || waiters[i].sequence > writingSequence) || waiters[i].sequence <= state.persistedSequence) {
        waiters.splice(i, 1)[0].resolve(failure ? err(failure) : confirmed());
      }
    }
  }
  function schedule() {
    cancelDelay();
    if (state.loadState !== 'ready' || !state.dirty || invalid || blocked) return;
    due = waiters.some((w) => w.sequence > writingSequence) || delay === 0;
    if (due) { void drain(); return; }
    timer = setTimeout(() => { timer = undefined; due = true; void drain(); }, delay);
  }
  async function drain() {
    if (state.saving || state.loadState !== 'ready' || !state.dirty || invalid || blocked || draft === undefined) return;
    due = false;
    const sequence = state.sequence;
    writingSequence = sequence;
    const value = structuredClone(draft);
    const revision = state.revision as number;
    update({ saving: true });
    let result: SaveResult<T>;
    try { result = await repository.save(value, revision); }
    catch { result = err({ code: 'write_failed', message: '保存快照失败，草稿仍保留' }); }
    if (!result.ok) {
      blocked = result.error;
      cancelDelay();
      update({ saving: false, error: invalid ?? blocked, dirty: true });
      settle(result.error);
      return;
    }
    update({ saving: false, revision: result.value.revision, committedValue: structuredClone(result.value.value), persistedSequence: sequence,
      dirty: state.sequence > sequence, error: invalid });
    settle();
    if (invalid) { settle(invalid); return; }
    if (state.dirty) {
      if (due || waiters.length) { cancelDelay(); void drain(); }
      else if (timer === undefined) schedule();
    }
  }
  function flush(): Promise<SaveResult<T>> {
    cancelDelay();
    due = true;
    const failure = state.loadState !== 'ready' ? state.error ?? notLoaded() : invalid ?? blocked;
    if (failure) return Promise.resolve(err(failure));
    if (!state.dirty) return Promise.resolve(confirmed());
    const pending = new Promise<SaveResult<T>>((resolve) => { waiters.push({ sequence: state.sequence, resolve }); });
    void drain();
    return pending;
  }
  return {
    getState: snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    load() {
      if (state.dirty) return Promise.resolve(err(loadDirty()));
      if (activeLoad) return activeLoad;
      if (state.loadState === 'ready') return Promise.resolve(confirmed());
      update({ loadState: 'loading', error: null });
      activeLoad = (async () => {
        let result: SaveResult<T>;
        try { result = await repository.load(); }
        catch { result = err({ code: 'read_failed', message: '读取快照失败，未将错误当作空集合' }); }
        if (result.ok) {
          const copied = codec.copy(result.value.value);
          if (!validRevision(result.value.revision)) result = err(snapshotCorruptData());
          else if (!copied.ok) result = copied;
          else {
            // An edit during load must not be overwritten by the completed read.
            if (state.dirty) result = err(loadDirty());
            else {
              draft = copied.value;
              update({ loadState: 'ready', revision: result.value.revision, committedValue: structuredClone(copied.value), error: null });
              return confirmed();
            }
          }
        }
        update({ loadState: 'error', error: result.error });
        return result;
      })().finally(() => { activeLoad = undefined; });
      return activeLoad;
    },
    enqueue(value) {
      const sequence = state.sequence + 1;
      const copied = codec.copy(value);
      invalid = copied.ok ? null : copied.error;
      draft = copied.ok ? copied.value : undefined;
      const failure = state.loadState !== 'ready' ? notLoaded() : invalid;
      update({ sequence, dirty: true, error: invalid ?? blocked ?? failure });
      if (invalid) { cancelDelay(); settle(invalid, true); }
      else schedule();
      return failure ? err(failure) : ok(sequence);
    },
    flush,
    retry() {
      if (state.loadState !== 'ready' || invalid) return flush();
      blocked = null; // Retain revision exactly; no read, no blind conflict rebase.
      update({ error: null });
      return flush();
    },
  };
}
export function createProjectWriteQueue(repository: ProjectRepository): SnapshotWriteQueue<ProjectSnapshot> { return createQueue(repository, projectSnapshotCodec, 400); }
export function createAssetWriteQueue(repository: AssetRepository): SnapshotWriteQueue<AssetSnapshot> { return createQueue(repository, assetSnapshotCodec, 0); }
