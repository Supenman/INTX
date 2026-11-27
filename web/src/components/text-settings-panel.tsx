import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { type CanvasTheme } from "@/lib/canvas-theme";
import type { AiConfig, ReasoningEffort } from "@/stores/use-config-store";

const reasoningEffortOptions: ReasoningEffort[] = ["auto", "low", "medium", "high", "xhigh"];

type TextSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "reasoningEffort", value: ReasoningEffort) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
};

export function TextSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "space-y-3.5" }: TextSettingsPanelProps) {
    const { t } = useTranslation();
    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-base font-semibold">{t("settingsPanels.text.title")}</div> : null}
                <div className="space-y-2">
                    <div className="text-[length:var(--fs-caption)] font-medium" style={{ color: theme.node.muted }}>
                        {t("settingsPanels.text.reasoning")}
                    </div>
                    <div className="grid grid-cols-5 gap-1.5">
                        {reasoningEffortOptions.map((value) => (
                            <OptionPill key={value} selected={config.reasoningEffort === value} theme={theme} onClick={() => onConfigChange("reasoningEffort", value)}>
                                {t(`settingsPanels.common.${value}`)}
                            </OptionPill>
                        ))}
                    </div>
                </div>
            </div>
        </ImageSettingsTheme>
    );
}

export function reasoningEffortLabel(value: ReasoningEffort) {
    return reasoningEffortOptions.includes(value) ? i18n.t(`settingsPanels.common.${value}`) : value;
}

function OptionPill({ selected, theme, onClick, children }: { selected: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            aria-pressed={selected}
            className="focus-ring h-8 cursor-pointer rounded-[var(--r-md)] border px-2 text-[length:var(--fs-caption)] font-medium transition hover:opacity-85"
            style={{ background: selected ? theme.toolbar.activeBg : "transparent", borderColor: selected ? theme.node.activeStroke : theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}
