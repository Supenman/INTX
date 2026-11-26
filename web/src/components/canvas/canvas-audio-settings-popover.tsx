import { type RefObject } from "react";
import { createPortal } from "react-dom";
import { Settings2 } from "lucide-react";
import { Button } from "antd";
import { useTranslation } from "react-i18next";

import { AudioSettingsPanel } from "@/components/audio-settings-panel";
import { audioFormatLabel, audioSpeedLabel, audioVoiceLabel } from "@/lib/audio-generation";
import { canvasThemes } from "@/lib/canvas-theme";
import { resolvePopoverPosition, type PopoverPlacement } from "@/lib/canvas/popover-position";
import { useAnchoredPopover, type AnchoredPopover } from "@/hooks/use-anchored-popover";
import { useThemeStore } from "@/stores/use-theme-store";
import type { AiConfig } from "@/stores/use-config-store";

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
    const { buttonRef, panelRef, panelProps, open, setOpen, buttonRect, anchorRect } = useAnchoredPopover({ onOpenChange, label: t("settingsPanels.audio.title") });

    // 位置由 Portal 内部按按钮实测矩形算；这里不要求 buttonRect 先就绪，
    // 否则首帧 buttonRect 还是 null，面板要等下一次 setState 才出现。
    const summary = `${audioVoiceLabel(config.audioVoice)} · ${audioFormatLabel(config.audioFormat)} · ${audioSpeedLabel(config.audioSpeed)}`;
    const panel = open ? <AudioSettingsPortal buttonRect={buttonRect} anchorRect={anchorRect} panelRef={panelRef} panelProps={panelProps} placement={placement} theme={theme} config={config} onConfigChange={onConfigChange} /> : null;

    return (
        <>
            <span ref={buttonRef} className="inline-flex min-w-0">
                <Button size="small" type="text" aria-expanded={open} aria-label={`${t("settingsPanels.audio.title")}: ${summary}`} title={`${t("settingsPanels.audio.title")} · ${summary}`} className={buttonClassName || "!h-[var(--control-h-sm)] !max-w-[180px] !justify-start !rounded-[var(--r-md)] !px-2.5"} style={{ background: open ? theme.toolbar.activeBg : "transparent", color: theme.node.text }} icon={<Settings2 className="size-3.5" />} onClick={() => setOpen(!open)}>
                    <span className="truncate">{summary}</span>
                </Button>
            </span>
            {panel}
        </>
    );
}

function AudioSettingsPortal({
    buttonRect,
    anchorRect,
    panelRef,
    panelProps,
    placement,
    theme,
    config,
    onConfigChange,
}: {
    /** 首帧可能还没测量到按钮位置；为 null 时先不渲染，等首次测量即可。 */
    buttonRect: DOMRect | null;
    /** 触发按钮所属的生成面板，水平避让以它为界。 */
    anchorRect: DOMRect | null;
    panelRef: RefObject<HTMLDivElement | null>;
    panelProps: AnchoredPopover["panelProps"];
    placement: PopoverPlacement;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    config: AiConfig;
    onConfigChange: (key: CanvasAudioSettingKey, value: string) => void;
}) {
    if (!buttonRect) return null;
    const position = resolvePopoverPosition({ buttonRect, anchorRect, placement, viewport: { width: window.innerWidth, height: window.innerHeight } });
    const style = {
        position: "fixed",
        zIndex: 1200,
        ...position,
        background: theme.toolbar.panel,
        borderRadius: "var(--r-xl)",
        boxShadow: "var(--shadow-lg), var(--hairline)",
        padding: "var(--space-4)",
        overflowY: "auto",
        overscrollBehavior: "contain",
        color: theme.node.text,
    } as const;

    return createPortal(
        <div
            ref={panelRef}
            {...panelProps}
            className="canvas-image-settings-popover"
            data-node-settings-panel
            style={style}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
        >
            <AudioSettingsPanel config={config} onConfigChange={(key, value) => onConfigChange(key, value)} theme={theme} className="space-y-4" />
        </div>,
        document.body,
    );
}
