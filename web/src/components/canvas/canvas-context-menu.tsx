import { useEffect } from "react";
import type { ReactNode } from "react";
import { BetweenHorizontalStart, GalleryHorizontalEnd, GalleryHorizontal, Group, Music2, Plus, Trash2, Ungroup } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ContextMenuState } from "@/types/canvas";
import type { VideoFramePosition } from "@/lib/canvas/canvas-video-frame";
import { buildToolContext } from "@/lib/canvas/tool-wiring";
import { resolveNodeContextMenu } from "@/domain/tool/registry";

/**
 * 节点右键菜单。显示哪些条目、什么顺序、谁该红，全部由声明式工具注册表解析，
 * 组件只保留「id → 图标 / 点击行为」的渲染映射（图标是 ReactNode，不能进 domain）。
 */
export function CanvasNodeContextMenu({ menu, canCaptureVideoFrame, canExtractAudio, canGroup, canUngroup, onClose, onCaptureVideoFrame, onExtractAudio, onDuplicate, onGroup, onUngroup, onDelete }: { menu: ContextMenuState; canCaptureVideoFrame: boolean; canExtractAudio?: boolean; canGroup?: boolean; canUngroup?: boolean; onClose: () => void; onCaptureVideoFrame: (position: VideoFramePosition) => void; onExtractAudio?: () => void; onDuplicate: () => void; onGroup?: () => void; onUngroup?: () => void; onDelete: () => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    useEffect(() => {
        const close = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Element && target.closest(".ant-popover")) return;
            onClose();
        };
        window.addEventListener("pointerdown", close);
        return () => window.removeEventListener("pointerdown", close);
    }, [onClose]);

    const ctx = buildToolContext({
        toolMode: "select",
        selectedCount: menu.type === "node" ? 1 : 0,
        nodeCount: 0,
        clipboardCount: 0,
        canUndo: false,
        canRedo: false,
        demoMode: false,
        contextNodeId: menu.type === "node" ? menu.nodeId : null,
        canCaptureVideoFrame,
        canExtractAudio: Boolean(canExtractAudio),
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
        <div
            className="fixed z-[80] min-w-44 overflow-hidden rounded-xl border py-1 shadow-2xl"
            style={{ left: menu.x, top: menu.y, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
        >
            {commands.map((command) => {
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
                        <MenuButton icon={icon} label={t(command.labelKey ?? command.label)} onClick={run} danger={command.danger} />
                    </div>
                );
            })}
        </div>
    );
}

function MenuButton({ icon, label, onClick, danger = false }: { icon: ReactNode; label: string; onClick?: () => void; danger?: boolean }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:opacity-80" style={{ color: danger ? "#f87171" : theme.node.text }} onClick={onClick}>
            {icon}
            <span>{label}</span>
        </button>
    );
}
