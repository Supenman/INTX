import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectRepository, ProjectSnapshot } from '../../application/ports/snapshotRepositories';
import type { StorageError, Stored } from '../../application/ports/taskRepository';
import { err, ok, type Result } from '../../domain/shared/result';
import { createMemoryAssetRepository, createMemoryProjectRepository } from './memory-snapshot-repositories';
import { sampleAssets, sampleProjects, valueOf } from './snapshot-repositories.contract';
import { createAssetWriteQueue, createProjectWriteQueue } from './write-queue';

type SaveResult = Result<Stored<ProjectSnapshot>, StorageError>;
const failed: StorageError = { code: 'write_failed', message: 'synthetic failure' };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
function controlled() {
  const writes: { value: ProjectSnapshot; revision: number; done: ReturnType<typeof deferred<SaveResult>> }[] = [];
  const load = vi.fn(async (): Promise<SaveResult> => ok({ value: sampleProjects('loaded'), revision: 4 }));
  const save = vi.fn((value: ProjectSnapshot, revision: number) => {
    const done = deferred<SaveResult>(); writes.push({ value, revision, done }); return done.promise;
  });
  return { repository: { load, save } satisfies ProjectRepository, writes };
}
async function tick() { await Promise.resolve(); await Promise.resolve(); }
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('snapshot serial queue', () => {
  it('no writes until successful load; cached load never reads/rebases; dirty load refused', async () => {
    const c = controlled(); const q = createProjectWriteQueue(c.repository);
    expect(q.getState()).toMatchObject({ loadState: 'unloaded', revision: null, dirty: false, saving: false });
    expect((await q.flush()).ok).toBe(false); expect(c.repository.save).not.toHaveBeenCalled();
    expect(valueOf(await q.load()).revision).toBe(4); expect(valueOf(await q.load()).revision).toBe(4);
    expect(c.repository.load).toHaveBeenCalledTimes(1); expect(c.repository.save).not.toHaveBeenCalled();
    q.enqueue(sampleProjects('draft'));
    expect(await q.load()).toEqual({ ok: false, error: { code: 'write_failed', message: expect.any(String) } });
    expect(c.repository.load).toHaveBeenCalledTimes(1); expect(q.getState().dirty).toBe(true);
    const pending = q.flush(); c.writes[0].done.resolve(ok({ value: c.writes[0].value, revision: 5 })); await pending;
  });
  it('failed load retry is explicit, coalesced loads and no empty writes', async () => {
    const read = deferred<SaveResult>(); const c = controlled(); c.repository.load.mockImplementationOnce(() => read.promise);
    const q = createProjectWriteQueue(c.repository); const first = q.load(); const second = q.load();
    expect(second).toBe(first); expect(q.getState().loadState).toBe('loading');
    read.resolve(err({ code: 'read_failed', message: 'synthetic' })); expect((await first).ok).toBe(false);
    expect(q.getState()).toMatchObject({ loadState: 'error', revision: null });
    expect((await q.flush()).ok).toBe(false); expect((await q.retry()).ok).toBe(false); expect(c.repository.save).not.toHaveBeenCalled();
    expect(valueOf(await q.load()).revision).toBe(4); expect(q.getState().loadState).toBe('ready');
  });
  it('load completion never overwrites edit made during loading', async () => {
    const read = deferred<SaveResult>(); const c = controlled(); c.repository.load.mockImplementationOnce(() => read.promise);
    const q = createProjectWriteQueue(c.repository); const loading = q.load();
    expect(q.enqueue(sampleProjects('early')).ok).toBe(false);
    read.resolve(ok({ value: sampleProjects('disk'), revision: 7 })); expect((await loading).ok).toBe(false);
    expect(q.getState()).toMatchObject({ loadState: 'error', dirty: true, sequence: 1, persistedSequence: 0, revision: null });
    expect((await q.load()).ok).toBe(false); expect(c.repository.save).not.toHaveBeenCalled();
  });
  it('400ms project debounce captures latest snapshot and flush starts immediately', async () => {
    vi.useFakeTimers(); const c = controlled(); const q = createProjectWriteQueue(c.repository); await q.load();
    const first = sampleProjects('first'); q.enqueue(first); first.projects[0].title = 'mutation must not leak';
    await vi.advanceTimersByTimeAsync(399); expect(c.writes).toHaveLength(0);
    const second = sampleProjects('second'); q.enqueue(second); second.projects[0].title = 'another mutation';
    await vi.advanceTimersByTimeAsync(399); expect(c.writes).toHaveLength(0);
    const pending = q.flush(); expect(c.writes).toHaveLength(1); expect(c.writes[0].value).toEqual(sampleProjects('second'));
    expect(q.getState()).toMatchObject({ sequence: 2, persistedSequence: 0, revision: 4, dirty: true, saving: true });
    c.writes[0].done.resolve(ok({ value: c.writes[0].value, revision: 5 }));
    expect(valueOf(await pending)).toEqual({ value: sampleProjects('second'), revision: 5 });
    expect(q.getState()).toMatchObject({ persistedSequence: 2, dirty: false, saving: false, revision: 5 });
    await vi.advanceTimersByTimeAsync(500); expect(c.writes).toHaveLength(1);
  });
  it('400ms expires once; no added asset delay', async () => {
    vi.useFakeTimers(); const projects = createMemoryProjectRepository(); const save = vi.spyOn(projects, 'save');
    const q = createProjectWriteQueue(projects); await q.load(); q.enqueue(sampleProjects());
    await vi.advanceTimersByTimeAsync(399); expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(save).toHaveBeenCalledTimes(1); expect(q.getState().dirty).toBe(false);
    const assets = createMemoryAssetRepository(); const assetSave = vi.spyOn(assets, 'save'); const a = createAssetWriteQueue(assets); await a.load();
    a.enqueue(sampleAssets()); expect(assetSave).toHaveBeenCalledTimes(1); await a.flush(); expect(a.getState().dirty).toBe(false);
  });
  it('serial saves: old completion keeps newer edit dirty; separate flush barriers each await invocation sequence', async () => {
    vi.useFakeTimers(); const c = controlled(); const q = createProjectWriteQueue(c.repository); await q.load();
    q.enqueue(sampleProjects('first')); const first = q.flush();
    q.enqueue(sampleProjects('second')); let secondComplete = false;
    const second = q.flush().then((result) => { secondComplete = true; return result; });
    expect(c.writes).toHaveLength(1);
    c.writes[0].done.resolve(ok({ value: c.writes[0].value, revision: 5 }));
    expect(valueOf(await first).value).toEqual(sampleProjects('first')); expect(secondComplete).toBe(false);
    expect(q.getState()).toMatchObject({ persistedSequence: 1, sequence: 2, revision: 5, dirty: true, saving: true });
    expect(c.writes).toHaveLength(2); expect(c.writes[1].revision).toBe(5);
    c.writes[1].done.resolve(ok({ value: c.writes[1].value, revision: 6 }));
    expect(valueOf(await second).value).toEqual(sampleProjects('second')); expect(q.getState().dirty).toBe(false);
  });
  it('an expired debounce during in-flight write drains promptly after completion, not another 400ms later', async () => {
    vi.useFakeTimers(); const c = controlled(); const q = createProjectWriteQueue(c.repository); await q.load();
    q.enqueue(sampleProjects('first')); const first = q.flush(); q.enqueue(sampleProjects('second'));
    await vi.advanceTimersByTimeAsync(400); expect(c.writes).toHaveLength(1);
    c.writes[0].done.resolve(ok({ value: c.writes[0].value, revision: 5 })); await first; await tick();
    expect(c.writes).toHaveLength(2);
    c.writes[1].done.resolve(ok({ value: c.writes[1].value, revision: 6 })); await q.flush();
  });
  it('later project edit not covered by original flush retains its own 400ms debounce', async () => {
    vi.useFakeTimers(); const c = controlled(); const q = createProjectWriteQueue(c.repository); await q.load();
    q.enqueue(sampleProjects('first')); const first = q.flush(); q.enqueue(sampleProjects('second'));
    await vi.advanceTimersByTimeAsync(100); c.writes[0].done.resolve(ok({ value: c.writes[0].value, revision: 5 })); await first;
    expect(c.writes).toHaveLength(1); expect(q.getState().dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(299); expect(c.writes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1); expect(c.writes).toHaveLength(2);
    c.writes[1].done.resolve(ok({ value: c.writes[1].value, revision: 6 })); await q.flush();
  });
  it('failed write keeps draft/revision; no automatic retry on edits/flush; explicit retry same expected revision', async () => {
    vi.useFakeTimers(); const c = controlled(); const q = createProjectWriteQueue(c.repository); await q.load();
    q.enqueue(sampleProjects('first')); const pending = q.flush(); c.writes[0].done.resolve(err(failed)); expect(await pending).toEqual(err(failed));
    expect(q.getState()).toMatchObject({ revision: 4, persistedSequence: 0, sequence: 1, dirty: true, saving: false, error: failed });
    q.enqueue(sampleProjects('latest')); await vi.advanceTimersByTimeAsync(1000); expect(c.writes).toHaveLength(1);
    expect(await q.flush()).toEqual(err(failed)); const retry = q.retry(); expect(c.writes).toHaveLength(2);
    expect(c.writes[1]).toMatchObject({ value: sampleProjects('latest'), revision: 4 });
    c.writes[1].done.resolve(ok({ value: c.writes[1].value, revision: 5 })); await retry;
    expect(q.getState()).toMatchObject({ dirty: false, error: null, revision: 5, persistedSequence: 2 });
  });
  it('conflict never reads/rebases and repeated explicit retry uses original revision', async () => {
    const repo = createMemoryProjectRepository(); const q = createProjectWriteQueue(repo); await q.load();
    await repo.save(sampleProjects('external'), 0); const read = vi.spyOn(repo, 'load'); const save = vi.spyOn(repo, 'save');
    q.enqueue(sampleProjects('local')); const result = await q.flush(); expect(result).toEqual({ ok: false, error: { code: 'conflict', expectedRevision: 0, actualRevision: 1, message: expect.any(String) } });
    expect(await q.retry()).toEqual(result); expect(await q.load()).toEqual({ ok: false, error: { code: 'write_failed', message: expect.any(String) } });
    expect(read).not.toHaveBeenCalled(); expect(save.mock.calls.map((args) => args[1])).toEqual([0, 0]); expect(q.getState().dirty).toBe(true);
  });
  it('invalid latest edit stays dirty and flush/retry never falsely report old committed snapshot', async () => {
    const q = createProjectWriteQueue(createMemoryProjectRepository()); await q.load();
    const invalid = sampleProjects(); invalid.projects[0].title = undefined as never;
    expect(q.enqueue(invalid)).toEqual({ ok: false, error: { code: 'corrupt_data', message: expect.any(String) } });
    expect(q.getState()).toMatchObject({ dirty: true, sequence: 1, persistedSequence: 0, error: { code: 'corrupt_data' } });
    expect((await q.flush()).ok).toBe(false); expect((await q.retry()).ok).toBe(false);
    q.enqueue(sampleProjects('fixed')); expect(valueOf(await q.flush()).value).toEqual(sampleProjects('fixed'));
    expect(q.getState()).toMatchObject({ dirty: false, persistedSequence: 2 });
  });
  it('invalid newer edit cannot be marked clean by old write completion', async () => {
    const c = controlled(); const q = createProjectWriteQueue(c.repository); await q.load(); q.enqueue(sampleProjects('valid')); const pending = q.flush();
    const invalid = sampleProjects(); invalid.projects[0].viewport.x = Infinity; q.enqueue(invalid);
    expect((await q.flush()).ok).toBe(false); c.writes[0].done.resolve(ok({ value: c.writes[0].value, revision: 5 }));
    expect(valueOf(await pending).value).toEqual(sampleProjects('valid')); await tick();
    expect(q.getState()).toMatchObject({ dirty: true, saving: false, sequence: 2, persistedSequence: 1, revision: 5, error: { code: 'corrupt_data' } });
    expect((await q.flush()).ok).toBe(false);
  });
  it('rejected save promise preserves draft and can explicitly retry; detached state/subscriptions', async () => {
    const repo = createMemoryProjectRepository(); const save = vi.spyOn(repo, 'save').mockRejectedValueOnce(new Error('synthetic private'));
    const q = createProjectWriteQueue(repo); const observed: unknown[] = []; const stop = q.subscribe((s) => { observed.push(s); if (s.committedValue) s.committedValue.projects.length = 0; });
    await q.load(); q.enqueue(sampleProjects()); expect((await q.flush()).ok).toBe(false); expect(q.getState().dirty).toBe(true);
    expect(valueOf(await q.retry()).value).toEqual(sampleProjects()); const state = q.getState(); state.committedValue!.projects.length = 0;
    expect(q.getState().committedValue).toEqual(sampleProjects()); expect(save).toHaveBeenCalledTimes(2); expect(observed.length).toBeGreaterThan(2); stop();
  });
});
