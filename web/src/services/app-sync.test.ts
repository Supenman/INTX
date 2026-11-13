import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const canvas = { load: vi.fn(async () => {}), projects: [], deletedProjects: [], replaceProjects: vi.fn(), confirmSave: vi.fn() };
    const assets = { load: vi.fn(async () => {}), assets: [], replaceAssets: vi.fn(), confirmSave: vi.fn() };
    return { canvas, assets };
});

vi.mock('localforage', () => ({ default: { createInstance: () => ({ iterate: async () => {}, clear: async () => {}, setItem: async () => {} }) } }));
vi.mock('@/i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('@/services/file-storage', () => ({ getMediaBlob: async () => null, resolveMediaUrl: async (_key: string, url: string) => url, setMediaBlob: async () => {} }));
vi.mock('@/services/image-storage', () => ({ getImageBlob: async () => null, resolveImageUrl: async (_key: string, url: string) => url, setImageBlob: async () => {} }));
vi.mock('@/stores/canvas/use-canvas-store', () => ({ useCanvasStore: { getState: () => mocks.canvas } }));
vi.mock('@/stores/use-asset-store', () => ({ useAssetStore: { getState: () => mocks.assets } }));
vi.mock('@/services/webdav-sync', () => ({
    WEBDAV_MANIFEST_FILE_NAME: 'manifest.json',
    uploadWebdavFile: async () => {},
    downloadWebdavFile: async (_config: unknown, path: string) => {
        const domain = path.startsWith('canvas/') ? 'canvas' : path.startsWith('assets/') ? 'assets' : null;
        if (!domain) return null;
        const data = domain === 'canvas' ? { projects: [], deleted: [] } : { assets: [] };
        return new Blob([JSON.stringify({ app: 'infinite-canvas', version: 1, domain, exportedAt: '', data, files: [] })]);
    },
}));

import { syncAppDataToWebdav } from './app-sync';

describe('WebDAV 本地应用保存边界', () => {
    it('远端数据落地后等待项目/素材事务提交，提交前不报告同步完成', async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        mocks.canvas.confirmSave.mockReturnValueOnce(gate);
        mocks.assets.confirmSave.mockReturnValueOnce(gate);
        let done = false;
        const syncing = syncAppDataToWebdav({} as never).then(() => { done = true; });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(mocks.canvas.replaceProjects).toHaveBeenCalled();
        expect(mocks.assets.replaceAssets).toHaveBeenCalled();
        expect(done).toBe(false);
        release();
        await syncing;
        expect(done).toBe(true);
    });

    it('本地提交失败时同步失败，不返回完整成功', async () => {
        mocks.canvas.confirmSave.mockRejectedValueOnce(new Error('fixture local save failed'));
        mocks.assets.confirmSave.mockResolvedValueOnce(undefined);
        await expect(syncAppDataToWebdav({} as never)).rejects.toThrow('fixture local save failed');
    });
});
