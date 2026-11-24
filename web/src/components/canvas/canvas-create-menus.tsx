import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Clapperboard, History, ImageIcon, Images, List, Music2, Search, Upload, Video, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { listNodeDefinitions, useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { CanvasNodeType, type ConnectionHandle, type Position } from "@/types/canvas";
import type { AddNodeCommand } from "@/domain/tool/definition";
import { resolveAddNodeMenuCommands } from "@/domain/tool/registry";
import { buildToolContext } from "@/lib/canvas/tool-wiring";

export type PendingConnectionCreate = {
    connection: ConnectionHandle;
    position: Position;
    quickAdd?: boolean;
};

/**
 * 新建基础节点的单键快捷键。
 *
 * 放在这里而不是散落在键盘处理里：添加菜单要显示同样的键位提示，
 * 两处读同一个常量才不会出现「菜单标了 T、按 T 没反应」。
 * 只用无修饰键的单字母，避免和 Ctrl/Cmd 组合冲突；大小写按键盘事件归一。
 */
export const NODE_CREATE_SHORTCUTS: Readonly<Record<string, string>> = {
    [CanvasNodeType.Text]: "T",
    [CanvasNodeType.Image]: "I",
    [CanvasNodeType.Video]: "V",
    [CanvasNodeType.Audio]: "A",
};

export function ConnectionCreateMenu({
    position,
    fromInput,
    onCreate,
    onClose,
}: {
    position: Position;
    fromInput: boolean;
    onCreate: (type: CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Video | CanvasNodeType.Audio) => void;
    onClose: () => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    const menuRef = useRef<HTMLDivElement>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);
    useEffect(() => {
        previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        menuRef.current?.querySelector<HTMLButtonElement>("[data-connection-create-option]")?.focus({ preventScroll: true });
    }, []);
    const closeAndRestoreFocus = () => {
        onClose();
        requestAnimationFrame(() => {
            const target = previousFocusRef.current?.isConnected ? previousFocusRef.current : document.querySelector<HTMLElement>("[data-canvas-root]");
            target?.focus({ preventScroll: true });
        });
    };
    useEffect(() => {
        const handlePointerDown = (event: PointerEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
        };
        document.addEventListener("pointerdown", handlePointerDown, true);
        return () => document.removeEventListener("pointerdown", handlePointerDown, true);
    }, [onClose]);
    return (
        <div
            ref={menuRef}
            className="absolute z-[120] max-h-[calc(100%-16px)] w-60 max-w-[calc(100%-16px)] overflow-y-auto rounded-2xl border p-2 shadow-2xl backdrop-blur"
            data-connection-create-menu
            role="dialog"
            tabIndex={-1}
            aria-label={t(fromInput ? "canvas.createMenu.beforeNode" : "canvas.createMenu.fromNode")}
            style={{ left: `clamp(8px, ${position.x}px, calc(100% - 248px))`, top: `clamp(8px, ${position.y}px, calc(100% - 260px))`, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
                if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    closeAndRestoreFocus();
                    return;
                }
                if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
                const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-connection-create-option]"));
                if (!options.length) return;
                event.preventDefault();
                event.stopPropagation();
                const current = options.indexOf(document.activeElement as HTMLButtonElement);
                const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : event.key === "ArrowDown" ? (current + 1) % options.length : current <= 0 ? options.length - 1 : current - 1;
                options[next].focus();
            }}
        >
            <div className="mb-1.5 flex items-center justify-between px-1">
                <span className="text-sm font-medium" style={{ color: theme.node.muted }}>
                    {t(fromInput ? "canvas.createMenu.beforeNode" : "canvas.createMenu.fromNode")}
                </span>
                <button type="button" className="grid size-7 place-items-center rounded-lg text-base opacity-55 transition hover:bg-white/10 hover:opacity-100" onClick={closeAndRestoreFocus} aria-label={t("canvas.createMenu.close")}>
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
            data-connection-create-option
            className="flex h-12 w-full cursor-pointer items-center gap-2.5 rounded-xl px-2 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--workspace-accent)]"
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

export function NodeCreateMenu({ position, dockAnchor, onCreate, onClose, onUpload, onOpenAssets, onOpenHistory, onOpenStoryboard }: {
    position: Position;
    dockAnchor?: boolean;
    onCreate: (type: string) => void;
    onClose: () => void;
    onUpload: () => void;
    onOpenAssets: () => void;
    onOpenHistory: () => void;
    onOpenStoryboard: () => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    useNodeRegistryVersion();
    const menuRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);
    const [query, setQuery] = useState("");
    const reducedMotion = useReducedMotion();
    // 节点条目统一由工具注册表解析产出：注入生产画布节点（lib 注册表），
    // 与 domain 内置节点解耦。以后在注册表里加画布动作，菜单无需改代码。
    const definitions = listNodeDefinitions().filter((def) => def.showInCreateMenu !== false);
    const inject: AddNodeCommand[] = definitions.map((def, i) => ({
        id: `node:${def.type}`,
        label: def.title,
        section: "source",
        defaultOrder: 10 + i,
        action: "add-node",
        payload: { kind: def.type },
        disabledReason: null,
        // 快捷键与条目同源：改注册表的 shortcut 字段，菜单提示和键盘处理一起变。
        shortcut: NODE_CREATE_SHORTCUTS[def.type],
    }));
    const ctx = buildToolContext({
        toolMode: "select", selectedCount: 0, nodeCount: 0, clipboardCount: 0,
        canUndo: false, canRedo: false, demoMode: false,
    });
    // 只渲染能创建节点的条目；画布动作（粘贴 / 整理）在当前菜单无 dispatch，暂不显示。
    const nodeCommands = resolveAddNodeMenuCommands(ctx, inject).filter((cmd) => cmd.action === "add-node");
    useEffect(() => {
        previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        searchRef.current?.focus({ preventScroll: true });
    }, []);
    const closeMenu = useCallback(() => {
        onClose();
        const returnTarget = previousFocusRef.current?.isConnected ? previousFocusRef.current : document.querySelector<HTMLElement>("[data-canvas-root]");
        returnTarget?.focus({ preventScroll: true });
    }, [onClose]);
    // Close automatically when clicking outside the menu.
    useEffect(() => {
        const handlePointerDown = (event: PointerEvent) => {
            if (event.target instanceof Element && event.target.closest('[data-toolbar-id="tool-add-node"]')) return;
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) closeMenu();
        };
        document.addEventListener("pointerdown", handlePointerDown, true);
        return () => document.removeEventListener("pointerdown", handlePointerDown, true);
    }, [closeMenu]);
    const items = nodeCommands.flatMap((cmd) => {
        const type = cmd.payload?.kind;
        if (!type) return [];
        return [{ id: cmd.id, label: cmd.label, icon: definitions.find((def) => def.type === type)?.icon, shortcut: cmd.shortcut, run: () => onCreate(type) }];
    });
    items.push({ id: "storyboard", label: t("canvas.storyboard.entry"), icon: <Clapperboard className="size-4" />, shortcut: undefined, run: onOpenStoryboard });
    const imports = [
        { id: "upload", label: t("canvas.toolbar.upload"), icon: <Upload className="size-4" />, shortcut: undefined, run: onUpload },
        { id: "history", label: t("canvas.generationHistory.entry"), icon: <History className="size-4" />, shortcut: undefined, run: onOpenHistory },
        { id: "assets", label: t("canvas.assetPicker.open"), icon: <Images className="size-4" />, shortcut: undefined, run: onOpenAssets },
    ];
    const matches = (label: string) => label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
    const sections = [
        { label: t("canvas.createMenu.nodes"), items: items.filter((item) => matches(item.label)) },
        { label: t("canvas.createMenu.resources"), items: imports.filter((item) => matches(item.label)) },
    ];
    return (
        <motion.div
            ref={menuRef}
            initial={reducedMotion ? false : { opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            role="dialog"
            aria-label={t("canvas.toolbar.addNode")}
            tabIndex={-1}
            className="thin-scrollbar absolute z-[90] w-60 max-w-[calc(100%-1rem)] overflow-y-auto rounded-xl border p-2 shadow-xl outline-none"
            data-canvas-no-zoom
            style={{ left: position.x, ...(dockAnchor ? { bottom: position.y } : { top: position.y }), maxHeight: `calc(100% - ${position.y + 8}px)`, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
                if (event.key === "Escape") {
                    event.stopPropagation();
                    closeMenu();
                    return;
                }
                if (!["ArrowDown", "ArrowUp", "Home", "End", "Enter"].includes(event.key) || event.nativeEvent.isComposing) return;
                if ((event.key === "Home" || event.key === "End") && event.target === searchRef.current) return;
                const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-create-option]"));
                if (!options.length) return;
                const current = options.findIndex((option) => option === document.activeElement);
                if (event.key === "Enter" && event.target !== searchRef.current) return;
                event.preventDefault();
                event.stopPropagation();
                if (event.key === "Enter") options[0].click();
                else if (event.key === "ArrowDown") options[(current + 1) % options.length].focus();
                else if (event.key === "ArrowUp") options[current <= 0 ? options.length - 1 : current - 1].focus();
                else options[event.key === "Home" ? 0 : options.length - 1].focus();
            }}
        >
            <div className="mb-1.5 flex items-center justify-between px-1">
                <Search aria-hidden className="mr-2 size-4 shrink-0" />
                <input ref={searchRef} className="min-w-0 flex-1 bg-transparent text-sm outline-none" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("canvas.createMenu.search")} aria-label={t("canvas.createMenu.search")} />
                <button type="button" className="grid size-7 place-items-center rounded-lg opacity-55 transition hover:opacity-100" onClick={closeMenu} aria-label={t("canvas.createMenu.close")}>
                    <X className="size-4" />
                </button>
            </div>
            {sections.map((section) => section.items.length > 0 && (
                <div key={section.label} className="mt-1 border-t border-border pt-1">
                    <div className="px-2 py-1 text-xs" style={{ color: theme.node.muted }}>{section.label}</div>
                    {section.items.map((item) => (
                        <button key={item.id} type="button" data-create-option className="flex h-8 w-full items-center gap-2 rounded-[var(--r-sm)] px-2 text-left text-sm hover:bg-[var(--surface-card-hover)] focus-visible:bg-[var(--surface-card-hover)]" onClick={() => { closeMenu(); item.run(); }}>
                            {item.icon}
                            <span className="min-w-0 flex-1 truncate">{item.label}</span>
                            {/* 键位提示：让「菜单里有」和「按一下就出来」对得上。 */}
                            {item.shortcut ? <kbd className="shrink-0 rounded-[var(--r-sm)] px-1 font-mono text-[length:var(--fs-label)]" style={{ background: theme.toolbar.activeBg, color: theme.node.muted }}>{item.shortcut}</kbd> : null}
                        </button>
                    ))}
                </div>
            ))}
            {sections.every((section) => !section.items.length) && <p className="px-2 py-3 text-sm" style={{ color: theme.node.muted }}>{t("canvas.createMenu.noResults")}</p>}
        </motion.div>
    );
}
