import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    addAsset: vi.fn(() => 'asset-1'),
    confirmSave: vi.fn(),
}));

vi.mock('@/i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('@/services/api/prompts', () => ({ fetchPrompts: vi.fn() }));
vi.mock('@/services/image-storage', () => ({ uploadImage: vi.fn() }));
vi.mock('@/components/image-settings-panel', () => ({ imageAspectOptions: [], imageQualityOptions: [], imageScaleOptions: [] }));
vi.mock('@/components/video-settings-panel', () => ({ videoResolutionOptions: [], videoSecondsRange: [1, 10], videoSizeOptions: [] }));
vi.mock('@/stores/use-asset-store', () => ({ useAssetStore: { getState: () => ({ addAsset: mocks.addAsset, confirmSave: mocks.confirmSave }) } }));
vi.mock('@/stores/canvas/use-canvas-store', () => ({ useCanvasStore: { getState: () => ({}) } }));
vi.mock('@/stores/use-workbench-agent-store', () => ({ useWorkbenchAgentStore: { getState: () => ({}) } }));
vi.mock('@/stores/use-config-store', () => ({
    useConfigStore: { getState: () => ({}) },
    modelOptionLabel: vi.fn(),
    modelOptionName: vi.fn(),
    normalizeModelOptionValue: vi.fn(),
    selectableModelsByCapability: vi.fn(() => []),
}));

import { runSiteTool } from './agent-site-tools';

const navigate = vi.fn() as never;

describe('Agent 素材工具确认边界', () => {
    it('assets_add 只在素材事务确认后返回成功', async () => {
        mocks.confirmSave.mockResolvedValueOnce(undefined);
        await expect(runSiteTool('assets_add', { kind: 'text', title: '素材', content: '内容' }, navigate)).resolves.toMatchObject({ ok: true, id: 'asset-1' });
        expect(mocks.confirmSave).toHaveBeenCalledTimes(1);
    });

    it('素材事务失败时不返回成功', async () => {
        mocks.confirmSave.mockRejectedValueOnce(new Error('fixture write failed'));
        await expect(runSiteTool('assets_add', { kind: 'text', title: '素材', content: '内容' }, navigate)).rejects.toThrow('agent.siteTools.assetSaveFailed');
    });
});
