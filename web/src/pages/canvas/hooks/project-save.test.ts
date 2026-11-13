import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushProjectBeforeLeave, handOffProjectSnapshot, viewportChanged, type EditorPatch } from './project-save';
import type { CanvasProject } from '@/application/persistence/types';

const patch: EditorPatch = { nodes: [], connections: [], chatSessions: [], activeChatId: null, backgroundMode: 'lines', showImageInfo: false, viewport: { x: 0, y: 0, k: 1 } };
const project: CanvasProject = { ...patch, id: 'fixture', title: 'fixture', createdAt: 'fixture', updatedAt: 'fixture' };
afterEach(() => vi.useRealTimers());
describe('项目页面最后快照交出', () => {
    it('载入原视图不算未保存，拖动或缩放才需要500ms保存', () => {
        expect(viewportChanged({ x: 10, y: 20, k: 1 }, { x: 10, y: 20, k: 1 })).toBe(false);
        expect(viewportChanged({ x: 10, y: 20, k: 1 }, { x: 11, y: 20, k: 1 })).toBe(true);
        expect(viewportChanged(undefined, { x: 0, y: 0, k: 1 })).toBe(true);
    });
    it('离开屏障等保存结束，期间新编辑必须再保存才完成', async () => {
        let finish!: () => void;
        const wait = new Promise<void>((r) => { finish = r; });
        let dirty = true;
        const flush = vi.fn().mockImplementationOnce(() => wait).mockImplementationOnce(async () => { dirty = false; });
        const completed = vi.fn();
        const run = flushProjectBeforeLeave({ handOff: vi.fn(), dirty: () => dirty, flush, retry: vi.fn() }).then(completed);
        await Promise.resolve();
        expect(completed).not.toHaveBeenCalled();
        finish(); await run;
        expect(flush).toHaveBeenCalledTimes(2);
        expect(completed).toHaveBeenCalledTimes(1);
    });
    it('持续轮询更新不会无限拖住离开；最多补写一次后放行', async () => {
        const flush = vi.fn(async () => {});
        await flushProjectBeforeLeave({ handOff: vi.fn(), dirty: () => true, flush, retry: vi.fn() });
        expect(flush).toHaveBeenCalledTimes(2);
    });
    it('失败拒绝离开，不清草稿，不自动重试；明确补写只走本地retry', async () => {
        const flush = vi.fn(async () => { throw new Error('fixture failure'); });
        const retry = vi.fn(async () => {});
        await expect(flushProjectBeforeLeave({ handOff: vi.fn(), dirty: () => true, flush, retry })).rejects.toThrow('fixture failure');
        expect(flush).toHaveBeenCalledTimes(1);
        expect(retry).not.toHaveBeenCalled();
        await flushProjectBeforeLeave({ handOff: vi.fn(), dirty: () => false, flush, retry }, true);
        expect(retry).toHaveBeenCalledTimes(1);
        expect(flush).toHaveBeenCalledTimes(1);
    });
    it('离开前交出尚未到500ms的viewport，并取消旧页面定时器', () => {
        vi.useFakeTimers();
        const stale = vi.fn();
        const timer = { current: setTimeout(stale, 500) as unknown as ReturnType<typeof setTimeout> | null };
        const updateProject = vi.fn();
        const latest = { ...patch, viewport: { x: 80, y: 120, k: 2 } };
        handOffProjectSnapshot('fixture', true, latest, timer, { openProject: () => project, updateProject });
        expect(updateProject).toHaveBeenCalledExactlyOnceWith('fixture', latest);
        expect(timer.current).toBeNull();
        vi.advanceTimersByTime(500);
        expect(stale).not.toHaveBeenCalled();
    });
    it('不把旧项目画布写入刚切换但尚未加载的新项目', () => {
        const updateProject = vi.fn();
        handOffProjectSnapshot('next', false, patch, { current: null }, { openProject: () => project, updateProject });
        expect(updateProject).not.toHaveBeenCalled();
    });
    it('相同快照以及已删除项目不产生额外更新', () => {
        const updateProject = vi.fn();
        handOffProjectSnapshot('fixture', true, patch, { current: null }, { openProject: () => project, updateProject });
        handOffProjectSnapshot('fixture', true, patch, { current: null }, { openProject: () => null, updateProject });
        expect(updateProject).not.toHaveBeenCalled();
    });
});
