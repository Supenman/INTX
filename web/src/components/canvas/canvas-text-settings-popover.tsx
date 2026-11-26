import { type RefObject } from "react";
import { createPortal } from "react-dom";
import { Settings2 } from "lucide-react";
import { Button, InputNumber } from "antd";
import { useTranslation } from "react-i18next";

import { reasoningEffortLabel, TextSettingsPanel } from "@/components/text-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { resolvePopoverPosition, type PopoverPlacement } from "@/lib/canvas/popover-position";
import { useAnchoredPopover, type AnchoredPopover } from "@/hooks/use-anchored-popover";
import { useThemeStore } from "@/stores/use-theme-store";
import type { AiConfig, ReasoningEffort } from "@/stores/use-config-store";

type CanvasTextSettingsPopoverProps = {
    config: AiConfig;
    onConfigChange: (key: "reasoningEffort", value: ReasoningEffort) => void;
    count?: number;
    onCountChange?: (count: number) => void;
    onOpenChange?: (open: boolean) => void;
    buttonClassName?: string;
    placement?: PopoverPlacement;
};

export function CanvasTextSettingsPopover({ config, onConfigChange, count, onCountChange, onOpenChange, buttonClassName, placement = "topLeft" }: CanvasTextSettingsPopoverProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { buttonRef, panelRef, panelProps, open, setOpen, buttonRect, anchorRect, buttonWidth, panelHeight, layer } = useAnchoredPopover({ onOpenChange, label: t("settingsPanels.text.title") });

    // 同 image/audio/video：只按 open 渲染，定位在 Portal 内部处理。
    const summary = `${t("canvas.controls.reasoning")} · ${reasoningEffortLabel(config.reasoningEffort)}${onCountChange ? ` · ${t("canvas.controls.generations", { count })}` : ""}`;
    const panel = open ? <TextSettingsPortal buttonRect={buttonRect} anchorRect={anchorRect} panelHeight={panelHeight} panelRef={panelRef} panelProps={panelProps} placement={placement} layer={layer} theme={theme} config={config} count={count} onConfigChange={onConfigChange} onCountChange={onCountChange} /> : null;

    return (
        <>
            <span ref={buttonRef} className="inline-flex min-w-0" style={buttonWidth === null ? undefined : { width: buttonWidth }}>
                <Button size="small" type="text" aria-expanded={open} aria-label={`${t("settingsPanels.text.title")}: ${summary}`} title={`${t("settingsPanels.text.title")} · ${summary}`} className={buttonClassName || "!h-[var(--control-h-sm)] !max-w-[180px] !justify-start !rounded-full !px-2.5"} style={{ background: open ? theme.toolbar.activeBg : theme.toolbar.itemHover, color: theme.node.text, width: buttonWidth === null ? undefined : "100%" }} icon={<Settings2 className="size-3.5" />} onClick={() => setOpen(!open)}>
                    <span className="truncate">{summary}</span>
                </Button>
            </span>
            {panel}
        </>
    );
}

function TextSettingsPortal({ buttonRect, anchorRect, panelHeight, panelRef, panelProps, placement, layer, theme, config, count, onConfigChange, onCountChange }: {
    /** 首帧可能还没测量到按钮位置；为 null 时先不渲染，等首次测量即可。 */
    buttonRect: DOMRect | null;
    /** 触发按钮所属的生成面板，水平避让以它为界。 */
    anchorRect: DOMRect | null;
    /** 浮层上一次实测高度，用来判断向上还是向下展开。 */
    panelHeight: number | null;
    panelRef: RefObject<HTMLDivElement | null>;
    panelProps: AnchoredPopover["panelProps"];
    placement: PopoverPlacement;
    layer: number;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    config: AiConfig;
    count?: number;
    onConfigChange: CanvasTextSettingsPopoverProps["onConfigChange"];
    onCountChange?: (count: number) => void;
}) {
    const { t } = useTranslation();
    if (!buttonRect) return null;
    const position = resolvePopoverPosition({ buttonRect, anchorRect, placement, panelHeight, viewport: { width: window.innerWidth, height: window.innerHeight } });
    const style = {
        position: "fixed",
        zIndex: layer,
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
            <TextSettingsPanel config={config} onConfigChange={onConfigChange} theme={theme} />
            {onCountChange ? (
                <div className="mt-4 space-y-2.5">
                    <div className="text-sm font-medium" style={{ color: theme.node.muted }}>{t("settingsPanels.text.count")}</div>
                    <InputNumber className="w-full" aria-label={t("settingsPanels.text.count")} min={1} max={15} precision={0} value={count} onChange={(value) => onCountChange(value || 1)} />
                </div>
            ) : null}
        </div>,
        document.body,
    );
}
