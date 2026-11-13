import 'fake-indexeddb/auto';
import { IDBObjectStore as FakeObjectStore, IDBDatabase as FakeDatabase } from 'fake-indexeddb';
import { deleteDB, openDB } from 'idb';
import localforage from 'localforage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIndexedDBTaskRepository } from './indexeddb-task-repository';
import { sampleTask, taskRepositoryContract, valueOf } from './task-repository.contract';

const KEY = 'infinite-canvas:intx_task_log';
const STORE = 'app_state';
let sequence = 0;
const databases: string[] = [];
function testName() {
  const name = `intx-task-repository-test-${++sequence}`;
  databases.push(name);
  return name;
}
function emptyStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
    clear: () => { map.clear(); },
  };
}
function repository(name = testName(), storage = emptyStorage()) {
  return createIndexedDBTaskRepository({ dbName: name, localStorage: storage });
}
async function seed(name: string, raw: unknown, version = 7) {
  const db = await openDB(name, version, { upgrade(db) {
    if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    if (!db.objectStoreNames.contains('unrelated')) db.createObjectStore('unrelated');
  } });
  await db.put(STORE, raw, KEY);
  await db.put('unrelated', '人工无秘密旁数据', 'other');
  db.close();
}
async function rawValue(name: string, key = KEY) {
  const db = await openDB(name);
  try { return await db.get(STORE, key); } finally { db.close(); }
}

// 只删除每个测试明确创建的库；从不访问/清空生产 infinite-canvas。
afterEach(async () => {
  vi.restoreAllMocks();
  for (const name of databases.splice(0)) await deleteDB(name);
});

taskRepositoryContract('IndexedDB', () => repository());

describe('IndexedDB 任务事务与现有格式保护', () => {
  it('构造默认实现不 ready/open/read key，也不枚举 localStorage', () => {
    const ready = vi.spyOn(localforage, 'createInstance');
    const read = vi.spyOn(FakeObjectStore.prototype, 'get');
    const open = vi.spyOn(indexedDB, 'open');
    const storage = emptyStorage(); const enumerate = vi.spyOn(storage, 'key');
    createIndexedDBTaskRepository();
    createIndexedDBTaskRepository({ dbName: testName(), localStorage: storage });
    expect(ready).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled(); expect(enumerate).not.toHaveBeenCalled();
  });

  it('缺失数据库由 localforage INDEXEDDB 初始化，key 不存在时才是空', async () => {
    const name = testName(); const create = vi.spyOn(localforage, 'createInstance');
    const repo = repository(name);
    expect(valueOf(await repo.list())).toEqual([]);
    expect(create).toHaveBeenCalledWith({ name, storeName: STORE, driver: localforage.INDEXEDDB });
    expect(await rawValue(name)).toBeUndefined();
    expect(valueOf(await repo.create(sampleTask())).revision).toBe(1);
  });

  it('既有库缺少 app_state 时协调创建，不丢其他仓库数据', async () => {
    const name = testName();
    const original = await openDB(name, 9, { upgrade(db) { db.createObjectStore('unrelated'); } });
    await original.put('unrelated', '人工旁数据', 'other'); original.close();
    const repo = repository(name);
    expect(valueOf(await repo.create(sampleTask())).revision).toBe(1);
    const db = await openDB(name);
    expect(await db.get('unrelated', 'other')).toBe('人工旁数据'); db.close();
  });

  it('localforage 原 JSON 字符串只读不改，首写补元数据且保留完整任务/顺序/库版本', async () => {
    const name = testName(); const a = sampleTask('a'); const b = sampleTask('b');
    // 用实际 localforage setItem 生成当前序列化/布局样本，不用生产数据。
    const instance = localforage.createInstance({ name, storeName: STORE, driver: localforage.INDEXEDDB });
    const raw = JSON.stringify({ state: { tasks: [a, b] }, version: 0 });
    await instance.setItem(KEY, raw);
    const before = await openDB(name); const version = before.version; before.close();
    const repo = repository(name);
    expect(valueOf(await repo.list())).toEqual([{ value: a, revision: 0 }, { value: b, revision: 0 }]);
    expect(await rawValue(name)).toBe(raw);
    const next = { ...a, upstreamRef: 'updated-ref' };
    expect(valueOf(await repo.replace(next, 0))).toEqual({ value: next, revision: 1 });
    expect(JSON.parse(await rawValue(name))).toEqual({
      state: { tasks: [next, b] }, version: 0, metadata: { formatVersion: 1, revisions: { a: 1, b: 0 } },
    });
    const db = await openDB(name); expect(db.version).toBe(version); db.close();
    const reopened = repository(name);
    expect(valueOf(await reopened.list())).toEqual([{ value: next, revision: 1 }, { value: b, revision: 0 }]);
  });

  it('首 create 保留 legacy 任务且仅新任务 revision=1，高版本库不被降级', async () => {
    const name = testName(); const old = sampleTask('old'); const task = sampleTask('new');
    await seed(name, JSON.stringify({ state: { tasks: [old] }, version: 0 }), 17);
    const repo = repository(name);
    expect(valueOf(await repo.create(task))).toEqual({ value: task, revision: 1 });
    expect(JSON.parse(await rawValue(name))).toEqual({
      state: { tasks: [task, old] }, version: 0, metadata: { formatVersion: 1, revisions: { new: 1, old: 0 } },
    });
    const db = await openDB(name); expect(db.version).toBe(17);
    expect(await db.get('unrelated', 'other')).toBe('人工无秘密旁数据'); db.close();
  });

  it('request put 成功后晚阶段 abort 返回 write_failed，revision/数据未提交', async () => {
    const name = testName(); const repo = repository(name); const task = sampleTask();
    await repo.create(task); const before = await rawValue(name);
    const original = FakeObjectStore.prototype.put;
    let succeeded = false;
    vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      const request = original.apply(this, args);
      request.addEventListener('success', () => { succeeded = true; this.transaction.abort(); }, { once: true });
      return request;
    });
    expect(await repo.replace({ ...task, upstreamRef: '不应提交' }, 1)).toEqual({ ok: false, error: {
      code: 'write_failed', message: expect.any(String),
    } });
    expect(succeeded).toBe(true); vi.restoreAllMocks();
    expect(await rawValue(name)).toBe(before);
    expect(valueOf(await repo.get(task.id))).toEqual({ value: task, revision: 1 });
  });

  it('create 最后阶段 abort 不创建记录，成功结果确实晚于 complete 事件', async () => {
    const name = testName(); const repo = repository(name); await repo.list();
    const original = FakeObjectStore.prototype.put;
    const spy = vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      const request = original.apply(this, args);
      request.addEventListener('success', () => this.transaction.abort(), { once: true }); return request;
    });
    expect(await repo.create(sampleTask())).toEqual({ ok: false, error: { code: 'write_failed', message: expect.any(String) } });
    spy.mockRestore(); expect(await rawValue(name)).toBeUndefined();
    let complete = false;
    vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      this.transaction.addEventListener('complete', () => { complete = true; }); return original.apply(this, args);
    });
    expect(valueOf(await repo.create(sampleTask())).revision).toBe(1); expect(complete).toBe(true);
  });

  it('独立连接同任务并发 conflict，不同任务并发不丢', async () => {
    const name = testName(); const first = repository(name); const second = repository(name);
    const a = sampleTask('a'); const b = sampleTask('b');
    await first.create(a); await second.create(b);
    const writes = await Promise.all([first.replace({ ...a, upstreamRef: 'one' }, 1), second.replace({ ...a, upstreamRef: 'two' }, 1)]);
    expect(writes.filter((r) => r.ok)).toHaveLength(1);
    expect(writes.find((r) => !r.ok)).toEqual({ ok: false, error: {
      code: 'conflict', expectedRevision: 1, actualRevision: 2, message: expect.any(String),
    } });
    expect((await Promise.all([first.replace({ ...a, upstreamRef: 'a-final' }, 2), second.replace({ ...b, upstreamRef: 'b-final' }, 1)])).every((r) => r.ok)).toBe(true);
    expect(valueOf(await first.get('a'))?.value.upstreamRef).toBe('a-final');
    expect(valueOf(await second.get('b'))?.value.upstreamRef).toBe('b-final');
  });

  it.each([
    ['非法JSON', '{人工损坏JSON', 'corrupt_data'],
    ['非字符串', { state: { tasks: [] }, version: 0 }, 'corrupt_data'],
    ['null不是缺失', null, 'corrupt_data'],
    ['未知Zustand版本', JSON.stringify({ state: { tasks: [] }, version: 9 }), 'unsupported_format'],
    ['未知metadata版本', JSON.stringify({ state: { tasks: [] }, version: 0, metadata: { formatVersion: 2, revisions: {} } }), 'unsupported_format'],
    ['非法Task', JSON.stringify({ state: { tasks: [{ ...sampleTask(), attempt: '1' }] }, version: 0 }), 'corrupt_data'],
    ['非法嵌套参数', JSON.stringify({ state: { tasks: [{ ...sampleTask(), params: { ...sampleTask().params, inputAssetIds: [3] } }] }, version: 0 }), 'corrupt_data'],
    ['重复id', JSON.stringify({ state: { tasks: [sampleTask(), sampleTask()] }, version: 0 }), 'corrupt_data'],
    ['遗漏revision', JSON.stringify({ state: { tasks: [sampleTask()] }, version: 0, metadata: { formatVersion: 1, revisions: {} } }), 'corrupt_data'],
    ['多余revision', JSON.stringify({ state: { tasks: [] }, version: 0, metadata: { formatVersion: 1, revisions: { ghost: 1 } } }), 'corrupt_data'],
    ['负revision', JSON.stringify({ state: { tasks: [sampleTask()] }, version: 0, metadata: { formatVersion: 1, revisions: { 'task-a': -1 } } }), 'corrupt_data'],
    ['小数revision', JSON.stringify({ state: { tasks: [sampleTask()] }, version: 0, metadata: { formatVersion: 1, revisions: { 'task-a': 1.1 } } }), 'corrupt_data'],
    ['metadata损坏', JSON.stringify({ state: { tasks: [] }, version: 0, metadata: null }), 'corrupt_data'],
    ['Task夹带revision', JSON.stringify({ state: { tasks: [{ ...sampleTask(), revision: 1 }] }, version: 0 }), 'corrupt_data'],
  ])('%s 拒绝读写且原值逐字不变', async (_, raw, code) => {
    const name = testName(); await seed(name, raw); const repo = repository(name);
    for (const result of [await repo.list(), await repo.get('task-a'), await repo.create(sampleTask('new')), await repo.replace(sampleTask(), 0)]) {
      expect(result).toEqual({ ok: false, error: { code, message: expect.any(String) } });
      expect(JSON.stringify(result)).not.toContain('人工损坏JSON');
    }
    expect(await rawValue(name)).toEqual(raw);
  });

  it('legacy 首次写失败不补metadata，不覆盖旧业务记录', async () => {
    const name = testName(); const raw = JSON.stringify({ state: { tasks: [sampleTask()] }, version: 0 });
    await seed(name, raw); const repo = repository(name);
    vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('raw私密不得记录', 'QuotaExceededError'); });
    const result = await repo.replace(sampleTask(), 0);
    expect(result).toEqual({ ok: false, error: { code: 'write_failed', message: expect.any(String) } });
    expect(JSON.stringify(result)).not.toContain('raw私密'); vi.restoreAllMocks();
    expect(await rawValue(name)).toBe(raw);
  });

  it('读失败明确 read_failed，不当空；未记录 raw 异常', async () => {
    const name = testName(); const repo = repository(name); await repo.list();
    vi.spyOn(FakeObjectStore.prototype, 'get').mockImplementation(() => { throw new Error('raw私密'); });
    expect(await repo.list()).toEqual({ ok: false, error: { code: 'read_failed', message: expect.any(String) } });
    expect(await repo.create(sampleTask())).toEqual({ ok: false, error: { code: 'read_failed', message: expect.any(String) } });
    vi.restoreAllMocks(); expect(await rawValue(name)).toBeUndefined();
  });

  it('初始化拒绝只返回 unavailable，不fallback、不记录 raw', async () => {
    const storage = emptyStorage(); const set = vi.spyOn(storage, 'setItem');
    vi.spyOn(localforage, 'createInstance').mockImplementation(() => { throw new Error('raw私密'); });
    const repo = repository(testName(), storage);
    expect(await repo.list()).toEqual({ ok: false, error: { code: 'unavailable', message: expect.any(String) } });
    expect(await repo.create(sampleTask())).toEqual({ ok: false, error: { code: 'unavailable', message: expect.any(String) } });
    expect(set).not.toHaveBeenCalled();
  });

  it('事务创建拒绝同样显式失败，不将异常返回值当空', async () => {
    const repo = repository(); await repo.list();
    vi.spyOn(FakeDatabase.prototype, 'transaction').mockImplementation(() => { throw new Error('raw私密'); });
    expect(await repo.list()).toEqual({ ok: false, error: { code: 'read_failed', message: expect.any(String) } });
  });

  it('IndexedDB无key但localStorage旧key存在则拒绝写，仅检测键、不读值/配置/不导入', async () => {
    const name = testName(); const storage = emptyStorage();
    storage.setItem('人工配置键', '禁止读取'); storage.setItem(KEY, '原回退字符串无需解析');
    const get = vi.spyOn(storage, 'getItem'); const set = vi.spyOn(storage, 'setItem'); const remove = vi.spyOn(storage, 'removeItem');
    const repo = repository(name, storage);
    expect(await repo.list()).toEqual({ ok: false, error: { code: 'unsupported_format', message: expect.stringContaining('localStorage') } });
    expect(await repo.get('task-a')).toEqual({ ok: false, error: { code: 'unsupported_format', message: expect.stringContaining('localStorage') } });
    expect(await repo.create(sampleTask())).toEqual({ ok: false, error: { code: 'unsupported_format', message: expect.stringContaining('localStorage') } });
    expect(await repo.replace(sampleTask(), 0)).toEqual({ ok: false, error: { code: 'unsupported_format', message: expect.stringContaining('localStorage') } });
    expect(await rawValue(name)).toBeUndefined(); expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  });

  it('检测localStorage受限时拒绝写；已有IndexedDB记录无需触碰localStorage', async () => {
    const name = testName(); const storage = emptyStorage();
    Object.defineProperty(storage, 'length', { get() { throw new Error('禁止访问'); } });
    const repo = repository(name, storage);
    expect(await repo.create(sampleTask())).toEqual({ ok: false, error: { code: 'read_failed', message: expect.any(String) } });
    const a = sampleTask(); await seed(name, JSON.stringify({ state: { tasks: [a] }, version: 0 }));
    expect(valueOf(await repo.replace(a, 0))).toEqual({ value: a, revision: 1 });
  });

  it('注入key只访问指定测试键，保留同库旁键', async () => {
    const name = testName(); await seed(name, '人工旁任务键，不应读取');
    const repo = createIndexedDBTaskRepository({ dbName: name, key: 'isolated-test-key', localStorage: emptyStorage() });
    expect(valueOf(await repo.create(sampleTask())).revision).toBe(1);
    expect(await rawValue(name)).toBe('人工旁任务键，不应读取');
    expect(JSON.parse(await rawValue(name, 'isolated-test-key')).state.tasks).toEqual([sampleTask()]);
  });
});
