import 'fake-indexeddb/auto';
import { IDBObjectStore as FakeObjectStore, IDBDatabase as FakeDatabase } from 'fake-indexeddb';
import { deleteDB, openDB } from 'idb';
import localforage from 'localforage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StorageError, Stored } from '../../application/ports/taskRepository';
import type { Result } from '../../domain/shared/result';
import { createIndexedDBAssetRepository, createIndexedDBProjectRepository } from './indexeddb-snapshot-repositories';
import { sampleAssets, sampleProjects, snapshotRepositoryContract, valueOf } from './snapshot-repositories.contract';

const STORE = 'app_state';
const KEY = 'synthetic-snapshot-key';
const databases: string[] = [];
let sequence = 0;
function testName() { const name = `intx-snapshot-repository-test-${++sequence}`; databases.push(name); return name; }
function emptyStorage(): Storage {
  const map = new Map<string, string>();
  return { get length() { return map.size; }, key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); }, removeItem: (k) => { map.delete(k); }, clear: () => { map.clear(); } };
}
function projectRepo(name = testName(), storage = emptyStorage()) { return createIndexedDBProjectRepository({ dbName: name, key: KEY, localStorage: storage }); }
function assetRepo(name = testName(), storage = emptyStorage()) { return createIndexedDBAssetRepository({ dbName: name, key: KEY, localStorage: storage }); }
async function seed(name: string, raw: unknown, key = KEY) {
  const db = await openDB(name, 17, { upgrade(db) { if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE); if (!db.objectStoreNames.contains('synthetic-unrelated')) db.createObjectStore('synthetic-unrelated'); } });
  await db.put(STORE, raw, key); await db.put(STORE, 'synthetic-other-key-value', 'synthetic-other-key');
  await db.put('synthetic-unrelated', 'synthetic-side-value', 'synthetic-side'); db.close();
}
async function rawValue(name: string, key = KEY) { const db = await openDB(name); try { return await db.get(STORE, key); } finally { db.close(); } }
// Only explicitly created synthetic databases are deleted; production database is never opened.
afterEach(async () => { vi.restoreAllMocks(); for (const name of databases.splice(0)) await deleteDB(name); });
snapshotRepositoryContract('IndexedDB projects', () => projectRepo(), { projects: [], deletedProjects: [] }, sampleProjects);
snapshotRepositoryContract('IndexedDB assets', () => assetRepo(), { assets: [] }, sampleAssets);

function storageProtection<T>(kind: string, fixture: (title?: string) => T, make: (name?: string, storage?: Storage) => { load(): Promise<Result<Stored<T>, StorageError>>; save(value: T, revision: number): Promise<Result<Stored<T>, StorageError>> }) {
  describe(`IndexedDB ${kind} storage protection`, () => {
    it('legacy actual localforage JSON read is unchanged; first CAS preserves full fields/order and database version', async () => {
      const name = testName(); const value = fixture();
      const raw = JSON.stringify({ state: value, version: 0 });
      await seed(name, 'synthetic-seed');
      const lf = localforage.createInstance({ name, storeName: STORE, driver: localforage.INDEXEDDB });
      await lf.setItem(KEY, raw);
      const repo = make(name);
      expect(valueOf(await repo.load())).toEqual({ value, revision: 0 }); expect(await rawValue(name)).toBe(raw);
      const next = fixture('edited');
      expect(valueOf(await repo.save(next, 0))).toEqual({ value: next, revision: 1 });
      expect(JSON.parse(await rawValue(name))).toEqual({ state: next, version: 0, metadata: { formatVersion: 1, revision: 1 } });
      expect(valueOf(await make(name).load())).toEqual({ value: next, revision: 1 });
      const db = await openDB(name); expect(db.version).toBe(17);
      expect(await db.get(STORE, 'synthetic-other-key')).toBe('synthetic-other-key-value');
      expect(await db.get('synthetic-unrelated', 'synthetic-side')).toBe('synthetic-side-value'); db.close();
    });
    it('separate connections concurrently save one winner and one conflict', async () => {
      const name = testName(); const a = make(name); const b = make(name);
      await a.save(fixture(), 0); await b.load();
      const writes = await Promise.all([a.save(fixture('a'), 1), b.save(fixture('b'), 1)]);
      expect(writes.filter((r) => r.ok)).toHaveLength(1);
      expect(writes.find((r) => !r.ok)).toEqual({ ok: false, error: { code: 'conflict', expectedRevision: 1, actualRevision: 2, message: expect.any(String) } });
      expect(valueOf(await a.load())).toEqual(valueOf(writes.find((r) => r.ok)!));
    });
    it('late abort after request success fails without changing legacy payload/revision; success follows complete', async () => {
      const name = testName(); const raw = JSON.stringify({ state: fixture(), version: 0 }); await seed(name, raw);
      const repo = make(name); await repo.load(); let succeeded = false;
      const original = FakeObjectStore.prototype.put;
      const spy = vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
        const request = original.apply(this, args); request.addEventListener('success', () => { succeeded = true; this.transaction.abort(); }, { once: true }); return request;
      });
      expect(await repo.save(fixture('not committed'), 0)).toEqual({ ok: false, error: { code: 'write_failed', message: expect.any(String) } });
      expect(succeeded).toBe(true); spy.mockRestore(); expect(await rawValue(name)).toBe(raw);
      let completed = false;
      vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
        this.transaction.addEventListener('complete', () => { completed = true; }); return original.apply(this, args);
      });
      expect(valueOf(await repo.save(fixture('committed'), 0)).revision).toBe(1); expect(completed).toBe(true);
    });
    it.each([
      ['bad JSON', '{synthetic bad JSON', 'corrupt_data'],
      ['not string', { version: 0 }, 'corrupt_data'],
      ['null', null, 'corrupt_data'],
      ['unknown wrapper', JSON.stringify({ payload: {}, format: 1 }), 'unsupported_format'],
      ['bad state', JSON.stringify({ state: { projects: [3], assets: [3] }, version: 0 }), 'corrupt_data'],
      ['unknown version', JSON.stringify({ state: {}, version: 3 }), 'unsupported_format'],
      ['unknown metadata', JSON.stringify({ state: {}, version: 0, metadata: { formatVersion: 9, revision: 0 } }), 'unsupported_format'],
      ['malformed metadata', JSON.stringify({ state: {}, version: 0, metadata: null }), 'corrupt_data'],
    ])('%s refuses load/save and retains raw value exactly', async (_, raw, code) => {
      const name = testName(); await seed(name, raw); const repo = make(name);
      for (const result of [await repo.load(), await repo.save(fixture(), 0)]) expect(result).toEqual({ ok: false, error: { code, message: expect.any(String) } });
      expect(await rawValue(name)).toEqual(raw);
    });
    it('late readonly abort after get success is a read failure, not a loaded snapshot', async () => {
      const name = testName(); await seed(name, JSON.stringify({ state: fixture(), version: 0 }));
      const repo = make(name); await repo.load();
      const original = FakeObjectStore.prototype.get; let succeeded = false;
      vi.spyOn(FakeObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, ...args) {
        const request = original.apply(this, args); request.addEventListener('success', () => { succeeded = true; this.transaction.abort(); }, { once: true }); return request;
      });
      expect(await repo.load()).toEqual({ ok: false, error: { code: 'read_failed', message: expect.any(String) } });
      expect(succeeded).toBe(true);
    });
    it('invalid payload refuses before any database write and preserves original value', async () => {
      const name = testName(); const raw = JSON.stringify({ state: fixture(), version: 0 }); await seed(name, raw);
      const repo = make(name); const put = vi.spyOn(FakeObjectStore.prototype, 'put');
      const value = { ...fixture() as object, hydrated: () => 1 } as T;
      expect(await repo.save(value, 0)).toEqual({ ok: false, error: { code: 'corrupt_data', message: expect.any(String) } });
      expect(put).not.toHaveBeenCalled(); expect(await rawValue(name)).toBe(raw);
    });
    it('quota/put error and read failures are explicit, never empty or exposing raw exception', async () => {
      const name = testName(); const repo = make(name); await repo.load();
      const put = vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('synthetic private exception', 'QuotaExceededError'); });
      expect(await repo.save(fixture(), 0)).toEqual({ ok: false, error: { code: 'write_failed', message: expect.not.stringContaining('private') } }); put.mockRestore();
      const get = vi.spyOn(FakeObjectStore.prototype, 'get').mockImplementation(() => { throw new Error('synthetic private exception'); });
      expect(await repo.load()).toEqual({ ok: false, error: { code: 'read_failed', message: expect.not.stringContaining('private') } });
      expect(await repo.save(fixture(), 0)).toEqual({ ok: false, error: { code: 'read_failed', message: expect.not.stringContaining('private') } }); get.mockRestore();
      expect(await rawValue(name)).toBeUndefined();
    });
    it('fallback presence stops both read and write, enumeration only; restricted enumeration fails safely', async () => {
      const name = testName(); const storage = emptyStorage(); storage.setItem(KEY, 'synthetic fallback'); storage.setItem('synthetic-config', 'must not read');
      const get = vi.spyOn(storage, 'getItem'); const set = vi.spyOn(storage, 'setItem'); const remove = vi.spyOn(storage, 'removeItem');
      const repo = make(name, storage);
      for (const result of [await repo.load(), await repo.save(fixture(), 0)]) expect(result).toEqual({ ok: false, error: { code: 'unsupported_format', message: expect.stringContaining('localStorage') } });
      expect(get).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled(); expect(await rawValue(name)).toBeUndefined();
      Object.defineProperty(storage, 'length', { get() { throw new Error('restricted'); } });
      expect(await repo.save(fixture(), 0)).toEqual({ ok: false, error: { code: 'read_failed', message: expect.any(String) } });
      await seed(name, JSON.stringify({ state: fixture(), version: 0 }));
      expect(valueOf(await repo.save(fixture(), 0)).revision).toBe(1);
    });
  });
}
storageProtection('projects', sampleProjects, projectRepo);
storageProtection('assets', sampleAssets, assetRepo);
describe('snapshot layout and initialization', () => {
  it('lazy defaults do not read any key or open production database', () => {
    const create = vi.spyOn(localforage, 'createInstance'); const open = vi.spyOn(indexedDB, 'open'); const read = vi.spyOn(FakeObjectStore.prototype, 'get');
    createIndexedDBProjectRepository(); createIndexedDBAssetRepository();
    expect(create).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  });
  it('default business keys share same synthetic database; missing store init preserves unrelated data', async () => {
    const name = testName(); const db = await openDB(name, 9, { upgrade(db) { db.createObjectStore('synthetic-unrelated'); } });
    await db.put('synthetic-unrelated', 'keep', 'synthetic'); db.close();
    const options = { dbName: name, localStorage: emptyStorage() };
    await createIndexedDBProjectRepository(options).save(sampleProjects(), 0);
    await createIndexedDBAssetRepository(options).save(sampleAssets(), 0);
    expect(JSON.parse(await rawValue(name, 'infinite-canvas:canvas_store')).state).toEqual(sampleProjects());
    expect(JSON.parse(await rawValue(name, 'infinite-canvas:asset_store')).state).toEqual(sampleAssets());
    const after = await openDB(name); expect(await after.get('synthetic-unrelated', 'synthetic')).toBe('keep'); after.close();
  });
  it('init/transaction rejection is explicit and no localStorage fallback write', async () => {
    const storage = emptyStorage(); const set = vi.spyOn(storage, 'setItem');
    const create = vi.spyOn(localforage, 'createInstance').mockImplementation(() => { throw new Error('private'); });
    const repo = projectRepo(testName(), storage);
    expect(await repo.load()).toEqual({ ok: false, error: { code: 'unavailable', message: expect.any(String) } });
    expect(await repo.save(sampleProjects(), 0)).toEqual({ ok: false, error: { code: 'unavailable', message: expect.any(String) } }); expect(set).not.toHaveBeenCalled(); create.mockRestore();
    await repo.load();
    vi.spyOn(FakeDatabase.prototype, 'transaction').mockImplementation(() => { throw new Error('private'); });
    expect(await repo.load()).toEqual({ ok: false, error: { code: 'read_failed', message: expect.any(String) } });
  });
});
