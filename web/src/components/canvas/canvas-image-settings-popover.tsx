import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Settings2 } from "lucide-react";
import { Button } from "antd";
import { useTranslation } from "react-i18next";

import { ImageSettingsPanel, imageQualityLabel, imageSizeLabel } from "@/components/image-settings-panel";
import { resolveImageCapabilities } from "@/domain/provider/imageCapabilities";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { resolveModelRequestConfig, resolveModelScript, type AiConfig } from "@/stores/use-config-store";

type CanvasImageSettingsPopoverProps = {
    config: AiConfig;
    onConfigChange: (key: keyof AiConfig, value: string) => void;
    onMissingConfig?: () => void;
    onOpenChange?: (open: boolean) => void;
    buttonClassName?: string;
    getPopupContainer?: (triggerNode: HTMLElement) => HTMLElement;
    placement?: "topLeft" | "top" | "topRight" | "bottomLeft" | "bottom" | "bottomRight";
    autoAdjustOverflow?: boolean;
};

export function CanvasImageSettingsPopover({ config, onConfigChange, onOpenChange, buttonClassName, placement = "topLeft" }: CanvasImageSettingsPopoverProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const buttonRef = useRef<HTMLSpanElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [buttonRect, setButtonRect] = useState<DOMRect | null>(null);
    const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
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
    const updateOpen = (nextOpen: boolean) => {
        setOpen(nextOpen);
        onOpenChange?.(nextOpen);
    };

    useEffect(() => {
        if (!open) return;
        const syncPosition = () => {
            const button = buttonRef.current;
            setButtonRect(button?.getBoundingClientRect() || null);
            // 生成面板是浮层要避开的邻居，不只是按钮。只按按钮算会把浮层放在
            // 面板右侧那一小段空隙里，压住输入框右下角。
            const anchor = button?.closest("[data-canvas-prompt-panel]");
            setAnchorRect(anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : null);
        };
        const closeOnOutsidePointer = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
            if (document.activeElement instanceof HTMLElement && panelRef.current?.contains(document.activeElement)) document.activeElement.blur();
            setOpen(false);
            onOpenChange?.(false);
        };

        syncPosition();
        window.addEventListener("resize", syncPosition);
        window.addEventListener("scroll", syncPosition, true);
        window.addEventListener("pointerdown", closeOnOutsidePointer, true);
        return () => {
            window.removeEventListener("resize", syncPosition);
            window.removeEventListener("scroll", syncPosition, true);
            window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
        };
    }, [onOpenChange, open]);

    // 位置由 Portal 内部按按钮实测矩形算；这里不要求 buttonRect 先就绪，
    // 否则首帧 buttonRect 还是 null，面板要等下一次 setState 才出现。
    const panel = open ? <ImageSettingsPortal buttonRect={buttonRect} anchorRect={anchorRect} panelRef={panelRef} placement={placement} theme={theme} config={config} onConfigChange={onConfigChange} /> : null;

    return (
        <>
            <span ref={buttonRef} className="inline-flex min-w-0">
                <Button size="small" type="text" className={buttonClassName || "!h-[var(--control-h-sm)] !max-w-[180px] !justify-start !rounded-[var(--r-md)] !px-2.5"} style={{ background: theme.toolbar.activeBg, color: theme.node.text }} icon={<Settings2 className="size-3.5" />} onClick={() => updateOpen(!open)}>
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
    placement,
    theme,
    config,
    onConfigChange,
}: {
    /** 首帧可能还没测量到按钮位置；为 null 时先不渲染，等首次 syncPosition 即可。 */
    buttonRect: DOMRect | null;
    /** 触发按钮所属的生成面板，水平避让以它为界，避免压住输入区。 */
    anchorRect: DOMRect | null;
    panelRef: RefObject<HTMLDivElement | null>;
    placement: CanvasImageSettingsPopoverProps["placement"];
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    config: AiConfig;
    onConfigChange: (key: keyof AiConfig, value: string) => void;
}) {
    // 浮层锚在参数按钮上，向上展开。按钮在生成面板底部，上方可用空间比下方多得多；
    // 面板最高占到按钮上方到底部工具栏之间的整段，内容在这段里滚动，不压住生成面板。
    if (!buttonRect) return null;
    const width = Math.min(356, window.innerWidth - 24);
    const gap = 8;
    const margin = 12;
    const dockInset = 88;
    const alignRight = placement?.endsWith("Right");
    const alignCenter = placement === "top" || placement === "bottom";
    // 水平定位：按钮在生成面板里，浮层跟按钮左边缘对齐会向左压住面板本身。
    // 按可用空间依次试「右侧 → 左侧 → 夹在窗口内」，尽量不盖住触发它的那块区域。
    const anchor = anchorRect ?? buttonRect;
    const spaceRight = window.innerWidth - anchor.right - gap - margin;
    const spaceLeft = anchor.left - gap - margin;
    const preferredLeft = alignCenter ? buttonRect.left + buttonRect.width / 2 - width / 2 : alignRight ? buttonRect.right - width : buttonRect.left;
    const left = alignCenter || alignRight
        ? preferredLeft
        : spaceRight >= width
            ? anchor.right + gap
            : spaceLeft >= width
                ? anchor.left - gap - width
                : buttonRect.right - width;
    const topPlacement = placement?.startsWith("top");
    const spaceAbove = buttonRect.top - gap - margin;
    const spaceBelow = window.innerHeight - buttonRect.bottom - gap - dockInset;
    const style = {
        position: "fixed",
        zIndex: 1200,
        width,
        left: Math.max(margin, Math.min(window.innerWidth - width - margin, left)),
        ...(topPlacement ? { bottom: window.innerHeight - buttonRect.top + gap, maxHeight: Math.max(220, spaceAbove) } : { top: buttonRect.bottom + gap, maxHeight: Math.max(220, Math.min(spaceBelow, spaceAbove)) }),
        // 高度不够时先滚动内容，而不是把面板压扁到装不下最后几行。
        background: theme.toolbar.panel,
        borderRadius: 18,
        boxShadow: "0 18px 54px rgba(28, 25, 23, 0.16)",
        padding: 18,
        overflowY: "auto",
        overscrollBehavior: "contain",
        color: theme.node.text,
    } as const;

    return createPortal(
        <div
            ref={panelRef}
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
