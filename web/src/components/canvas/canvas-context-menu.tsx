import { useEffect, useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "motion/react";
import { BetweenHorizontalStart, ClipboardPaste, Copy, GalleryHorizontalEnd, GalleryHorizontal, Group, Images, Music2, Plus, Redo2, Trash2, Undo2, Ungroup, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ContextMenuState } from "@/types/canvas";
import type { VideoFramePosition } from "@/lib/canvas/canvas-video-frame";
import { buildToolContext } from "@/lib/canvas/tool-wiring";
import { resolveCanvasContextMenu, resolveNodeContextMenu } from "@/domain/tool/registry";

/**
 * 节点右键菜单。显示哪些条目、什么顺序、谁该红，全部由声明式工具注册表解析，
 * 组件只保留「id → 图标 / 点击行为」的渲染映射（图标是 ReactNode，不能进 domain）。
 */
export function CanvasNodeContextMenu({ menu, selectedCount, canCaptureVideoFrame, canExtractAudio, canGroup, canUngroup, onClose, onCaptureVideoFrame, onExtractAudio, onDuplicate, onCopySelection, onGroup, onUngroup, onDelete }: { menu: Exclude<ContextMenuState, { type: "canvas" }>; selectedCount: number; canCaptureVideoFrame: boolean; canExtractAudio?: boolean; canGroup?: boolean; canUngroup?: boolean; onClose: () => void; onCaptureVideoFrame: (position: VideoFramePosition) => void; onExtractAudio?: () => void; onDuplicate: () => void; onCopySelection: () => void; onGroup?: () => void; onUngroup?: () => void; onDelete: () => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const multiple = menu.type === "node" && selectedCount > 1;

    const ctx = buildToolContext({
        toolMode: "select",
        selectedCount: menu.type === "node" ? selectedCount : 0,
        nodeCount: 0,
        clipboardCount: 0,
        canUndo: false,
        canRedo: false,
        demoMode: false,
        contextNodeId: menu.type === "node" ? menu.nodeId : null,
        canCaptureVideoFrame: !multiple && canCaptureVideoFrame,
        canExtractAudio: !multiple && Boolean(canExtractAudio),
        canGroup: Boolean(canGroup),
        canUngroup: Boolean(canUngroup),
    });
    const commands = resolveNodeContextMenu(ctx);

    const iconOf: Record<string, ReactNode> = {
        "ctx-capture-first": <BetweenHorizontalStart className="size-4" />,
        "ctx-capture-last": <GalleryHorizontalEnd className="size-4" />,
        "ctx-capture-current": <GalleryHorizontal className="size-4" />,
        "ctx-extract-audio": <Music2 className="size-4" />,
        "ctx-group": <Group className="size-4" />,
        "ctx-ungroup": <Ungroup className="size-4" />,
        "ctx-duplicate": <Plus className="size-4" />,
        "ctx-delete": <Trash2 className="size-4" />,
    };
    const runOf: Record<string, () => void> = {
        "ctx-capture-first": () => onCaptureVideoFrame("first"),
        "ctx-capture-last": () => onCaptureVideoFrame("last"),
        "ctx-capture-current": () => onCaptureVideoFrame("current"),
        "ctx-extract-audio": () => onExtractAudio?.(),
        "ctx-group": () => onGroup?.(),
        "ctx-ungroup": () => onUngroup?.(),
        "ctx-duplicate": () => onDuplicate(),
        "ctx-delete": () => onDelete(),
    };

    // 截帧三连之后插一条分隔线，其余相邻条目不分隔——与旧版视觉一致。
    let renderedCapture = false;
    let separatorPlaced = false;

    return (
        <CanvasContextMenuSurface menu={menu} onClose={onClose}>
            {multiple && <div className="px-3 py-1.5 text-xs" style={{ color: theme.node.muted }}>{t("canvas.node.nodeCount", { count: selectedCount })}</div>}
            {commands.map((command) => {
                if (multiple && command.id === "ctx-duplicate") {
                    return <MenuButton key={command.id} icon={<Copy className="size-4" />} label={t("canvas.contextMenu.copySelection")} onClick={() => { onClose(); onCopySelection(); }} />;
                }
                const run = runOf[command.id];
                const icon = iconOf[command.id];
                if (!run || !icon) return null;
                const isCapture = command.id.startsWith("ctx-capture-");
                if (isCapture) renderedCapture = true;
                const needsSeparator = renderedCapture && !separatorPlaced && !isCapture;
                if (needsSeparator) separatorPlaced = true;
                return (
                    <div key={command.id}>
                        {needsSeparator ? <div className="my-1 border-t" style={{ borderColor: theme.toolbar.border }} /> : null}
                        <MenuButton icon={icon} label={multiple && command.id === "ctx-delete" ? t("canvas.contextMenu.deleteSelection") : t(command.labelKey ?? command.label)} onClick={() => { onClose(); run(); }} danger={command.danger} />
                    </div>
                );
            })}
        </CanvasContextMenuSurface>
    );
}

export function CanvasBackgroundContextMenu({ menu, canPaste, canUndo, canRedo, onClose, onAdd, onOpenAssets, onUpload, onUndo, onRedo, onPaste }: {
    menu: Extract<ContextMenuState, { type: "canvas" }>;
    canPaste: boolean;
    canUndo: boolean;
    canRedo: boolean;
    onClose: () => void;
    onAdd: () => void;
    onOpenAssets: () => void;
    onUpload: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onPaste: () => void;
}) {
    const { t } = useTranslation();
    const ctx = buildToolContext({
        toolMode: "select",
        selectedCount: 0,
        nodeCount: 0,
        clipboardCount: canPaste ? 1 : 0,
        canUndo,
        canRedo,
        demoMode: false,
        node: null,
    });
    const commands = resolveCanvasContextMenu(ctx);
    const iconOf: Record<string, ReactNode> = {
        "canvas-add-node": <Plus className="size-4" />,
        "canvas-upload-here": <Upload className="size-4" />,
        "canvas-open-assets": <Images className="size-4" />,
        "canvas-undo": <Undo2 className="size-4" />,
        "canvas-redo": <Redo2 className="size-4" />,
        "canvas-paste": <ClipboardPaste className="size-4" />,
    };
    const runOf: Record<string, () => void> = {
        "canvas-add-node": onAdd,
        "canvas-upload-here": onUpload,
        "canvas-open-assets": onOpenAssets,
        "canvas-undo": onUndo,
        "canvas-redo": onRedo,
        "canvas-paste": onPaste,
    };
    // 历史/剪贴板组前面插一条分组说明，其余条目连续排列。
    let sectionPlaced = false;
    return (
        <CanvasContextMenuSurface menu={menu} onClose={onClose}>
            {commands.map((command) => {
                const icon = iconOf[command.id];
                const run = runOf[command.id];
                if (!icon || !run) return null;
                const startsHistory = command.id === "canvas-undo" && !sectionPlaced;
                if (startsHistory) sectionPlaced = true;
                return (
                    <div key={command.id}>
                        {startsHistory ? <div role="presentation" className="mt-1 border-t border-border px-3 pt-2 text-[length:var(--fs-caption)] text-muted-foreground">{t("canvas.contextMenu.historyClipboard")}</div> : null}
                        <MenuButton icon={icon} label={command.labelKey ? t(command.labelKey) : command.label} onClick={() => { onClose(); run(); }} disabled={command.disabled} danger={command.danger} />
                    </div>
                );
            })}
        </CanvasContextMenuSurface>
    );
}

function CanvasContextMenuSurface({ menu, onClose, children }: { menu: ContextMenuState; onClose: () => void; children: ReactNode }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const ref = useRef<HTMLDivElement>(null);
    const previousFocus = useRef<HTMLElement | null>(null);
    const reduceMotion = useReducedMotion();
    useLayoutEffect(() => {
        previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        ref.current?.focus({ preventScroll: true });
    }, []);
    useLayoutEffect(() => {
        const place = () => {
            const element = ref.current;
            if (!element) return;
            element.style.left = `${Math.max(8, Math.min(menu.x, window.innerWidth - element.offsetWidth - 8))}px`;
            element.style.top = `${Math.max(8, Math.min(menu.y, window.innerHeight - element.offsetHeight - 8))}px`;
        };
        place();
        window.addEventListener("resize", place);
        return () => window.removeEventListener("resize", place);
    }, [menu.x, menu.y, children]);

    useEffect(() => {
        const closeOutside = (event: PointerEvent) => {
            if (event.target instanceof Node && !ref.current?.contains(event.target)) onClose();
        };
        window.addEventListener("pointerdown", closeOutside);
        return () => window.removeEventListener("pointerdown", closeOutside);
    }, [onClose]);
    return createPortal(
        <motion.div ref={ref} role="menu" aria-label={t("canvas.contextMenu.label")} tabIndex={-1}
            initial={reduceMotion ? false : { opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.14 }}
            data-canvas-no-zoom className="fixed z-[80] max-h-[calc(100dvh-1rem)] min-w-44 origin-top-left overflow-y-auto rounded-xl border py-1 shadow-2xl"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onKeyDown={(event) => {
                if (event.key === "Escape" || event.key === "Tab") {
                    event.preventDefault();
                    event.stopPropagation();
                    onClose();
                    previousFocus.current?.focus({ preventScroll: true });
                    return;
                }
                if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                event.stopPropagation();
                const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:enabled'));
                if (!items.length) return;
                const current = items.findIndex((item) => item === document.activeElement);
                let next = 0;
                if (event.key === "End") next = items.length - 1;
                if (event.key === "ArrowDown") next = (current + 1) % items.length;
                if (event.key === "ArrowUp") next = current <= 0 ? items.length - 1 : current - 1;
                items[next]?.focus();
            }}
            onPointerDown={(event) => event.stopPropagation()}>
            {children}
        </motion.div>,
        document.body,
    );
}

function MenuButton({ icon, label, onClick, danger = false, disabled = false }: { icon: ReactNode; label: string; onClick?: () => void; danger?: boolean; disabled?: boolean }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <button type="button" role="menuitem" tabIndex={-1} disabled={disabled} className="focus-ring flex w-full items-center gap-2 px-3 py-2 text-left text-xs enabled:hover:bg-[var(--surface-card-hover)] focus-visible:bg-[var(--surface-card-hover)] disabled:opacity-40 motion-safe:transition-colors" style={{ color: danger ? "var(--destructive)" : theme.node.text }} onClick={onClick}>
            {icon}
            <span>{label}</span>
        </button>
    );
}
