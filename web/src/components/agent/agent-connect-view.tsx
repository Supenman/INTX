import { App, Button, Input, Tooltip } from "antd";
import copyToClipboard from "copy-to-clipboard";
import { Copy, KeyRound, Link2, PlugZap } from "lucide-react";
import { useTranslation } from "react-i18next";

import { isDesktopApp } from "@/lib/agent/agent-client";
import { canvasThemes } from "@/lib/canvas-theme";

/** 桌面版自己读取本地 Agent 配置；浏览器里读不到文件，只能手动填地址和 token。 */
export function AgentConnectView({
    theme,
    url,
    token,
    enabled,
    connected,
    activity,
    connectError,
    onUrlChange,
    onTokenChange,
    onToggleEnabled,
}: {
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    url: string;
    token: string;
    enabled: boolean;
    connected: boolean;
    activity: string;
    connectError: string;
    onUrlChange: (value: string) => void;
    onTokenChange: (value: string) => void;
    onToggleEnabled: () => void;
}) {
    const { t } = useTranslation();
    const desktop = isDesktopApp();
    const { message } = App.useApp();
    const command = "npx -y @supenman/canvas-agent@latest";
    const statusText = connectError ? t("agent.status.failed") : connected ? activity : enabled ? t("agent.status.connecting") : t("agent.status.disconnected");
    const statusColor = connectError ? "#dc2626" : connected ? "#16a34a" : enabled ? "#d97706" : theme.node.muted;
    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
            <div className="space-y-4">
                <div>
                    <div className="text-base font-semibold leading-6">{t("agent.connect.title")}</div>
                    <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                        {desktop ? t("agent.connect.description") : t("agent.connect.browserDescription")}
                    </div>
                </div>
                <div className="rounded-lg border p-3" style={{ borderColor: theme.node.stroke }}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs leading-4" style={{ borderColor: connected || enabled || connectError ? statusColor : theme.node.stroke, color: statusColor }}>
                            <span className="size-1.5 shrink-0 rounded-full" style={{ background: statusColor }} />
                            <span className="truncate">{statusText}</span>
                        </span>
                        <Button className="!h-8 !px-3" type={enabled ? "default" : "primary"} icon={<PlugZap className="size-4" />} onClick={onToggleEnabled}>
                            {t(enabled ? "agent.connect.disconnect" : "agent.connect.connect")}
                        </Button>
                    </div>
                    <div className="mt-2 text-xs leading-5" style={{ color: theme.node.muted }}>
                        {t("agent.connect.hint")}
                    </div>
                    {desktop ? null : (
                        <div className="mt-3 grid gap-2.5">
                            <label className="grid gap-1.5">
                                <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: theme.node.muted }}>
                                    <Link2 className="size-3.5" />
                                    {t("agent.connect.localAddress")}
                                </span>
                                <Input size="large" value={url} onChange={(event) => onUrlChange(event.target.value)} placeholder={t("agent.connect.urlPlaceholder")} />
                            </label>
                            <label className="grid gap-1.5">
                                <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: theme.node.muted }}>
                                    <KeyRound className="size-3.5" />
                                    {t("agent.connect.token")}
                                </span>
                                <Input.Password size="large" value={token} onChange={(event) => onTokenChange(event.target.value)} placeholder={t("agent.connect.tokenPlaceholder")} />
                            </label>
                        </div>
                    )}
                    {connectError ? (
                        <div className="mt-2 rounded-md border px-2.5 py-2 text-xs leading-5" style={{ borderColor: "rgba(220,38,38,.35)", color: "#dc2626" }}>
                            {connectError}
                        </div>
                    ) : null}
                </div>
                <div className="rounded-lg px-3 py-2.5">
                    <div className="text-sm font-medium leading-5">{t(desktop ? "agent.connect.title" : "agent.connect.directTitle")}</div>
                    {desktop ? <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>{t("agent.connect.embeddedAgentText")}</div> : (
                        <>
                            <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>{t("agent.connect.opencodeText")}</div>
                            <div className="mt-2 flex items-center gap-2 rounded-md border bg-transparent px-2 py-1.5" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
                                <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-xs leading-5">{command}</code>
                                <Tooltip title={t("agent.connect.copyCommand")}>
                                    <Button
                                        size="small"
                                        type="text"
                                        className="!h-6 !w-6 !min-w-6"
                                        icon={<Copy className="size-3.5" />}
                                        onClick={() => {
                                            copyToClipboard(command);
                                            message.success(t("agent.connect.commandCopied"));
                                        }}
                                    />
                                </Tooltip>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
