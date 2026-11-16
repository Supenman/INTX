import { create } from "zustand";

// Agent 生成任务追踪。旧版把命令派发给生图/视频工作台页面执行；
// 工作台下线后，生成直接落画布（见 lib/agent/agent-canvas-generation.ts），
// 这里只保留「追踪最近 30 条生成」供 generation_get_status 查询。

export type WorkbenchGenerationTask = {
    id: string;
    kind: "image" | "video";
    status: "queued" | "running" | "succeeded" | "failed";
    prompt?: string;
    createdAt: string;
    updatedAt: string;
    successCount?: number;
    failCount?: number;
    error?: string;
    projectId?: string;
    nodeId?: string;
};

type WorkbenchAgentStore = {
    tasks: WorkbenchGenerationTask[];
    /** 登记一条新的 Agent 生成，返回追踪 id。 */
    track: (kind: "image" | "video", prompt?: string) => string;
    updateTask: (id: string, patch: Partial<Pick<WorkbenchGenerationTask, "status" | "successCount" | "failCount" | "error" | "projectId" | "nodeId">>) => void;
};

let counter = 0;

export const useWorkbenchAgentStore = create<WorkbenchAgentStore>((set) => ({
    tasks: [],
    track: (kind, prompt) => {
        counter += 1;
        const now = new Date().toISOString();
        const id = `${kind}-${counter}`;
        const task: WorkbenchGenerationTask = { id, kind, status: "queued", prompt, createdAt: now, updatedAt: now };
        set((state) => ({ tasks: [task, ...state.tasks].slice(0, 30) }));
        return id;
    },
    updateTask: (id, patch) => set((state) => ({ tasks: state.tasks.map((task) => (task.id === id ? { ...task, ...patch, updatedAt: new Date().toISOString() } : task)) })),
}));
