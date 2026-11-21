import { create } from "zustand";

import { fetchOpencodeSkills, type AgentSkillDraft, type AgentSkillSummary } from "@/services/api/canvas-agent";
import { useAgentStore } from "@/stores/use-agent-store";

/** Skill 列表来自本地 Agent 读取的站点工作空间 `.agents/skills`，只服务输入框 `/` 提及。 */
type AgentSkillStore = {
    skills: AgentSkillSummary[];
    selectedSkill: AgentSkillSummary | null;
    selectionRevision: number;
    connectionRevision: number;
    autoPrompt: string;
    draft: AgentSkillDraft | null;
    generatingSource: "conversation" | "canvas" | null;
    loading: boolean;
    loaded: boolean;
    errors: string[];
    loadSkills: (endpoint: string, token: string, forceReload?: boolean) => Promise<void>;
    selectSkill: (skill: AgentSkillSummary | null, prompt?: string) => void;
    clearSelection: (expectedRevision?: number) => void;
    setDraft: (draft: AgentSkillDraft | null) => void;
    setGeneratingSource: (source: "conversation" | "canvas" | null) => void;
    reset: () => void;
};

export const useAgentSkillStore = create<AgentSkillStore>((set, get) => ({
    skills: [],
    selectedSkill: null,
    selectionRevision: 0,
    connectionRevision: 0,
    autoPrompt: "",
    draft: null,
    generatingSource: null,
    loading: false,
    loaded: false,
    errors: [],
    loadSkills: async (endpoint, token, forceReload = false) => {
        if (get().loading || (get().loaded && !forceReload)) return;
        set({ loading: true });
        try {
            const data = await fetchOpencodeSkills(endpoint, token);
            const skills = Array.isArray(data.data) ? data.data : [];
            const selected = get().selectedSkill;
            set({
                skills,
                loading: false,
                loaded: true,
                errors: (data.errors || []).map((error) => String(error)),
                ...(selected && !skills.some((skill) => skill.name === selected.name) ? { selectedSkill: null, autoPrompt: "" } : {}),
            });
        } catch (error) {
            // 读取失败保持未加载，下次输入 `/` 再试；不把失败当成「没有 Skill」。
            set({ loading: false, errors: [error instanceof Error ? error.message : String(error)] });
        }
    },
    selectSkill: (selectedSkill, prompt) => {
        const current = get();
        const agent = useAgentStore.getState();
        const marker = selectedSkill ? `$${selectedSkill.name}` : "";
        const previousMarker = current.selectedSkill ? `$${current.selectedSkill.name}` : "";
        let nextPrompt = prompt;
        if (nextPrompt === undefined && selectedSkill) {
            const defaultPrompt = selectedSkill.interface?.defaultPrompt?.trim() || marker;
            nextPrompt = previousMarker && agent.prompt.includes(previousMarker)
                ? agent.prompt.replace(previousMarker, marker)
                : defaultPrompt;
        }
        if (nextPrompt !== undefined && agent.prompt !== nextPrompt) agent.setAgentState({ prompt: nextPrompt });
        set({ selectedSkill, autoPrompt: "", selectionRevision: current.selectionRevision + 1 });
    },
    clearSelection: (expectedRevision) => {
        const current = get();
        if (expectedRevision !== undefined && expectedRevision !== current.selectionRevision) return;
        set({ selectedSkill: null, autoPrompt: "", selectionRevision: current.selectionRevision + 1 });
    },
    setDraft: (draft) => set({ draft }),
    setGeneratingSource: (generatingSource) => set({ generatingSource }),
    reset: () => set((current) => ({ skills: [], selectedSkill: null, selectionRevision: current.selectionRevision + 1, connectionRevision: current.connectionRevision + 1, autoPrompt: "", draft: null, generatingSource: null, loading: false, loaded: false, errors: [] })),
}));
