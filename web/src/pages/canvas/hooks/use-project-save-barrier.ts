import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useBlocker } from "react-router-dom";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { flushProjectBeforeLeave, handOffProjectSnapshot, projectSnapshotChanged, type EditorPatch, type SaveTimer } from "./project-save";

/** 交出页面的最后快照（含 500ms viewport），路由离开必须等待真实保存。 */
export function useProjectSaveBarrier(projectId: string, ready: boolean, patch: EditorPatch, timer: SaveTimer) {
    const latest = useRef({ projectId, ready, patch });
    useLayoutEffect(() => { latest.current = { projectId, ready, patch }; });
    const handOff = useCallback(() => {
        const value = latest.current;
        if (!value.ready) return;
        handOffProjectSnapshot(value.projectId, value.ready, value.patch, timer, useCanvasStore.getState());
        useCanvasStore.setState({ editorDirty: false });
    }, [timer]);
    const blocker = useBlocker(() => {
        if (!latest.current.ready) return false;
        const store = useCanvasStore.getState();
        return store.persistence.dirty || projectSnapshotChanged(store.openProject(latest.current.projectId), latest.current.patch);
    });
    const [error, setError] = useState<string | null>(null);
    const running = useRef(false);
    const leave = useCallback(async (retry = false) => {
        if (blocker.state !== "blocked" || running.current) return;
        running.current = true;
        setError(null);
        try {
            await flushProjectBeforeLeave({
                handOff,
                dirty: () => useCanvasStore.getState().persistence.dirty,
                flush: () => useCanvasStore.getState().flush(),
                retry: () => useCanvasStore.getState().retrySave(),
            }, retry);
            blocker.proceed();
        } catch (failure) { setError(failure instanceof Error ? failure.message : "项目保存失败，草稿仍保留在当前页面"); }
        finally { running.current = false; }
    }, [blocker, handOff]);
    useEffect(() => { if (blocker.state === "blocked" && !error) void leave(); }, [blocker.state, error, leave]);
    useEffect(() => {
        const beforeUnload = (event: BeforeUnloadEvent) => {
            handOff();
            if (!useCanvasStore.getState().persistence.dirty) return;
            event.preventDefault();
            event.returnValue = "unsaved";
            // 浏览器关闭不能等待 Promise；只尝试立即排队，并保留原生离开警告。
            void useCanvasStore.getState().flush().catch(() => {});
        };
        window.addEventListener("beforeunload", beforeUnload);
        return () => {
            window.removeEventListener("beforeunload", beforeUnload);
            handOff();
            if (useCanvasStore.getState().hydrated) void useCanvasStore.getState().flush().catch(() => {});
        };
    }, [handOff]);
    return { error, retry: () => leave(true), stay: () => { setError(null); if (blocker.state === "blocked") blocker.reset(); } };
}
