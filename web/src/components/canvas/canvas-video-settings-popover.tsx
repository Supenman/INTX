import { Film } from "lucide-react";
import { useTranslation } from "react-i18next";

import { VideoSettingsPanel, videoModeLabel, videoResolutionLabel, videoSecondsLabel, videoSizeLabel } from "@/components/video-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import type { PopoverPlacement } from "@/lib/canvas/popover-position";
import { useAnchoredPopover } from "@/hooks/use-anchored-popover";
import { useThemeStore } from "@/stores/use-theme-store";
import type { AiConfig } from "@/stores/use-config-store";
import { CanvasSettingsPortalShell, CanvasSettingsTrigger } from "./canvas-settings-popover-shell";

type CanvasVideoSettingsPopoverProps = {
    config: AiConfig;
    onConfigChange: (key: keyof AiConfig, value: string) => void;
    onOpenChange?: (open: boolean) => void;
    buttonClassName?: string;
    placement?: PopoverPlacement;
};

export function CanvasVideoSettingsPopover({ config, onConfigChange, onOpenChange, buttonClassName, placement = "topLeft" }: CanvasVideoSettingsPopoverProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const title = t("settingsPanels.video.title");
    const { buttonRef, panelRef, panelProps, open, setOpen, buttonRect, anchorRect, buttonWidth, panelHeight, layer } = useAnchoredPopover({ onOpenChange, label: title });

    const summary = `${videoResolutionLabel(config.vquality)} · ${videoSizeLabel(config.size)} · ${videoSecondsLabel(config.videoSeconds)} · ${videoModeLabel(config.videoMode)}`;

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
                    icon={<Film className="size-3.5" />}
                    onClose={() => setOpen(false)}
                >
                    <VideoSettingsPanel config={config} onConfigChange={(key, value) => onConfigChange(key, value)} theme={theme} showTitle={false} className="space-y-3.5" />
                </CanvasSettingsPortalShell>
            ) : null}
        </>
    );
}
