import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Settings2 } from "lucide-react";
import { Button } from "antd";

import { AudioSettingsPanel } from "@/components/audio-settings-panel";
import { audioFormatLabel, audioSpeedLabel, audioVoiceLabel } from "@/lib/audio-generation";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { AiConfig } from "@/stores/use-config-store";

export type CanvasAudioSettingKey = "audioVoice" | "audioFormat" | "audioSpeed" | "audioInstructions";

type CanvasAudioSettingsPopoverProps = {
    config: AiConfig;
    onConfigChange: (key: CanvasAudioSettingKey, value: string) => void;
    buttonClassName?: string;
    placement?: "topLeft" | "top" | "topRight" | "bottomLeft" | "bottom" | "bottomRight";
};

export function CanvasAudioSettingsPopover({ config, onConfigChange, buttonClassName, placement = "topLeft" }: CanvasAudioSettingsPopoverProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const buttonRef = useRef<HTMLSpanElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [buttonRect, setButtonRect] = useState<DOMRect | null>(null);
    const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

    useEffect(() => {
        if (!open) return;
        const syncPosition = () => {
            const button = buttonRef.current;
            setButtonRect(button?.getBoundingClientRect() || null);
            // 生成面板是浮层要避开的邻居，不只是按钮：只按按钮算会压在面板右侧空隙上。
            const anchor = button?.closest("[data-canvas-prompt-panel]");
            setAnchorRect(anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : null);
        };
        const closeOnOutsidePointer = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
            setOpen(false);
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
    }, [open]);

    // 位置由 Portal 内部按按钮实测矩形算；这里不要求 buttonRect 先就绪，
    // 否则首帧 buttonRect 还是 null，面板要等下一次 setState 才出现。
    const panel = open ? <AudioSettingsPortal buttonRect={buttonRect} anchorRect={anchorRect} panelRef={panelRef} placement={placement} theme={theme} config={config} onConfigChange={onConfigChange} /> : null;

    return (
        <>
            <span ref={buttonRef} className="inline-flex min-w-0">
                <Button size="small" type="text" className={buttonClassName || "!h-[var(--control-h-sm)] !max-w-[180px] !justify-start !rounded-[var(--r-md)] !px-2.5"} style={{ background: theme.toolbar.activeBg, color: theme.node.text }} icon={<Settings2 className="size-3.5" />} onClick={() => setOpen((current) => !current)}>
                    <span className="truncate">
                        {audioVoiceLabel(config.audioVoice)} · {audioFormatLabel(config.audioFormat)} · {audioSpeedLabel(config.audioSpeed)}
                    </span>
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
    placement,
    theme,
    config,
    onConfigChange,
}: {
    /** 首帧可能还没测量到按钮位置；为 null 时先不渲染，等首次 syncPosition 即可。 */
    buttonRect: DOMRect | null;
    /** 触发按钮所属的生成面板，水平避让以它为界。 */
    anchorRect: DOMRect | null;
    panelRef: RefObject<HTMLDivElement | null>;
    placement: CanvasAudioSettingsPopoverProps["placement"];
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    config: AiConfig;
    onConfigChange: (key: CanvasAudioSettingKey, value: string) => void;
}) {
    if (!buttonRect) return null;
    const width = Math.min(356, window.innerWidth - 24);
    const gap = 8;
    const margin = 12;
    // 底部工具栏占位：向下展开时留出这段，避免面板盖住工具坞。
    const dockInset = 88;
    const alignRight = placement?.endsWith("Right");
    const alignCenter = placement === "top" || placement === "bottom";
    // 水平避让以生成面板为界，而不是按钮：按钮只是面板里的一小块。
    const anchor = anchorRect ?? buttonRect;
    const left = alignCenter
        ? buttonRect.left + buttonRect.width / 2 - width / 2
        : alignRight
            ? buttonRect.right - width
            : window.innerWidth - anchor.right - gap - margin >= width
                ? anchor.right + gap
                : anchor.left - gap - margin >= width
                    ? anchor.left - gap - width
                    : buttonRect.right - width;
    const topPlacement = placement?.startsWith("top");
    const style = {
        position: "fixed",
        zIndex: 1200,
        width,
        left: Math.max(margin, Math.min(window.innerWidth - width - margin, left)),
        ...(topPlacement ? { bottom: window.innerHeight - buttonRect.top + gap, maxHeight: Math.max(220, buttonRect.top - gap - margin) } : { top: buttonRect.bottom + gap, maxHeight: Math.max(220, Math.min(window.innerHeight - buttonRect.bottom - gap - dockInset, buttonRect.top - gap - margin)) }),
        background: theme.toolbar.panel,
        borderRadius: 18,
        boxShadow: "0 18px 54px rgba(28, 25, 23, 0.16)",
        padding: 18,
        overflowY: "auto",
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
            <AudioSettingsPanel config={config} onConfigChange={(key, value) => onConfigChange(key, value)} theme={theme} className="space-y-4" />
        </div>,
        document.body,
    );
}
