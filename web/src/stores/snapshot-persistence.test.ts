import { describe, expect, it, vi } from 'vitest';
import { err } from '@/domain/shared/result';
import { createMemoryAssetRepository, createMemoryProjectRepository } from '@/infrastructure/storage/memory-snapshot-repositories';
import { createCanvasStore } from './canvas/use-canvas-store';
import { createAssetStore } from './use-asset-store';
import { SnapshotPersistenceError } from '@/application/persistence/error';

vi.mock('@/i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('@/infrastructure/storage/indexeddb-snapshot-repositories', async () => {
    const memory = await import('@/infrastructure/storage/memory-snapshot-repositories');
    return { createIndexedDBProjectRepository: memory.createMemoryProjectRepository, createIndexedDBAssetRepository: memory.createMemoryAssetRepository };
});
vi.mock('@/services/image-storage', () => ({ cleanupUnusedImages: vi.fn(), ensureImagePreview: vi.fn(async () => {}), previewUrlFor: vi.fn(), resolveImageUrl: vi.fn(async (_key, url) => url), uploadImage: vi.fn() }));
vi.mock('@/services/file-storage', () => ({ cleanupUnusedMedia: vi.fn(), resolveMediaUrl: vi.fn(async (_key, url) => url) }));

const writeError = () => err({ code: 'write_failed' as const, message: 'fixture write failed' });
const text = { kind: 'text' as const, title: 'fixture', coverUrl: '', tags: [], data: { content: 'fixture content' } };
function gate() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    return { resolve, promise };
}

describe('项目和素材 store 真实保存边界', () => {
    it('素材读取失败可重新加载；失败状态不会假报空库或执行保存', async () => {
        const repo = createMemoryAssetRepository();
        let fail = true;
        const save = vi.fn(repo.save);
        const store = createAssetStore({ ...repo, save, load: () => fail ? Promise.resolve(err({ code: 'read_failed' as const, message: 'fixture read failed' })) : repo.load() });
        await expect(store.getState().load()).rejects.toThrow('fixture read failed');
        expect(store.getState().hydrated).toBe(false);
        expect(() => store.getState().addAsset(text)).toThrow(SnapshotPersistenceError);
        expect(save).not.toHaveBeenCalled();
        fail = false;
        await store.getState().load();
        expect(store.getState().hydrated).toBe(true);
        expect(store.getState().loadError).toBeNull();
    });
    it('非法最新编辑保留内存并标记未保存，不打断渲染，flush不得假报旧快照已保存', async () => {
        const store = createCanvasStore(createMemoryProjectRepository());
        await store.getState().load();
        const id = store.getState().createProject('fixture');
        await store.getState().flush();
        expect(() => store.getState().updateProject(id, { viewport: { x: NaN, y: 0, k: 1 } })).not.toThrow();
        expect(Number.isNaN(store.getState().projects[0].viewport.x)).toBe(true);
        expect(store.getState().persistence.dirty).toBe(true);
        expect(store.getState().persistence.error).toMatchObject({ code: 'corrupt_data' });
        await expect(store.getState().flush()).rejects.toMatchObject({ detail: { code: 'corrupt_data' } });
        // 用户改回合法值后，草稿仍可明确补写，不需要重新加载。
        store.getState().updateProject(id, { viewport: { x: 0, y: 0, k: 1 } });
        await store.getState().flush();
        expect(store.getState().persistence.dirty).toBe(false);
    });
    it('成功加载前同步动作拒绝，不允许空草稿覆盖旧集合', async () => {
        const repo = createMemoryProjectRepository();
        const store = createCanvasStore({ ...repo, load: async () => err({ code: 'read_failed' as const, message: 'fixture load failed' }) });
        expect(() => store.getState().createProject()).toThrow(SnapshotPersistenceError);
        await expect(store.getState().load()).rejects.toThrow('fixture load failed');
        expect(store.getState().hydrated).toBe(false);
        expect(store.getState().loadError).toBe('fixture load failed');
        expect(() => store.getState().replaceProjects([])).toThrow(SnapshotPersistenceError);
        expect((await repo.load())).toMatchObject({ ok: true, value: { revision: 0 } });
    });

    it('加载成功不写回；创建同步返回id，flush立即跨过400ms防抖确认保存', async () => {
        const repo = createMemoryProjectRepository();
        const save = vi.fn(repo.save);
        const store = createCanvasStore({ ...repo, save });
        await store.getState().load();
        expect(save).not.toHaveBeenCalled();
        const id = store.getState().createProject('fixture');
        expect(store.getState().persistence.dirty).toBe(true);
        expect(save).not.toHaveBeenCalled();
        await store.getState().flush();
        expect(store.getState().persistence.dirty).toBe(false);
        expect(await repo.load()).toMatchObject({ ok: true, value: { revision: 1, value: { projects: [{ id }] } } });
    });

    it('保存失败保留项目草稿与墓碑，重试成功才清dirty', async () => {
        const repo = createMemoryProjectRepository();
        let fail = true;
        const store = createCanvasStore({ ...repo, save: (value, revision) => fail ? Promise.resolve(writeError()) : repo.save(value, revision) });
        await store.getState().load();
        const id = store.getState().createProject('fixture');
        store.getState().deleteProjects([id]);
        await expect(store.getState().flush()).rejects.toThrow('fixture write failed');
        expect(store.getState().deletedProjects[0].id).toBe(id);
        expect(store.getState().persistence).toMatchObject({ dirty: true, revision: 0 });
        fail = false;
        await store.getState().retrySave();
        expect(store.getState().persistence.dirty).toBe(false);
        expect(await repo.load()).toMatchObject({ ok: true, value: { value: { projects: [], deletedProjects: [{ id }] } } });
    });

    it('保存中继续编辑，旧快照完成不能清除新草稿', async () => {
        const repo = createMemoryProjectRepository();
        const entered = gate(); const wait = gate();
        let first = true;
        const store = createCanvasStore({ ...repo, async save(value, revision) {
            if (first) { first = false; entered.resolve(); await wait.promise; }
            return repo.save(value, revision);
        } });
        await store.getState().load();
        const id = store.getState().createProject('first');
        const flush = store.getState().flush();
        await entered.promise;
        store.getState().renameProject(id, 'latest');
        wait.resolve();
        await flush;
        expect(store.getState().projects[0].title).toBe('latest');
        await store.getState().flush();
        expect(await repo.load()).toMatchObject({ ok: true, value: { value: { projects: [{ title: 'latest' }] } } });
    });

    it('集合冲突拒绝重载/盲目覆盖，原revision与草稿保留', async () => {
        const repo = createMemoryProjectRepository();
        const a = createCanvasStore(repo); const b = createCanvasStore(repo);
        await Promise.all([a.getState().load(), b.getState().load()]);
        a.getState().createProject('confirmed');
        await a.getState().flush();
        b.getState().createProject('draft');
        await expect(b.getState().flush()).rejects.toMatchObject({ detail: { code: 'conflict' } });
        await b.getState().load();
        await expect(b.getState().retrySave()).rejects.toMatchObject({ detail: { code: 'conflict' } });
        expect(b.getState().projects[0].title).toBe('draft');
        expect(b.getState().persistence).toMatchObject({ dirty: true, revision: 0 });
        expect(await repo.load()).toMatchObject({ ok: true, value: { value: { projects: [{ title: 'confirmed' }] } } });
    });

    it('保存失败后业务确认边界会补写同一草稿，不需要用户再点一次重试', async () => {
        const repo = createMemoryAssetRepository();
        let fail = true;
        const store = createAssetStore({ ...repo, save: (value, revision) => fail ? Promise.resolve(writeError()) : repo.save(value, revision) });
        await store.getState().load();
        const id = store.getState().addAsset(text);
        await expect(store.getState().flush()).rejects.toThrow('fixture write failed');
        fail = false;
        await store.getState().confirmSave();
        expect(store.getState().persistence).toMatchObject({ dirty: false, error: null });
        expect(await repo.load()).toMatchObject({ ok: true, value: { revision: 1, value: { assets: [{ id }] } } });
    });
    it('素材同步添加不等于确认，终态保存失败仍保留id和草稿', async () => {
        const repo = createMemoryAssetRepository();
        const store = createAssetStore({ ...repo, save: async () => writeError() });
        await store.getState().load();
        const id = store.getState().addAsset(text);
        await expect(store.getState().flush()).rejects.toThrow('fixture write failed');
        expect(store.getState().assets[0].id).toBe(id);
        expect(store.getState().persistence.dirty).toBe(true);
    });

    it('素材元数据删除失败不调度媒体清理，补写确认后再清理', async () => {
        const repo = createMemoryAssetRepository();
        let fail = false;
        const cleanup = vi.fn(async () => {});
        const store = createAssetStore({ ...repo, save: (value, revision) => fail ? Promise.resolve(writeError()) : repo.save(value, revision) }, { restore: async (assets) => assets, cleanup });
        await store.getState().load();
        const id = store.getState().addAsset(text);
        await store.getState().flush();
        fail = true;
        store.getState().removeAsset(id);
        await expect(store.getState().flush()).rejects.toThrow();
        expect(cleanup).not.toHaveBeenCalled();
        fail = false;
        await store.getState().retrySave();
        await Promise.resolve(); await Promise.resolve();
        expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it('手动清理入口也先等待元数据保存，失败不运行清理', async () => {
        const cleanup = vi.fn(async () => {});
        const repo = createMemoryAssetRepository();
        const store = createAssetStore({ ...repo, save: async () => writeError() }, { restore: async (assets) => assets, cleanup });
        await store.getState().load();
        store.getState().addAsset(text);
        store.getState().cleanupImages();
        await expect(store.getState().flush()).rejects.toThrow();
        expect(cleanup).not.toHaveBeenCalled();
    });

    it('媒体恢复等待期间不允许编辑，也不重写初次读取的快照', async () => {
        const repo = createMemoryAssetRepository();
        const entered = gate(); const wait = gate(); const save = vi.fn(repo.save);
        const store = createAssetStore({ ...repo, save }, { async restore(assets) { entered.resolve(); await wait.promise; return assets; }, cleanup: vi.fn() });
        const loading = store.getState().load();
        await entered.promise;
        expect(store.getState().hydrated).toBe(false);
        expect(() => store.getState().addAsset(text)).toThrow(SnapshotPersistenceError);
        wait.resolve(); await loading;
        expect(store.getState().hydrated).toBe(true);
        expect(save).not.toHaveBeenCalled();
    });
});
