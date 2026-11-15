import { create } from "zustand";

import type { AgentSkillDraft, AgentSkillSummary } from "@/services/api/canvas-agent";
import { useAgentStore } from "@/stores/use-agent-store";

/**
 * Skill 后端路由随 Codex 车道一起移除后，这里只保留输入框 `/` 提及所需的形状：
 * 列表恒为空、不发任何网络请求，避免打到已下线的 /agent/codex/skills。
 * 后续在 opencode 车道重接 Skill 时，替换 loadSkills 的实现即可，输入框无需改动。
 */
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
    loaded: true,
    errors: [],
    loadSkills: async () => set({ skills: [], selectedSkill: null, autoPrompt: "", loading: false, loaded: true, errors: [] }),
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
    reset: () => set((current) => ({ skills: [], selectedSkill: null, selectionRevision: current.selectionRevision + 1, connectionRevision: current.connectionRevision + 1, autoPrompt: "", draft: null, generatingSource: null, loading: false, loaded: true, errors: [] })),
}));
