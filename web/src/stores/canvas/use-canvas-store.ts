import { create } from "zustand";
import { nanoid } from "nanoid";
import i18n from "@/i18n";
import type { CanvasProject, CanvasDeletedProject } from "@/application/persistence/types";
import type { ProjectRepository, ProjectSnapshot } from "@/application/ports/snapshotRepositories";
import { SnapshotPersistenceError } from "@/application/persistence/error";
import { createIndexedDBProjectRepository } from "@/infrastructure/storage/indexeddb-snapshot-repositories";
import { createProjectWriteQueue } from "@/infrastructure/storage/write-queue";

export type { CanvasProject, CanvasDeletedProject } from "@/application/persistence/types";

type CanvasStore = ProjectSnapshot & {
    hydrated: boolean;
    editorDirty: boolean;
    loadError: string | null;
    persistence: ReturnType<ReturnType<typeof createProjectWriteQueue>["getState"]>;
    load: () => Promise<void>;
    flush: () => Promise<void>;
    retrySave: () => Promise<void>;
    confirmSave: () => Promise<void>;
    createProject: (title?: string) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    replaceProjects: (projects: CanvasProject[], deletedProjects?: CanvasDeletedProject[]) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => void;
};

/** 同步动作只更新编辑草稿；flush/retrySave 成功才代表事务提交。 */
export function createCanvasStore(repository: ProjectRepository) {
    const queue = createProjectWriteQueue(repository);
    let loading: Promise<void> | null = null;
    const ensureReady = () => {
        if (!store.getState().hydrated) throw new SnapshotPersistenceError({ code: "unavailable", message: "项目尚未成功加载，已阻止修改原数据" });
    };
    const save = async (retry = false) => {
        ensureReady();
        const result = await (retry ? queue.retry() : queue.flush());
        if (!result.ok) throw new SnapshotPersistenceError(result.error);
    };
    const store = create<CanvasStore>()((set, get) => ({
        hydrated: false, editorDirty: false, loadError: null, projects: [], deletedProjects: [], persistence: queue.getState(),
        load: () => {
            if (get().hydrated) return Promise.resolve();
            if (loading) return loading;
            set({ loadError: null });
            loading = (async () => {
                const result = await queue.load();
                if (!result.ok) throw new SnapshotPersistenceError(result.error);
                set({ ...result.value.value, hydrated: true });
            })().catch((error: unknown) => {
                set({ loadError: error instanceof Error ? error.message : "项目读取失败" });
                throw error;
            }).finally(() => { loading = null; });
            return loading;
        },
        flush: () => save(), retrySave: () => save(true),
        // 业务确认边界：已有失败时明确补写，否则等待当前草稿提交；冲突仍不会被覆盖。
        confirmSave: () => save(Boolean(queue.getState().error)),
        createProject: (title = i18n.t("canvas.project.untitled")) => {
            ensureReady();
            const now = new Date().toISOString();
            const id = nanoid();
            const project: CanvasProject = {
                id, title, createdAt: now, updatedAt: now, nodes: [], connections: [], chatSessions: [], activeChatId: null,
                backgroundMode: "lines", showImageInfo: false, viewport: { x: 0, y: 0, k: 1 },
            };
            set((state) => ({ projects: [project, ...state.projects] }));
            return id;
        },
        importProject: (source) => {
            ensureReady();
            const now = new Date().toISOString();
            const project: CanvasProject = {
                id: nanoid(), title: source.title || i18n.t("canvas.project.imported"), createdAt: source.createdAt || now, updatedAt: now,
                nodes: source.nodes || [], connections: source.connections || [], chatSessions: source.chatSessions || [], activeChatId: source.activeChatId || null,
                backgroundMode: source.backgroundMode || "lines", showImageInfo: source.showImageInfo || false, viewport: source.viewport || { x: 0, y: 0, k: 1 },
            };
            set((state) => ({ projects: [project, ...state.projects] }));
            return project.id;
        },
        openProject: (id) => get().projects.find((item) => item.id === id) || null,
        renameProject: (id, title) => {
            ensureReady();
            set((state) => ({ projects: state.projects.map((project) => project.id === id ? { ...project, title: title.trim() || project.title, updatedAt: new Date().toISOString() } : project) }));
        },
        deleteProjects: (ids) => {
            ensureReady();
            set((state) => {
                const now = new Date().toISOString();
                const removing = new Set(ids);
                return {
                    projects: state.projects.filter((project) => !removing.has(project.id)),
                    deletedProjects: [...state.deletedProjects.filter((item) => !removing.has(item.id)), ...ids.map((id) => ({ id, deletedAt: now }))],
                };
            });
        },
        replaceProjects: (projects, deletedProjects = []) => { ensureReady(); set({ projects, deletedProjects }); },
        updateProject: (id, patch) => {
            ensureReady();
            set((state) => ({ projects: state.projects.map((project) => project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project) }));
        },
    }));
    queue.subscribe((persistence) => store.setState({ persistence }));
    store.subscribe((state, previous) => {
        // 加载/保存状态变化不进入写队列，不双写旧 persist；首次读取也不改写。
        if (!previous.hydrated || (state.projects === previous.projects && state.deletedProjects === previous.deletedProjects)) return;
        // 队列记录非法/未保存状态并显示；不在 Zustand 订阅里抛错打断画布渲染。
        queue.enqueue({ projects: state.projects, deletedProjects: state.deletedProjects });
    });
    return store;
}

export const useCanvasStore = createCanvasStore(createIndexedDBProjectRepository());
void useCanvasStore.getState().load().catch(() => { /* 读取错误留在 store，由 UI 显示和重试。 */ });
