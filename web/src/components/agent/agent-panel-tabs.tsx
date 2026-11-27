import type { ReactNode } from "react";
import { Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";

export function AgentPanelTabs<T extends string>({
    value,
    items,
    theme,
    leading,
    right,
    onChange,
}: {
    value: T;
    items: { value: T; label: string; icon?: ReactNode; count?: number }[];
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    leading?: ReactNode;
    right?: ReactNode;
    onChange: (value: T) => void;
}) {
    const { t } = useTranslation();
    return (
        <div className="@container shrink-0 border-b px-2.5 py-2" style={{ borderColor: theme.node.stroke, background: theme.toolbar.panel }}>
            <div className="flex h-8 items-center gap-1.5">
                {leading ? <div className="flex shrink-0 items-center gap-0.5">{leading}</div> : null}
                <nav
                    className="flex min-w-0 flex-1 items-center justify-center gap-0.5 rounded-xl p-0.5 text-xs"
                    style={{ background: theme.node.fill }}
                    role="tablist"
                    aria-label={t("agent.panel.content")}
                >
                    {items.map((item) => {
                        const active = value === item.value;
                        return (
                            <Tooltip key={item.value} title={`${item.label}${item.count ? ` ${item.count}` : ""}`} placement="bottom">
                                <button
                                    type="button"
                                    role="tab"
                                    aria-label={`${item.label}${item.count ? ` ${item.count}` : ""}`}
                                    aria-selected={active}
                                    className={`focus-ring inline-flex h-7 min-w-7 flex-1 cursor-pointer items-center justify-center gap-1 rounded-lg px-1.5 transition ${active ? "font-medium shadow-xs" : "font-normal hover:opacity-90"}`}
                                    style={{
                                        background: active ? theme.toolbar.activeBg : "transparent",
                                        color: active ? theme.node.text : theme.node.muted,
                                    }}
                                    onClick={() => onChange(item.value)}
                                >
                                    {item.icon ? <span className="agent-panel-tab-icon shrink-0">{item.icon}</span> : null}
                                    <span className={item.icon ? "hidden truncate @min-[380px]:inline" : "truncate"}>{item.label}</span>
                                    {item.count ? (
                                        <span className="text-[length:var(--fs-label)] font-normal leading-none tabular-nums opacity-65">
                                            {item.count > 99 ? "99+" : item.count}
                                        </span>
                                    ) : null}
                                </button>
                            </Tooltip>
                        );
                    })}
                </nav>
                {right ? <div className="flex shrink-0 items-center gap-0.5">{right}</div> : null}
            </div>
        </div>
    );
}
