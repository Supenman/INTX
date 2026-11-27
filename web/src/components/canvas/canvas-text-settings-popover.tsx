import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";

import { reasoningEffortLabel, TextSettingsPanel } from "@/components/text-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import type { PopoverPlacement } from "@/lib/canvas/popover-position";
import { useAnchoredPopover } from "@/hooks/use-anchored-popover";
import { useThemeStore } from "@/stores/use-theme-store";
import type { AiConfig, ReasoningEffort } from "@/stores/use-config-store";
import { CanvasSettingsPortalShell, CanvasSettingsTrigger } from "./canvas-settings-popover-shell";

const QUICK_TEXT_COUNTS = [1, 2, 3, 4] as const;

type CanvasTextSettingsPopoverProps = {
    config: AiConfig;
    onConfigChange: (key: "reasoningEffort", value: ReasoningEffort) => void;
    count?: number;
    onCountChange?: (count: number) => void;
    onOpenChange?: (open: boolean) => void;
    buttonClassName?: string;
    placement?: PopoverPlacement;
};

export function CanvasTextSettingsPopover({ config, onConfigChange, count = 1, onCountChange, onOpenChange, buttonClassName, placement = "topLeft" }: CanvasTextSettingsPopoverProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const title = t("settingsPanels.text.title");
    const { buttonRef, panelRef, panelProps, open, setOpen, buttonRect, anchorRect, buttonWidth, panelHeight, layer } = useAnchoredPopover({ onOpenChange, label: title });

    const safeCount = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(count)) || 1)));
    const summary = `${t("canvas.controls.reasoning")} · ${reasoningEffortLabel(config.reasoningEffort)}${onCountChange ? ` · ${t("canvas.controls.generations", { count: safeCount })}` : ""}`;

    return (
        <>
            <CanvasSettingsTrigger
                buttonRef={buttonRef}
                buttonWidth={buttonWidth}
                open={open}
                title={title}
                summary={summary}
                theme={theme}
                buttonClassName={buttonClassName}
                onToggle={() => setOpen(!open)}
            />
            {open ? (
                <CanvasSettingsPortalShell
                    buttonRect={buttonRect}
                    anchorRect={anchorRect}
                    panelHeight={panelHeight}
                    panelRef={panelRef}
                    panelProps={panelProps}
                    placement={placement}
                    layer={layer}
                    theme={theme}
                    title={title}
                    summary={summary}
                    icon={<FileText className="size-3.5" />}
                    onClose={() => setOpen(false)}
                >
                    <TextSettingsPanel config={config} onConfigChange={onConfigChange} theme={theme} showTitle={false} className="space-y-3.5" />
                    {onCountChange ? (
                        <div className="mt-3.5 space-y-2 border-t pt-3" style={{ borderColor: theme.toolbar.border }}>
                            <div className="text-[length:var(--fs-caption)] font-medium" style={{ color: theme.node.muted }}>
                                {t("settingsPanels.text.count")}
                            </div>
                            <div className="grid grid-cols-5 gap-1.5">
                                {QUICK_TEXT_COUNTS.map((value) => {
                                    const selected = safeCount === value;
                                    return (
                                        <button
                                            key={value}
                                            type="button"
                                            aria-pressed={selected}
                                            className="focus-ring h-8 cursor-pointer rounded-[var(--r-md)] border px-2 text-[length:var(--fs-caption)] font-medium transition hover:opacity-85"
                                            style={{
                                                background: selected ? theme.toolbar.activeBg : "transparent",
                                                borderColor: selected ? theme.node.activeStroke : theme.node.stroke,
                                                color: theme.node.text,
                                            }}
                                            onMouseDown={(event) => event.stopPropagation()}
                                            onClick={() => onCountChange(value)}
                                        >
                                            {value}
                                        </button>
                                    );
                                })}
                                <input
                                    type="number"
                                    aria-label={t("settingsPanels.text.count")}
                                    min={1}
                                    max={15}
                                    className="focus-ring h-8 w-full rounded-[var(--r-md)] border bg-transparent px-2 text-center text-[length:var(--fs-caption)] tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                    style={{ borderColor: theme.node.stroke, color: theme.node.text }}
                                    value={safeCount}
                                    onChange={(event) => onCountChange(Math.max(1, Math.min(15, Math.floor(Math.abs(Number(event.target.value)) || 1))))}
                                    onMouseDown={(event) => event.stopPropagation()}
                                />
                            </div>
                        </div>
                    ) : null}
                </CanvasSettingsPortalShell>
            ) : null}
        </>
    );
}
