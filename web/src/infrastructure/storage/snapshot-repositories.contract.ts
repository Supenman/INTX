import { describe, expect, it } from 'vitest';
import type { AssetSnapshot, ProjectSnapshot } from '../../application/ports/snapshotRepositories';
import type { StorageError, Stored } from '../../application/ports/taskRepository';
import type { Result } from '../../domain/shared/result';

export function valueOf<T>(result: Result<T, StorageError>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
export function sampleProjects(title = 'synthetic canvas'): ProjectSnapshot {
  return { projects: [{
    id: 'project-a', title, createdAt: '2026-01-01', updatedAt: '2026-01-02',
    nodes: [{ id: 'image', type: 'image', title: 'Synthetic image', position: { x: -12.5, y: 90 }, width: 640, height: 480,
      metadata: { content: 'blob:synthetic-reference', composerContent: 'composer', prompt: 'no provider', status: 'success',
        fontSize: 14, generationMode: 'image', generationType: 'edit', model: 'synthetic', reasoningEffort: 'high', size: '640x480', quality: 'high', background: 'transparent', count: 2, textCount: 2,
        texts: [{ id: 'text-result', status: 'success', content: 'full text' }], primaryTextId: 'text-result', seconds: '5', vquality: 'test', generateAudio: 'true', watermark: 'false', videoMode: 'test', audioVoice: 'test', audioFormat: 'wav', audioSpeed: '1', audioInstructions: 'synthetic',
        references: ['image-key', 'video-key'], naturalWidth: 640, naturalHeight: 480, freeResize: true,
        images: [{ id: 'result-a', status: 'success', content: 'blob:synthetic', storageKey: 'image-key', naturalWidth: 640, naturalHeight: 480, bytes: 123, mimeType: 'image/png' }], primaryImageId: 'result-a', storageKey: 'image-key', mimeType: 'image/png', bytes: 123, durationMs: 5000, videoTaskId: 'synthetic-id', videoTaskProvider: 'openai', groupId: 'group', interactive: false } },
      { id: 'plugin', type: 'synthetic:plugin', title: 'plugin', position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { customData: { a: [true, null, 'keep'] } } as never }],
    connections: [{ id: 'edge', fromNodeId: 'image', toNodeId: 'plugin' }],
    chatSessions: [{ id: 'chat', title: 'full chat', messages: [{ id: 'm1', role: 'user', text: 'first', references: [{ id: 'ref', type: 'image', title: 'ref', dataUrl: 'blob:ref', storageKey: 'image-key', text: 'reference text' }] }, { id: 'm2', role: 'assistant', title: 'answer', text: 'second', meta: 'meta', detail: { nested: [1, true, null] } }], createdAt: '2026-01-01', updatedAt: '2026-01-02' }],
    activeChatId: 'chat', backgroundMode: 'dots', showImageInfo: true, viewport: { x: 123, y: -25, k: 0.75 },
  }, { id: 'project-b', title: 'second', createdAt: 'synthetic-date', updatedAt: 'synthetic-date', nodes: [], connections: [], chatSessions: [], activeChatId: null, backgroundMode: 'blank', showImageInfo: false, viewport: { x: 0, y: 0, k: 1 } }], deletedProjects: [{ id: 'deleted-b', deletedAt: 'synthetic-b' }, { id: 'deleted-a', deletedAt: 'synthetic-a' }] };
}
export function sampleAssets(title = 'synthetic asset'): AssetSnapshot {
  const base = { title, coverUrl: 'blob:synthetic-cover', tags: ['second', 'first'], source: 'synthetic', note: 'full note', createdAt: '2026-01-01', updatedAt: '2026-01-02', metadata: { prompt: 'no provider', nested: { values: [null, true, 2] } } };
  return { assets: [
    { ...base, id: 'video', kind: 'video', data: { url: 'blob:synthetic-video', storageKey: 'video-key', width: 1920, height: 1080, bytes: 987, mimeType: 'video/mp4' } },
    { ...base, id: 'image', kind: 'image', data: { dataUrl: 'data:image/png;base64,c3ludGhldGlj', storageKey: 'image-key', width: 640, height: 480, bytes: 123, mimeType: 'image/png' } },
    { ...base, id: 'text', kind: 'text', data: { content: 'full multiline\ntext' } },
  ] };
}
export function snapshotRepositoryContract<T>(name: string, create: () => { load(): Promise<Result<Stored<T>, StorageError>>; save(v: T, r: number): Promise<Result<Stored<T>, StorageError>> }, empty: T, fixture: (title?: string) => T) {
  describe(`${name} snapshot contract`, () => {
    it('empty only after successful read; first write revision one; full detached aggregate preserved', async () => {
      const repo = create(); expect(valueOf(await repo.load())).toEqual({ value: empty, revision: 0 });
      const value = fixture(); expect(valueOf(await repo.save(value, 0))).toEqual({ value, revision: 1 });
      const returned = valueOf(await repo.load());
      expect(returned).toEqual({ value, revision: 1 });
      Object.assign(value as object, empty); Object.assign(returned.value as object, empty);
      expect(valueOf(await repo.load())).toEqual({ value: fixture(), revision: 1 });
    });
    it('CAS refuses stale revisions and has only one concurrent winner', async () => {
      const repo = create(); await repo.save(fixture(), 0);
      const writes = await Promise.all([repo.save(fixture('one'), 1), repo.save(fixture('two'), 1)]);
      expect(writes.filter((r) => r.ok)).toHaveLength(1);
      expect(writes.find((r) => !r.ok)).toEqual({ ok: false, error: { code: 'conflict', message: expect.any(String), expectedRevision: 1, actualRevision: 2 } });
      expect(valueOf(await repo.load())).toEqual(valueOf(writes.find((r) => r.ok)!));
    });
    it.each([-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('invalid expected revision %s refuses without changing confirmed data', async (revision) => {
      const repo = create(); await repo.save(fixture(), 0);
      expect(await repo.save(fixture('bad'), revision)).toEqual({ ok: false, error: { code: 'corrupt_data', message: expect.any(String) } });
      expect(valueOf(await repo.load())).toEqual({ value: fixture(), revision: 1 });
    });
    it('unknown state/actions are rejected, no JSON silent dropping', async () => {
      const repo = create(); await repo.save(fixture(), 0);
      for (const extra of [undefined, () => 1, 1]) {
        const value = { ...fixture() as object, hydrated: extra } as T;
        // Even undefined cannot turn an unknown top-level transient field into a saved payload.
        expect(await repo.save(value, 1)).toEqual({ ok: false, error: { code: 'corrupt_data', message: expect.any(String) } });
      }
      expect(valueOf(await repo.load())).toEqual({ value: fixture(), revision: 1 });
    });
  });
}
