import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode, RefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Segmented, Switch } from "antd";
import { Check, CircleDot, Eraser, Grid2x2, Group, Hand, Info, SlidersHorizontal, LocateFixed, Moon, MousePointer2, Palette, Plus, Puzzle, Redo2, Square, Sun, Trash2, Undo2 } from "lucide-react";

import { canvasThemes, type CanvasBackgroundMode, type CanvasColorTheme, type CanvasTheme } from "@/lib/canvas-theme";
import { buildToolContext, toolView } from "@/lib/canvas/tool-wiring";
import { useToolbarPrefs } from "@/hooks/use-toolbar-prefs";
import { ToolbarPrefsModal } from "@/components/canvas/toolbar-prefs-modal";
import { resolveToolbarTools } from "@/domain";
import { getNodePluginId, listNodeDefinitions, useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { getNodeSpec } from "@/constant/canvas";
import { useThemeStore } from "@/stores/use-theme-store";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { useTranslation } from "react-i18next";

/** 工具菜单的两项。顺序即菜单顺序，「移动」在前，与默认工具一致。 */
const CANVAS_TOOL_OPTIONS = [
    { value: "select", labelKey: "canvas.toolbar.select", hintKey: "canvas.toolbar.selectHint" },
    { value: "pan", labelKey: "canvas.toolbar.pan", hintKey: "canvas.toolbar.panHint" },
] as const;

export function CanvasToolbar({
    selectedCount,
    canvasTool,
    canUndo,
    canRedo,
    backgroundMode,
    snapToGrid,
    showImageInfo,
    addMenuActive,
    onOpenCreateMenu,
    onAddGroup,
    onAddExtensionNode,
    onUndo,
    onRedo,
    onDelete,
    onClear,
    onCanvasToolChange,
    onBackgroundModeChange,
    onSnapToGridChange,
    onShowImageInfoChange,
    onFocusSelected,
    onFitCanvas,
}: {
    selectedCount: number;
    canvasTool: "select" | "pan";
    canUndo: boolean;
    canRedo: boolean;
    backgroundMode: CanvasBackgroundMode;
    snapToGrid: boolean;
    showImageInfo: boolean;
    addMenuActive: boolean;
    onOpenCreateMenu: (event: ReactMouseEvent<HTMLElement>) => void;
    onAddGroup: () => void;
    onAddExtensionNode: (type: string) => void;
    onUndo: () => void;
    onRedo: () => void;
    onDelete: () => void;
    onClear: () => void;
    onCanvasToolChange: (tool: "select" | "pan") => void;
    onBackgroundModeChange: (mode: CanvasBackgroundMode) => void;
    onSnapToGridChange: (enabled: boolean) => void;
    onShowImageInfoChange: (show: boolean) => void;
    onFocusSelected: () => void;
    onFitCanvas: () => void;
}) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const { t } = useTranslation();
    const rootRef = useRef<HTMLDivElement>(null);
    const colorTheme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const theme = canvasThemes[colorTheme];
    const [hovered, setHovered] = useState<string | null>(null);
    const [tipX, setTipX] = useState(0);
    const [appearanceOpen, setAppearanceOpen] = useState(false);
    const [prefsOpen, setPrefsOpen] = useState(false);
    const [panelX, setPanelX] = useState(0);
    const [extensionsOpen, setExtensionsOpen] = useState(false);
    const [extPanelX, setExtPanelX] = useState(0);
    const [toolMenuOpen, setToolMenuOpen] = useState(false);
    const [toolMenuX, setToolMenuX] = useState(0);
    // 撤销/重做的可用性由注册表判定；两个值仍来自 store，这里只做映射。
    const { prefs } = useToolbarPrefs("main");
    const toolCtx = useMemo(
        () => buildToolContext({ toolMode: canvasTool, selectedCount, nodeCount: selectedCount, clipboardCount: 0, canUndo, canRedo, demoMode: false }),
        [canvasTool, selectedCount, canUndo, canRedo],
    );
    // 底部工具栏的按钮是逐个手写的（各有 Divider / 高亮 / 跟随提示），不整体改成遍历注册表。
    // 但「用户隐藏了哪个」必须生效，否则自定义工具栏就是个摆设——这里只取一份 id 集合做门禁。
    const visibleIds = new Set(resolveToolbarTools("main", toolCtx, prefs).map((tool) => tool.id));
    const undoView = toolView("main", "undo", toolCtx, prefs);
    const redoView = toolView("main", "redo", toolCtx, prefs);
    // Keep extension plugin nodes synchronized with registry changes.
    useNodeRegistryVersion();
    const extensionDefs = listNodeDefinitions().filter((def) => def.showInCreateMenu !== false && getNodePluginId(def.type) !== "builtin");
    const dockStyle = { background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item, boxShadow: colorTheme === "dark" ? "0 18px 45px rgba(0,0,0,.32)" : "0 16px 40px rgba(15,23,42,.12)" };
    const hoverStyle = { background: theme.toolbar.itemHover, color: theme.toolbar.activeText };
    const activeStyle = { background: theme.toolbar.activeBg, color: theme.toolbar.activeText };
    const tip = hovered ? toolLabel(hovered, t) : "";

    // Close extension-node, canvas-appearance and tool menus when clicking outside the toolbar and its panels.
    useEffect(() => {
        if (!extensionsOpen && !appearanceOpen && !toolMenuOpen) return;
        const handlePointerDown = (event: PointerEvent) => {
            if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
                setExtensionsOpen(false);
                setAppearanceOpen(false);
                setToolMenuOpen(false);
            }
        };
        document.addEventListener("pointerdown", handlePointerDown, true);
        return () => document.removeEventListener("pointerdown", handlePointerDown, true);
    }, [extensionsOpen, appearanceOpen, toolMenuOpen]);

    // 菜单开合都会把焦点移到菜单或留在按钮上，Esc 落在哪个节点上不固定，
    // 所以 Esc 在 window 捕获阶段收：菜单和面板都对 Esc 负责，不指望某个内部节点拿到焦点。
    useEffect(() => {
        if (!toolMenuOpen && !extensionsOpen && !appearanceOpen) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            if (toolMenuOpen) {
                setToolMenuOpen(false);
                rootRef.current?.querySelector<HTMLButtonElement>('[data-toolbar-id="tool-mode"]')?.focus({ preventScroll: true });
            }
            setExtensionsOpen(false);
            setAppearanceOpen(false);
        };
        window.addEventListener("keydown", handleKeyDown, true);
        return () => window.removeEventListener("keydown", handleKeyDown, true);
    }, [toolMenuOpen, extensionsOpen, appearanceOpen]);

    return (
        <div ref={rootRef} className="pointer-events-none absolute bottom-4 left-1/2 z-50 flex max-w-[calc(100%-2rem)] -translate-x-1/2 justify-center @max-[1040px]:bottom-20" data-canvas-bottom-toolbar>
            {tip ? <DockTip label={tip} x={tipX} theme={theme} /> : null}
            <div ref={wrapRef} className="thin-scrollbar pointer-events-auto flex h-12 max-w-full items-center gap-0.5 overflow-x-auto rounded-2xl border px-1.5 shadow-md backdrop-blur [&>*]:shrink-0" style={dockStyle}>
                <ToolbarButton id="tool-add-node" label={t("canvas.toolbar.addNode")} active={addMenuActive} hovered={hovered} activeStyle={activeStyle} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={(event) => { setExtensionsOpen(false); setAppearanceOpen(false); onOpenCreateMenu(event); }}>
                    <Plus className="size-4.5" />
                </ToolbarButton>
                {/* 一个按钮 + 二选一菜单。菜单开着时高亮；按钮图标与提示始终是「当前工具」，
                    点开即可在「移动（框选）」与「抓手工具（平移）」之间切换。 */}
                <ToolbarButton
                    id="tool-mode"
                    label={t("canvas.toolbar.toolMode")}
                    menu={toolMenuOpen}
                    hovered={hovered}
                    activeStyle={activeStyle}
                    hoverStyle={hoverStyle}
                    wrapRef={wrapRef}
                    onTipX={setTipX}
                    onHover={setHovered}
                    onClick={(event) => {
                        setToolMenuX(getTipX(wrapRef.current, event.currentTarget));
                        setExtensionsOpen(false);
                        setAppearanceOpen(false);
                        setToolMenuOpen((value) => !value);
                    }}
                >
                    {canvasTool === "select" ? <MousePointer2 className="size-4.5" /> : <Hand className="size-4.5" />}
                </ToolbarButton>
                {undoView.visible ? <ToolbarButton id="tool-undo" label={t("canvas.undo")} disabled={!canUndo || undoView.disabled} hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onUndo}>
                    <Undo2 className="size-4.5" />
                </ToolbarButton> : null}
                {redoView.visible ? <ToolbarButton id="tool-redo" label={t("canvas.redo")} disabled={!canRedo || redoView.disabled} hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onRedo}>
                    <Redo2 className="size-4.5" />
                </ToolbarButton> : null}
                {visibleIds.has("tool-focus") ? <ToolbarButton id="tool-focus" label={t("canvas.toolbar.focus")} disabled={!selectedCount} hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onFocusSelected}>
                    <LocateFixed className="size-4.5" />
                </ToolbarButton> : null}
                <Divider theme={theme} />
                {visibleIds.has("tool-group") ? <ToolbarButton id="tool-group" label={t("canvas.toolbar.group")} hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onAddGroup}>
                    <Group className="size-4.5" />
                </ToolbarButton> : null}
                {extensionDefs.length && visibleIds.has("tool-extensions") ? (
                    <ToolbarButton
                        id="tool-extensions"
                        label={t("canvas.toolbar.extensions")}
                        active={extensionsOpen}
                        hovered={hovered}
                        activeStyle={activeStyle}
                        hoverStyle={hoverStyle}
                        wrapRef={wrapRef}
                        onTipX={setTipX}
                        onHover={setHovered}
                        onClick={(event) => {
                            setExtPanelX(getTipX(wrapRef.current, event.currentTarget));
                            setAppearanceOpen(false);
                            setExtensionsOpen((value) => !value);
                        }}
                    >
                        <Puzzle className="size-4.5" />
                    </ToolbarButton>
                ) : null}
                <Divider theme={theme} />
                <ToolbarButton
                    id="tool-style"
                    label={t("canvas.toolbar.appearance")}
                    active={appearanceOpen}
                    hovered={hovered}
                    activeStyle={activeStyle}
                    hoverStyle={hoverStyle}
                    wrapRef={wrapRef}
                    onTipX={setTipX}
                    onHover={setHovered}
                    onClick={(event) => {
                        setPanelX(getTipX(wrapRef.current, event.currentTarget));
                        setExtensionsOpen(false);
                        setAppearanceOpen((value) => !value);
                    }}
                >
                    <Palette className="size-4.5" />
                </ToolbarButton>
                {selectedCount ? (
                    <>
                        <Divider theme={theme} />
                        <ToolbarButton id="tool-delete" label={t("canvas.deleteSelected")} hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onDelete} danger>
                            <Trash2 className="size-4.5" />
                        </ToolbarButton>
                    </>
                ) : null}
                <Divider theme={theme} />
                {visibleIds.has("tool-clear") ? <ToolbarButton id="tool-clear" label={t("canvas.toolbar.clear")} hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onClear} danger>
                    <Eraser className="size-4.5" />
                </ToolbarButton> : null}
            </div>

            {extensionsOpen && extensionDefs.length ? (
                <div
                    className="thin-scrollbar pointer-events-auto absolute bottom-[72px] z-30 max-h-[50vh] w-[240px] -translate-x-1/2 overflow-y-auto rounded-xl border p-2 shadow-xl backdrop-blur"
                    style={{ left: extPanelX || "50%", background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item }}
                    onKeyDown={(event) => {
                        if (event.key !== "Escape") return;
                        event.preventDefault();
                        event.stopPropagation();
                        setExtensionsOpen(false);
                        rootRef.current?.querySelector<HTMLButtonElement>('[data-toolbar-id="tool-extensions"]')?.focus({ preventScroll: true });
                    }}
                >
                    <div className="px-1.5 pb-1.5 text-[length:var(--fs-label)] font-medium opacity-50">{t("canvas.toolbar.extensions")}</div>
                    <div className="grid gap-0.5">
                        {extensionDefs.map((def) => (
                            <button
                                key={def.type}
                                type="button"
                                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--workspace-accent)]"
                                style={{ color: theme.toolbar.item }}
                                onMouseEnter={(event) => (event.currentTarget.style.background = theme.toolbar.itemHover)}
                                onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}
                                onClick={() => {
                                    onAddExtensionNode(def.type);
                                    setExtensionsOpen(false);
                                }}
                            >
                                <span className="grid size-7 shrink-0 place-items-center rounded-md text-base" style={{ background: theme.toolbar.itemHover }}>
                                    {def.icon}
                                </span>
                                <span className="min-w-0 flex-1 truncate">{getNodeSpec(def.type).title}</span>
                            </button>
                        ))}
                    </div>
                </div>
            ) : null}

            {appearanceOpen ? (
                <div
                    className="pointer-events-auto absolute bottom-[72px] z-30 w-[248px] -translate-x-1/2 rounded-xl border p-2.5 shadow-xl backdrop-blur"
                    style={{ left: panelX || "50%", background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item }}
                    onKeyDown={(event) => {
                        if (event.key !== "Escape") return;
                        event.preventDefault();
                        event.stopPropagation();
                        setAppearanceOpen(false);
                        rootRef.current?.querySelector<HTMLButtonElement>('[data-toolbar-id="tool-style"]')?.focus({ preventScroll: true });
                    }}
                >
                    <div className="px-1 pb-2 text-sm font-medium opacity-65">{t("canvas.toolbar.appearance")}</div>
                    <div className="px-1 pb-1.5 text-[length:var(--fs-label)] font-medium opacity-50">{t("canvas.toolbar.themeMode")}</div>
                    <div className="grid grid-cols-2 gap-1 rounded-lg p-1" style={{ background: theme.toolbar.itemHover }}>
                        <CanvasThemeButton colorTheme={colorTheme} targetTheme="light" onThemeChange={setTheme}>
                            <Sun className="size-4" />
                            {t("canvas.toolbar.light")}
                        </CanvasThemeButton>
                        <CanvasThemeButton colorTheme={colorTheme} targetTheme="dark" onThemeChange={setTheme}>
                            <Moon className="size-4" />
                            {t("canvas.toolbar.dark")}
                        </CanvasThemeButton>
                    </div>
                    <div className="mt-3 px-1 pb-1.5 text-[length:var(--fs-label)] font-medium opacity-50">{t("canvas.toolbar.gridStyle")}</div>
                    <Segmented
                        className="w-full !p-1 [&_.ant-segmented-group]:!flex [&_.ant-segmented-item]:!min-h-8 [&_.ant-segmented-item]:!flex-1 [&_.ant-segmented-item-label]:!min-h-8 [&_.ant-segmented-item-label]:!leading-8"
                        value={backgroundMode}
                        onChange={(value) => onBackgroundModeChange(value as CanvasBackgroundMode)}
                        options={[
                            {
                                value: "dots",
                                label: (
                                    <span className="inline-flex items-center gap-1.5">
                                        <CircleDot className="size-4" />{t("canvas.toolbar.dots")}
                                    </span>
                                ),
                            },
                            {
                                value: "lines",
                                label: (
                                    <span className="inline-flex items-center gap-1.5">
                                        <Grid2x2 className="size-4" />{t("canvas.toolbar.lines")}
                                    </span>
                                ),
                            },
                            {
                                value: "blank",
                                label: (
                                    <span className="inline-flex items-center gap-1.5">
                                        <Square className="size-4" />
                                        {t("canvas.toolbar.blank")}
                                    </span>
                                ),
                            },
                        ]}
                    />
                    <div className="mt-2 flex items-center justify-between gap-3 rounded-lg px-1.5 py-1">
                        <span className="text-[length:var(--fs-label)] font-medium opacity-65">{t("canvas.toolbar.snapToGrid", { size: 16 })}</span>
                        <Switch size="small" checked={snapToGrid} onChange={onSnapToGridChange} aria-label={t("canvas.toolbar.snapToGrid", { size: 16 })} />
                    </div>
                    <button
                        type="button"
                        className="mt-2 flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1.5 text-left text-xs transition hover:bg-black/5 dark:hover:bg-white/5"
                        style={{ color: theme.toolbar.item }}
                        onClick={() => {
                            setAppearanceOpen(false);
                            onFitCanvas();
                        }}
                    >
                        <LocateFixed className="size-3.5" />
                        {t("canvas.toolbar.fitAll")}
                    </button>
                    <div className="mt-3 flex items-center justify-between gap-3 rounded-lg px-1.5 py-1">
                        <span className="inline-flex min-w-0 items-center gap-1.5 text-[length:var(--fs-label)] font-medium opacity-65">
                            <Info className="size-3.5" />
                            {t("canvas.toolbar.imageInfo")}
                        </span>
                        <Switch size="small" checked={showImageInfo} onChange={onShowImageInfoChange} />
                    </div>
                    {/* 入口放在外观面板底部：这块是「调整我怎么看画布」的自然归属，
                        不占顶部栏那 7 个图标的位置。 */}
                    <button
                        type="button"
                        className="mt-2 flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1.5 text-left text-xs transition"
                        style={{ color: theme.toolbar.item }}
                        onMouseEnter={(event) => Object.assign(event.currentTarget.style, { background: theme.toolbar.itemHover })}
                        onMouseLeave={(event) => Object.assign(event.currentTarget.style, { background: "transparent" })}
                        onClick={() => {
                            setAppearanceOpen(false);
                            setPrefsOpen(true);
                        }}
                    >
                        <SlidersHorizontal className="size-3.5" />
                        {t("toolbarPrefs.title")}
                    </button>
                </div>
            ) : null}

            {toolMenuOpen ? (
                <div
                    className="pointer-events-auto absolute bottom-[72px] z-30 w-[200px] -translate-x-1/2 rounded-xl border p-1 shadow-xl backdrop-blur"
                    style={{ left: toolMenuX || "50%", background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item }}
                    role="dialog"
                    aria-label={t("canvas.toolbar.toolMode")}
                >
                    {CANVAS_TOOL_OPTIONS.map((option) => {
                        const selected = canvasTool === option.value;
                        return (
                            <button
                                key={option.value}
                                type="button"
                                role="menuitemradio"
                                aria-checked={selected}
                                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--workspace-accent)]"
                                style={selected ? { background: theme.toolbar.activeBg, color: theme.toolbar.activeText } : { color: theme.toolbar.item }}
                                onMouseEnter={(event) => {
                                    if (!selected) event.currentTarget.style.background = theme.toolbar.itemHover;
                                }}
                                onMouseLeave={(event) => {
                                    if (!selected) event.currentTarget.style.background = "transparent";
                                }}
                                onClick={() => {
                                    onCanvasToolChange(option.value);
                                    setToolMenuOpen(false);
                                }}
                            >
                                <span className="grid size-6 shrink-0 place-items-center">{option.value === "select" ? <MousePointer2 className="size-4" /> : <Hand className="size-4" />}</span>
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate">{t(option.labelKey)}</span>
                                    <span className="block truncate text-[length:var(--fs-label)] opacity-55">{t(option.hintKey)}</span>
                                </span>
                                {selected ? <Check className="size-3.5 shrink-0" /> : null}
                            </button>
                        );
                    })}
                </div>
            ) : null}

            <ToolbarPrefsModal open={prefsOpen} onClose={() => setPrefsOpen(false)} />
        </div>
    );
}

function ToolbarButton({
    id,
    label,
    showLabel = false,
    active,
    menu = false,
    hovered,
    activeStyle,
    hoverStyle,
    wrapRef,
    onTipX,
    onHover,
    onClick,
    disabled = false,
    danger = false,
    children,
}: {
    id: string;
    label: string;
    showLabel?: boolean;
    active?: boolean;
    /** 该按钮打开了一个菜单且菜单正开着：高亮 + aria-expanded，与「常驻激活」区分开。 */
    menu?: boolean;
    hovered: string | null;
    activeStyle?: CSSProperties;
    hoverStyle: CSSProperties;
    wrapRef: RefObject<HTMLDivElement | null>;
    onTipX: (x: number) => void;
    onHover: (id: string | null) => void;
    onClick?: (event: ReactMouseEvent<HTMLElement>) => void;
    disabled?: boolean;
    danger?: boolean;
    children: ReactNode;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const expanded = id === "tool-add-node" || id === "tool-mode";

    return (
        <Button
            type="text"
            aria-label={label}
            data-toolbar-id={id}
            aria-expanded={expanded ? Boolean(id === "tool-mode" ? menu : active) : undefined}
            aria-haspopup={expanded ? "dialog" : undefined}
            className={`focus-ring motion-safe:transition motion-safe:enabled:active:scale-95 ${showLabel ? "!h-8 !px-2 text-xs font-medium" : "!h-8 !w-8 !min-w-8 !p-0"}` }
            disabled={disabled}
            style={menu || active ? activeStyle : id === "tool-add-node" ? { background: theme.node.text, color: theme.node.panel } : hovered === id && !disabled ? hoverStyle : { color: danger ? "#f87171" : theme.toolbar.item, opacity: disabled ? 0.35 : 1 }}
            icon={children}
            onMouseEnter={(event) => {
                onHover(id);
                onTipX(getTipX(wrapRef.current, event.currentTarget));
            }}
            onMouseLeave={() => onHover(null)}
            onClick={onClick}
        >{showLabel ? label : undefined}</Button>
    );
}

function Divider({ theme }: { theme: CanvasTheme }) {
    return <div className="mx-1 h-6 w-px" style={{ background: theme.toolbar.border }} />;
}

function CanvasThemeButton({ colorTheme, targetTheme, onThemeChange, children }: { colorTheme: CanvasColorTheme; targetTheme: CanvasColorTheme; onThemeChange: (theme: CanvasColorTheme) => void; children: ReactNode }) {
    const theme = canvasThemes[colorTheme];
    const active = colorTheme === targetTheme;
    const activeStyle = colorTheme === "light" ? { background: "#111111", color: "#ffffff" } : { background: theme.toolbar.activeBg, color: theme.toolbar.activeText };
    const { t } = useTranslation();
    const label = targetTheme === "dark" ? t("topNav.darkTheme") : t("topNav.lightTheme");

    return (
        <AnimatedThemeToggler
            theme={colorTheme}
            targetTheme={targetTheme}
            onThemeChange={onThemeChange}
            className="inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-sm transition"
            style={active ? activeStyle : { color: theme.toolbar.item }}
            aria-label={label}
            title={label}
        >
            {children}
        </AnimatedThemeToggler>
    );
}

function DockTip({ label, x, theme }: { label: string; x: number; theme: CanvasTheme }) {
    return (
        <span className="absolute bottom-[calc(100%+8px)] -translate-x-1/2 rounded-md px-2 py-1 text-xs shadow-lg" style={{ left: x, background: theme.node.text, color: theme.node.panel }}>
            {label}
        </span>
    );
}

function toolLabel(id: string, t: (key: string) => string) {
    if (id === "tool-mode") return t("canvas.toolbar.toolMode");
    if (id === "tool-undo") return t("canvas.undo");
    if (id === "tool-redo") return t("canvas.redo");
    if (id === "tool-focus") return t("canvas.toolbar.focus");
    if (id === "tool-group") return t("canvas.toolbar.group");
    if (id === "tool-extensions") return t("canvas.toolbar.extensions");
    if (id === "tool-add-node") return t("canvas.toolbar.addNode");
    if (id === "tool-style") return t("canvas.toolbar.appearance");
    if (id === "tool-delete") return t("canvas.deleteSelected");
    if (id === "tool-clear") return t("canvas.toolbar.clear");
    return "";
}

function getTipX(wrap: HTMLDivElement | null, target: HTMLElement) {
    if (!wrap) return 0;
    const wrapBox = wrap.parentElement?.getBoundingClientRect() || wrap.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    return box.left - wrapBox.left + box.width / 2;
}
