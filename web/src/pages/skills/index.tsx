import { useAgentStore } from "@/stores/use-agent-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { PageHeader, PageShell } from "@/components/layout/page-header";
import { AgentSkillManagerView } from "@/components/agent/agent-skill-manager-view";
import { useTranslation } from "react-i18next";

export default function SkillsPage() {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const connected = useAgentStore((state) => state.connected);
    const endpoint = useAgentStore((state) => state.url.trim().replace(/\/$/, ""));
    const token = useAgentStore((state) => state.token);
    return (
        <PageShell wide>
            <main className="flex min-h-0 flex-1 flex-col">
                <PageHeader title={t("agent.skillCenter.title")} description={t("agent.skillCenter.description")} />
                <AgentSkillManagerView theme={theme} endpoint={endpoint} token={token} connected={connected} fullPage />
            </main>
        </PageShell>
    );
}
