import { Dropdown, Tooltip } from "antd";
import { Bot, ChevronDown, Cpu, Terminal } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useAgentStore, type AgentKind } from "@/stores/use-agent-store";

const AGENT_KINDS: AgentKind[] = ["opencode", "codex"];

/** 侧边栏本地 Agent 车道切换：opencode 免 Key 免费模型，Codex 需本机登录。 */
export function AgentKindSwitch() {
    const { t } = useTranslation();
    const agentKind = useAgentStore((state) => state.agentKind);
    const setAgentKind = useAgentStore((state) => state.setAgentKind);
    const label = t(`agent.kind.${agentKind}`);
    return (
        <Tooltip title={t("agent.kind.switch", { kind: label })} placement="bottom">
            <Dropdown
                trigger={["click"]}
                menu={{
                    items: AGENT_KINDS.map((kind) => ({ key: kind, icon: kind === "opencode" ? <Terminal className="size-3.5" /> : <Bot className="size-3.5" />, label: t(`agent.kind.${kind}`) })),
                    selectable: true,
                    selectedKeys: [agentKind],
                    onClick: ({ key }) => setAgentKind(key as AgentKind),
                }}
            >
                <button
                    type="button"
                    className="inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md px-1.5 text-xs transition hover:bg-black/5 dark:hover:bg-white/10"
                    aria-label={t("agent.kind.switch", { kind: label })}
                >
                    <Cpu className="size-3.5 opacity-70" />
                    <span className="hidden @min-[560px]:inline">{label}</span>
                    <ChevronDown className="size-3 opacity-50" />
                </button>
            </Dropdown>
        </Tooltip>
    );
}
