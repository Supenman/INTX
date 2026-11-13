import type { CanvasProject } from "@/application/persistence/types";
import type { ViewportTransform } from "@/types/canvas";

export type EditorPatch = Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">;
export type SaveTimer = { current: ReturnType<typeof setTimeout> | null };

/** 页面最后快照交给 store；已删除项目不再更新，同一快照不产生新写入。 */
export function handOffProjectSnapshot(
    id: string,
    ready: boolean,
    patch: EditorPatch,
    timer: SaveTimer,
    store: { openProject: (id: string) => CanvasProject | null; updateProject: (id: string, patch: EditorPatch) => void },
) {
    if (!ready) return;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (projectSnapshotChanged(store.openProject(id), patch)) store.updateProject(id, patch);
}

/** 载入同一视图不制造未保存状态；真正拖动/缩放才进入500ms保存链。 */
export function viewportChanged(stored: ViewportTransform | undefined, next: ViewportTransform): boolean {
    return !stored || stored.x !== next.x || stored.y !== next.y || stored.k !== next.k;
}

export function projectSnapshotChanged(project: CanvasProject | null, patch: EditorPatch): boolean {
    return Boolean(project && Object.entries(patch).some(([key, value]) => project[key as keyof EditorPatch] !== value));
}

/** 成功才交出路由；存储失败立即停止，不自动覆盖冲突或丢掉草稿。
 * 等待调用时的快照与保存期间的最后编辑，但不再追逐后续轮询/持续编辑。 */
export async function flushProjectBeforeLeave(input: {
    handOff: () => void;
    dirty: () => boolean;
    flush: () => Promise<void>;
    retry: () => Promise<void>;
}, retry = false) {
    input.handOff();
    await (retry ? input.retry() : input.flush());
    input.handOff();
    if (input.dirty()) await input.flush();
}
