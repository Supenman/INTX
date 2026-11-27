import { AudioLines } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AudioSettingsPanel } from "@/components/audio-settings-panel";
import { audioFormatLabel, audioSpeedLabel, audioVoiceLabel } from "@/lib/audio-generation";
import { canvasThemes } from "@/lib/canvas-theme";
import type { PopoverPlacement } from "@/lib/canvas/popover-position";
import { useAnchoredPopover } from "@/hooks/use-anchored-popover";
import { useThemeStore } from "@/stores/use-theme-store";
import type { AiConfig } from "@/stores/use-config-store";
import { CanvasSettingsPortalShell, CanvasSettingsTrigger } from "./canvas-settings-popover-shell";

export type CanvasAudioSettingKey = "audioVoice" | "audioFormat" | "audioSpeed" | "audioInstructions";

type CanvasAudioSettingsPopoverProps = {
    config: AiConfig;
    onConfigChange: (key: CanvasAudioSettingKey, value: string) => void;
    onOpenChange?: (open: boolean) => void;
    buttonClassName?: string;
    placement?: PopoverPlacement;
};

export function CanvasAudioSettingsPopover({ config, onConfigChange, onOpenChange, buttonClassName, placement = "topLeft" }: CanvasAudioSettingsPopoverProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const title = t("settingsPanels.audio.title");
    const { buttonRef, panelRef, panelProps, open, setOpen, buttonRect, anchorRect, buttonWidth, panelHeight, layer } = useAnchoredPopover({ onOpenChange, label: title });

    const summary = `${audioVoiceLabel(config.audioVoice)} · ${audioFormatLabel(config.audioFormat)} · ${audioSpeedLabel(config.audioSpeed)}`;

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
                    icon={<AudioLines className="size-3.5" />}
                    onClose={() => setOpen(false)}
                >
                    <AudioSettingsPanel config={config} onConfigChange={(key, value) => onConfigChange(key, value)} theme={theme} showTitle={false} className="space-y-3.5" />
                </CanvasSettingsPortalShell>
            ) : null}
        </>
    );
}
