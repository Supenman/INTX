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
        <PageShell width="full">
            <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col px-6 py-6">
                <PageHeader title={t("skillCenter.title")} description={t("skillCenter.description")} />
                <AgentSkillManagerView theme={theme} endpoint={endpoint} token={token} connected={connected} fullPage />
            </div>
        </PageShell>
    );
}
