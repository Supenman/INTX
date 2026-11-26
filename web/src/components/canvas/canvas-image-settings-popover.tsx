import { type RefObject } from "react";
import { createPortal } from "react-dom";
import { Settings2 } from "lucide-react";
import { Button } from "antd";
import { useTranslation } from "react-i18next";

import { ImageSettingsPanel, imageQualityLabel, imageSizeLabel } from "@/components/image-settings-panel";
import { resolveImageCapabilities } from "@/domain/provider/imageCapabilities";
import { canvasThemes } from "@/lib/canvas-theme";
import { resolvePopoverPosition, type PopoverPlacement } from "@/lib/canvas/popover-position";
import { useAnchoredPopover, type AnchoredPopover } from "@/hooks/use-anchored-popover";
import { useThemeStore } from "@/stores/use-theme-store";
import { resolveModelRequestConfig, resolveModelScript, type AiConfig } from "@/stores/use-config-store";

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
    const { buttonRef, panelRef, panelProps, open, setOpen, buttonRect, anchorRect } = useAnchoredPopover({ onOpenChange, label: t("settingsPanels.image.title") });
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

    // 位置由 Portal 内部按按钮实测矩形算；这里不要求 buttonRect 先就绪，
    // 否则首帧 buttonRect 还是 null，面板要等下一次 setState 才出现。
    const panel = open ? <ImageSettingsPortal buttonRect={buttonRect} anchorRect={anchorRect} panelRef={panelRef} panelProps={panelProps} placement={placement} theme={theme} config={config} onConfigChange={onConfigChange} /> : null;

    return (
        <>
            <span ref={buttonRef} className="inline-flex min-w-0">
                <Button size="small" type="text" aria-expanded={open} aria-label={`${t("settingsPanels.image.title")}: ${summary}`} title={`${t("settingsPanels.image.title")} · ${summary}`} className={buttonClassName || "!h-[var(--control-h-sm)] !max-w-[180px] !justify-start !rounded-[var(--r-md)] !px-2.5"} style={{ background: open ? theme.toolbar.activeBg : "transparent", color: theme.node.text }} icon={<Settings2 className="size-3.5" />} onClick={() => setOpen(!open)}>
                    <span className="truncate">{summary}</span>
                </Button>
            </span>
            {panel}
        </>
    );
}

function ImageSettingsPortal({
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
    /** 触发按钮所属的生成面板，水平避让以它为界，避免压住输入区。 */
    anchorRect: DOMRect | null;
    panelRef: RefObject<HTMLDivElement | null>;
    panelProps: AnchoredPopover["panelProps"];
    placement: PopoverPlacement;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    config: AiConfig;
    onConfigChange: (key: keyof AiConfig, value: string) => void;
}) {
    // 浮层锚在参数按钮上，向上展开。按钮在生成面板底部，上方可用空间比下方多得多；
    // 面板最高占到按钮上方到底部工具栏之间的整段，内容在这段里滚动，不压住生成面板。
    if (!buttonRect) return null;
    const position = resolvePopoverPosition({ buttonRect, anchorRect, placement, viewport: { width: window.innerWidth, height: window.innerHeight } });
    const style = {
        position: "fixed",
        zIndex: 1200,
        ...position,
        background: theme.toolbar.panel,
        borderRadius: "var(--r-xl)",
        // 暗色下用前景色 hairline 交代边界；写死深色阴影在暗色主题里等于没有边界。
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
            <ImageSettingsPanel config={config} onConfigChange={(key, value) => onConfigChange(key, value)} theme={theme} className="space-y-4" />
        </div>,
        document.body,
    );
}
