import type { AssetRepository, ProjectRepository } from '../../application/ports/snapshotRepositories';
import { ok } from '../../domain/shared/result';
import { assetSnapshotCodec, nextSnapshot, projectSnapshotCodec, type SnapshotCodec } from './snapshot-storage';

function repository<T>(codec: SnapshotCodec<T>) {
  let stored = { value: codec.empty(), revision: 0 };
  return {
    async load() { return ok({ value: structuredClone(stored.value), revision: stored.revision }); },
    async save(value: T, expectedRevision: number) {
      const copied = codec.copy(value);
      if (!copied.ok) return copied;
      const next = nextSnapshot(copied.value, expectedRevision, stored.revision);
      if (next.ok) stored = next.value;
      return next.ok ? ok(structuredClone(next.value)) : next;
    },
  };
}
export function createMemoryProjectRepository(): ProjectRepository { return repository(projectSnapshotCodec); }
export function createMemoryAssetRepository(): AssetRepository { return repository(assetSnapshotCodec); }
