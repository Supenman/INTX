import { useEffect, useRef } from "react";
import { ImageIcon, List, Music2, Video, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { listNodeDefinitions, useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { getNodeSpec } from "@/constant/canvas";
import { CanvasNodeType, type ConnectionHandle, type Position } from "@/types/canvas";
import type { AddNodeCommand } from "@/domain/tool/definition";
import { resolveAddNodeMenuCommands } from "@/domain/tool/registry";
import { buildToolContext } from "@/lib/canvas/tool-wiring";

export type PendingConnectionCreate = {
    connection: ConnectionHandle;
    position: Position;
};

export function ConnectionCreateMenu({
    pending,
    scale = 1,
    onCreate,
    onClose,
}: {
    pending: PendingConnectionCreate;
    scale?: number;
    onCreate: (type: CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Video | CanvasNodeType.Audio) => void;
    onClose: () => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    return (
        <div
            className="absolute z-[120] w-[240px] rounded-2xl border p-2 shadow-2xl backdrop-blur"
            data-connection-create-menu
            style={{ left: pending.position.x, top: pending.position.y, transform: `scale(${1 / scale})`, transformOrigin: "top left", background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="mb-1.5 flex items-center justify-between px-1">
                <span className="text-sm font-medium" style={{ color: theme.node.muted }}>
                    {t("canvas.createMenu.fromNode")}
                </span>
                <button type="button" className="grid size-7 place-items-center rounded-lg text-base opacity-55 transition hover:bg-white/10 hover:opacity-100" onClick={onClose} aria-label={t("canvas.createMenu.close")}>
                    ×
                </button>
            </div>
            <div className="grid gap-0.5">
                <ConnectionCreateOption theme={theme} icon={<List className="size-4" />} title={t("canvas.createMenu.text")} description={t("canvas.createMenu.textDescription")} onClick={() => onCreate(CanvasNodeType.Text)} />
                <ConnectionCreateOption theme={theme} icon={<ImageIcon className="size-4" />} title={t("canvas.createMenu.image")} onClick={() => onCreate(CanvasNodeType.Image)} />
                <ConnectionCreateOption theme={theme} icon={<Video className="size-4" />} title={t("canvas.createMenu.video")} onClick={() => onCreate(CanvasNodeType.Video)} />
                <ConnectionCreateOption theme={theme} icon={<Music2 className="size-4" />} title={t("canvas.createMenu.audio")} onClick={() => onCreate(CanvasNodeType.Audio)} />
            </div>
        </div>
    );
}

export function ConnectionCreateOption({ theme, icon, title, description, onClick }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes]; icon: React.ReactNode; title: string; description?: string; onClick?: () => void }) {
    return (
        <button
            type="button"
            className="flex h-12 w-full cursor-pointer items-center gap-2.5 rounded-xl px-2 text-left transition"
            style={{ color: theme.node.text }}
            onClick={onClick}
            onMouseEnter={(event) => (event.currentTarget.style.background = theme.node.fill)}
            onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}
        >
            <span className="grid size-9 shrink-0 place-items-center rounded-lg" style={{ background: theme.node.fill, color: theme.node.muted }}>
                {icon}
            </span>
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-medium leading-5">{title}</span>
                {description ? (
                    <span className="mt-0.5 block truncate text-xs" style={{ color: theme.node.muted }}>
                        {description}
                    </span>
                ) : null}
            </span>
        </button>
    );
}

export function NodeCreateMenu({ position, onCreate, onClose }: { position: Position; onCreate: (type: string) => void; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    useNodeRegistryVersion();
    const menuRef = useRef<HTMLDivElement>(null);
    // 节点条目统一由工具注册表解析产出：注入生产画布节点（lib 注册表），
    // 与 domain 内置节点解耦。以后在注册表里加画布动作，菜单无需改代码。
    const definitions = listNodeDefinitions().filter((def) => def.showInCreateMenu !== false);
    const inject: AddNodeCommand[] = definitions.map((def, i) => ({
        id: `node:${def.type}`,
        label: getNodeSpec(def.type).title,
        section: "source",
        defaultOrder: 10 + i,
        action: "add-node",
        payload: { kind: def.type },
        disabledReason: null,
    }));
    const ctx = buildToolContext({
        toolMode: "select", selectedCount: 0, nodeCount: 0, clipboardCount: 0,
        canUndo: false, canRedo: false, demoMode: false,
    });
    // 只渲染能创建节点的条目；画布动作（粘贴 / 整理）在当前菜单无 dispatch，暂不显示。
    const nodeCommands = resolveAddNodeMenuCommands(ctx, inject).filter((cmd) => cmd.action === "add-node");
    useEffect(() => {
        menuRef.current?.focus({ preventScroll: true });
    }, []);
    // Close automatically when clicking outside the menu.
    useEffect(() => {
        const handlePointerDown = (event: PointerEvent) => {
            if (event.target instanceof Element && event.target.closest('[data-toolbar-id="tool-add-node"]')) return;
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
        };
        document.addEventListener("pointerdown", handlePointerDown, true);
        return () => document.removeEventListener("pointerdown", handlePointerDown, true);
    }, [onClose]);
    return (
        <div
            ref={menuRef}
            role="dialog"
            aria-label={t("canvas.createMenu.select")}
            tabIndex={-1}
            className="thin-scrollbar absolute z-[90] w-60 max-w-[calc(100%-1rem)] overflow-y-auto rounded-xl border p-2 shadow-xl outline-none"
            data-canvas-no-zoom
            style={{ left: position.x, top: position.y, maxHeight: `calc(100% - ${position.y + 8}px)`, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.stopPropagation();
                onClose();
            }}
        >
            <div className="mb-1.5 flex items-center justify-between px-1">
                <span className="text-sm font-medium" style={{ color: theme.node.muted }}>
                    {t("canvas.createMenu.select")}
                </span>
                <button type="button" className="grid size-7 place-items-center rounded-lg opacity-55 transition hover:opacity-100" onClick={onClose} aria-label={t("canvas.createMenu.close")}>
                    <X className="size-4" />
                </button>
            </div>
            <div className="grid gap-0.5">
                {nodeCommands.map((cmd) => {
                    const def = definitions.find((d) => d.type === cmd.payload?.kind);
                    return (
                        <ConnectionCreateOption
                            key={cmd.id}
                            theme={theme}
                            icon={def?.icon}
                            title={cmd.label}
                            description={def?.description}
                            onClick={() => onCreate(cmd.payload?.kind ?? "")}
                        />
                    );
                })}
            </div>
        </div>
    );
}
