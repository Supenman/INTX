import type { ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, SlidersHorizontal, X } from "lucide-react";

import type { CanvasTheme } from "@/lib/canvas-theme";
import { resolvePopoverPosition, type PopoverPlacement } from "@/lib/canvas/popover-position";
import type { AnchoredPopover } from "@/hooks/use-anchored-popover";

type CanvasSettingsTriggerProps = {
    buttonRef: RefObject<HTMLSpanElement | null>;
    buttonWidth: number | null;
    open: boolean;
    title: string;
    summary: string;
    theme: CanvasTheme;
    buttonClassName?: string;
    onToggle: () => void;
};

/** 节点输入框右下角四类高级设置的统一触发胶囊：紧凑、清晰、带展开指示器。 */
export function CanvasSettingsTrigger({
    buttonRef,
    buttonWidth,
    open,
    title,
    summary,
    theme,
    buttonClassName,
    onToggle,
}: CanvasSettingsTriggerProps) {
    return (
        <span ref={buttonRef} className="inline-flex min-w-0" style={buttonWidth === null ? undefined : { width: buttonWidth }}>
            <button
                type="button"
                aria-expanded={open}
                aria-label={`${title}: ${summary}`}
                title={`${title} · ${summary}`}
                className={
                    buttonClassName ||
                    "focus-ring inline-flex h-7 max-w-[210px] cursor-pointer items-center gap-1.5 rounded-[var(--r-md)] px-2 text-[length:var(--fs-caption)] font-normal tabular-nums transition hover:opacity-90"
                }
                style={{
                    background: open ? theme.toolbar.activeBg : theme.toolbar.itemHover,
                    color: theme.node.text,
                    width: buttonWidth === null ? undefined : "100%",
                }}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={onToggle}
            >
                <SlidersHorizontal className="size-3.5 shrink-0 opacity-75" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-left">{summary}</span>
                <ChevronDown
                    className={`size-3 shrink-0 opacity-60 transition-transform ${open ? "rotate-180" : ""}`}
                    aria-hidden
                />
            </button>
        </span>
    );
}

type CanvasSettingsPortalShellProps = {
    buttonRect: DOMRect | null;
    anchorRect: DOMRect | null;
    panelHeight: number | null;
    panelRef: RefObject<HTMLDivElement | null>;
    panelProps: AnchoredPopover["panelProps"];
    placement: PopoverPlacement;
    layer: number;
    theme: CanvasTheme;
    title: string;
    summary?: string;
    icon?: ReactNode;
    onClose: () => void;
    children: ReactNode;
};

/** 四类高级设置浮层的统一玻璃态壳体：顶栏标题 + 当前摘要 + 关闭按钮 + 内容区。 */
export function CanvasSettingsPortalShell({
    buttonRect,
    anchorRect,
    panelHeight,
    panelRef,
    panelProps,
    placement,
    layer,
    theme,
    title,
    summary,
    icon,
    onClose,
    children,
}: CanvasSettingsPortalShellProps) {
    if (!buttonRect) return null;
    const position = resolvePopoverPosition({
        buttonRect,
        anchorRect,
        placement,
        panelHeight,
        viewport: { width: window.innerWidth, height: window.innerHeight },
    });
    const style = {
        position: "fixed",
        zIndex: layer,
        ...position,
        background: theme.toolbar.panel,
        borderColor: theme.toolbar.border,
        borderRadius: "var(--r-xl)",
        boxShadow: "var(--shadow-lg), var(--hairline)",
        overflowY: "auto",
        overscrollBehavior: "contain",
        color: theme.node.text,
    } as const;

    return createPortal(
        <div
            ref={panelRef}
            {...panelProps}
            className="canvas-image-settings-popover w-[min(336px,calc(100vw-24px))] border p-3.5 backdrop-blur-xl"
            data-node-settings-panel
            style={style}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <div
                className="mb-3 flex items-center justify-between gap-2 border-b pb-2.5"
                style={{ borderColor: theme.toolbar.border }}
            >
                <div className="flex min-w-0 items-center gap-2">
                    {icon ? (
                        <span
                            className="grid size-6 shrink-0 place-items-center rounded-[var(--r-sm)]"
                            style={{ background: theme.toolbar.itemHover, color: theme.node.text }}
                            aria-hidden
                        >
                            {icon}
                        </span>
                    ) : null}
                    <div className="min-w-0">
                        <div className="truncate text-[length:var(--fs-body)] font-semibold leading-tight">{title}</div>
                        {summary ? (
                            <div
                                className="mt-0.5 truncate text-[length:var(--fs-label)] leading-tight"
                                style={{ color: theme.node.muted }}
                            >
                                {summary}
                            </div>
                        ) : null}
                    </div>
                </div>
                <button
                    type="button"
                    aria-label={title}
                    className="focus-ring grid size-6 shrink-0 cursor-pointer place-items-center rounded-[var(--r-sm)] transition hover:bg-[var(--surface-card-hover)]"
                    style={{ color: theme.node.muted }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={onClose}
                >
                    <X className="size-3.5" aria-hidden />
                </button>
            </div>
            {children}
        </div>,
        document.body,
    );
}
