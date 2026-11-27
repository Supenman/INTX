import { Image as ImageIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ImageSettingsPanel, imageQualityLabel, imageSizeLabel } from "@/components/image-settings-panel";
import { resolveImageCapabilities } from "@/domain/provider/imageCapabilities";
import { canvasThemes } from "@/lib/canvas-theme";
import type { PopoverPlacement } from "@/lib/canvas/popover-position";
import { useAnchoredPopover } from "@/hooks/use-anchored-popover";
import { useThemeStore } from "@/stores/use-theme-store";
import { resolveModelRequestConfig, resolveModelScript, type AiConfig } from "@/stores/use-config-store";
import { CanvasSettingsPortalShell, CanvasSettingsTrigger } from "./canvas-settings-popover-shell";

type CanvasImageSettingsPopoverProps = {
    config: AiConfig;
    onConfigChange: (key: keyof AiConfig, value: string) => void;
    onMissingConfig?: () => void;
    onOpenChange?: (open: boolean) => void;
    buttonClassName?: string;
    getPopupContainer?: (triggerNode: HTMLElement) => HTMLElement;
    placement?: PopoverPlacement;
    autoAdjustOverflow?: boolean;
};

export function CanvasImageSettingsPopover({ config, onConfigChange, onOpenChange, buttonClassName, placement = "topLeft" }: CanvasImageSettingsPopoverProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const title = t("settingsPanels.image.title");
    const { buttonRef, panelRef, panelProps, open, setOpen, buttonRect, anchorRect, buttonWidth, panelHeight, layer } = useAnchoredPopover({ onOpenChange, label: title });
    const quality = config.quality || "auto";
    const count = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    const activeSize = config.size || "auto";
    // 折叠态摘要也只说渠道真会发的参数，别让用户以为质量/尺寸生效了。
    const requestConfig = resolveModelRequestConfig(config, config.model || config.imageModel);
    const capabilities = resolveImageCapabilities({
        apiFormat: requestConfig.apiFormat,
        baseUrl: requestConfig.baseUrl,
        hasScript: Boolean(resolveModelScript(config, config.model || config.imageModel)),
    });
    const summary = [capabilities.quality === "supported" ? imageQualityLabel(quality) : "", capabilities.size === "supported" ? imageSizeLabel(activeSize) : "", t("canvas.controls.images", { count })].filter(Boolean).join(" · ");

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
                    icon={<ImageIcon className="size-3.5" />}
                    onClose={() => setOpen(false)}
                >
                    <ImageSettingsPanel config={config} onConfigChange={(key, value) => onConfigChange(key, value)} theme={theme} showTitle={false} className="space-y-3.5" />
                </CanvasSettingsPortalShell>
            ) : null}
        </>
    );
}
