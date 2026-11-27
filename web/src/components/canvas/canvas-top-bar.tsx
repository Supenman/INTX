import { useEffect, useRef, useState } from "react";
import { Archive, Bot, Clapperboard, Download, Ellipsis, History, Home, Images, Menu, PanelLeftClose, PanelLeftOpen, Plus, Redo2, Scissors, Trash2, Undo2, Upload, Workflow } from "lucide-react";
import { Button, Dropdown, Modal, Popover, Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { UserStatusActions } from "@/components/layout/user-status-actions";
import { canvasThemes } from "@/lib/canvas-theme";
import { restoreCanvasFocus } from "@/lib/canvas/canvas-node-focus";
import { useThemeStore } from "@/stores/use-theme-store";
import { SnapshotStorageStatus } from "@/components/layout/snapshot-storage-status";
import { useCanvasSidePanelStore } from "@/stores/use-canvas-side-panel-store";

export function CanvasTopBar({
    title,
    titleDraft,
    isTitleEditing,
    onTitleDraftChange,
    onStartTitleEditing,
    onFinishTitleEditing,
    onCancelTitleEditing,
    canUndo,
    canRedo,
    onHome,
    onProjects,
    onCreateProject,
    onDeleteProject,
    onExportProject,
    onImportImage,
    onOpenAssetPicker,
    canSaveWorkflow,
    onSaveWorkflow,
    onInsertWorkflow,
    canPreviewChain,
    onPreviewChain,
    onOpenGenerationHistory,
    onOpenStoryboard,
    onOpenEditingStudio,
    onArchiveToAssets,
    onOpenPlugins,
    onUndo,
    onRedo,
    agentOpen,
    compactAgentStatus,
    onToggleAgent,
}: {
    title: string;
    titleDraft: string;
    isTitleEditing: boolean;
    onTitleDraftChange: (value: string) => void;
    onStartTitleEditing: () => void;
    onFinishTitleEditing: () => void;
    onCancelTitleEditing: () => void;
    canUndo: boolean;
    canRedo: boolean;
    onHome: () => void;
    onProjects: () => void;
    onCreateProject: () => void;
    onDeleteProject: () => void;
    onExportProject: () => void;
    onImportImage: () => void;
    onOpenAssetPicker: () => void;
    canSaveWorkflow: boolean;
    onSaveWorkflow: () => void;
    onInsertWorkflow: () => void;
    canPreviewChain: boolean;
    onPreviewChain: () => void;
    onOpenGenerationHistory: () => void;
    onOpenStoryboard: () => void;
    onOpenEditingStudio: () => void;
    onArchiveToAssets: () => void;
    onOpenPlugins: () => void;
    onUndo: () => void;
    onRedo: () => void;
    agentOpen: boolean;
    compactAgentStatus: { connected: boolean; enabled: boolean; activity: string };
    onToggleAgent: () => void;
}) {
    const colorTheme = useThemeStore((state) => state.theme);
    const { t } = useTranslation();
    const isApplePlatform = /Mac|iPhone|iPad/.test(navigator.platform);
    const theme = canvasThemes[colorTheme];
    const titleRef = useRef<HTMLDivElement>(null);
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const sidePanelOpen = useCanvasSidePanelStore((state) => state.panelOpen);
    const toggleSidePanel = useCanvasSidePanelStore((state) => state.togglePanel);
    const workflowItems = [
        { key: "save-workflow", icon: <Download className="size-4" />, label: t("canvas.workflow.save"), disabled: !canSaveWorkflow, onClick: onSaveWorkflow },
        { key: "insert-workflow", icon: <Upload className="size-4" />, label: t("canvas.workflow.insert"), onClick: onInsertWorkflow },
        { key: "preview-chain", label: t("canvas.chain.preview"), disabled: !canPreviewChain, onClick: onPreviewChain },
    ];

    useEffect(() => {
        if (!isTitleEditing) return;
        const close = (event: PointerEvent) => {
            if (!titleRef.current?.contains(event.target as Node)) onFinishTitleEditing();
        };
        document.addEventListener("pointerdown", close, true);
        return () => document.removeEventListener("pointerdown", close, true);
    }, [isTitleEditing, onFinishTitleEditing]);

    return (
        <>
            <div className="pointer-events-none absolute left-0 right-0 top-0 z-50 flex h-14 items-start justify-between gap-2 px-2 pt-2" style={{ background: `linear-gradient(to bottom, ${theme.canvas.background} 65%, transparent)` }}>
                <div className="pointer-events-auto flex min-w-0 items-center gap-1 px-1.5 py-1" style={{ color: theme.node.text }}>
                    <Tooltip title={t("navigation.home")}>
                        <button type="button" onClick={onHome} aria-label={t("navigation.home")} className="grid size-8 shrink-0 place-items-center rounded-lg transition duration-150 hover:bg-black/5 dark:hover:bg-white/10 motion-safe:active:scale-95" style={{ color: theme.node.text }}>
                            <Home className="size-4" />
                        </button>
                    </Tooltip>
                    <Tooltip title={sidePanelOpen ? t("canvas.collapsePanel") : t("canvas.expandPanel")}>
                        <button type="button" onClick={toggleSidePanel} aria-expanded={sidePanelOpen} aria-label={sidePanelOpen ? t("canvas.collapsePanel") : t("canvas.expandPanel")} className="grid size-8 shrink-0 place-items-center rounded-lg transition duration-150 hover:bg-black/5 dark:hover:bg-white/10 motion-safe:active:scale-95" style={{ color: theme.node.text }}>
                            {sidePanelOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
                        </button>
                    </Tooltip>
                    <Dropdown
                        trigger={["click"]}
                        menu={{
                            items: [
                                // 分组标题让用户能按用途定位，而不是在一长列里逐条读。
                                {
                                    type: "group",
                                    label: t("canvas.menuGroup.project"),
                                    children: [
                                        { key: "home", icon: <Home className="size-4" />, label: t("navigation.home"), onClick: onHome },
                                        { key: "projects", icon: <Images className="size-4" />, label: t("canvas.projects"), onClick: onProjects },
                                        { key: "new", icon: <Plus className="size-4" />, label: t("canvas.create"), onClick: onCreateProject },
                                        { key: "delete", danger: true, icon: <Trash2 className="size-4" />, label: t("canvas.deleteCurrent"), onClick: onDeleteProject },
                                    ],
                                },
                                {
                                    type: "group",
                                    label: t("canvas.menuGroup.file"),
                                    children: [
                                        { key: "import", icon: <Upload className="size-4" />, label: t("canvas.importMedia"), onClick: onImportImage },
                                        { key: "insert-assets", icon: <Images className="size-4" />, label: t("canvas.assetPicker.open"), onClick: onOpenAssetPicker },
                                        { key: "export", icon: <Download className="size-4" />, label: t("canvas.exportCurrent"), onClick: onExportProject },
                                    ],
                                },
                                {
                                    type: "group",
                                    label: t("canvas.menuGroup.produce"),
                                    children: [
                                        { key: "storyboard", icon: <Clapperboard className="size-4" />, label: t("canvas.storyboard.entry"), onClick: onOpenStoryboard },
                                        { key: "archive-assets", icon: <Archive className="size-4" />, label: t("canvas.projectPage.archiveToAssets"), onClick: onArchiveToAssets },
                                        { key: "editing-studio", icon: <Scissors className="size-4" />, label: t("editingStudio.title"), onClick: onOpenEditingStudio },
                                    ],
                                },
                                {
                                    type: "group",
                                    label: t("canvas.menuGroup.edit"),
                                    // 撤销/重做保留在此：主工具栏对应按钮可被偏好隐藏，这里是没有可见按钮时的兜底入口。
                                    children: [
                                        { key: "undo", disabled: !canUndo, icon: <Undo2 className="size-4" />, label: <MenuLabel text={t("canvas.undo")} shortcut={isApplePlatform ? "⌘ Z" : "Ctrl+Z"} />, onClick: onUndo },
                                        { key: "redo", disabled: !canRedo, icon: <Redo2 className="size-4" />, label: <MenuLabel text={t("canvas.redo")} shortcut={isApplePlatform ? "⌘ ⇧ Z / ⌘ Y" : "Ctrl+Shift+Z / Ctrl+Y"} />, onClick: onRedo },
                                    ],
                                },
                            ],
                        }}
                    >
                        <button type="button" className="grid size-8 shrink-0 place-items-center rounded-lg transition hover:bg-black/5 dark:hover:bg-white/10" style={{ color: theme.node.text }} aria-label={t("canvas.openMenu")}>
                            <Menu className="size-4" />
                        </button>
                    </Dropdown>

                    <div ref={titleRef} className="flex min-w-0 items-center gap-2">
                        {isTitleEditing ? (
                            <input
                                autoFocus
                                maxLength={64}
                                value={titleDraft}
                                onFocus={(event) => event.currentTarget.select()}
                                onChange={(event) => onTitleDraftChange(event.target.value)}
                                onBlur={onFinishTitleEditing}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") { event.stopPropagation(); onFinishTitleEditing(); }
                                    if (event.key === "Escape") { event.stopPropagation(); onCancelTitleEditing(); }
                                }}
                                className="w-full min-w-0 max-w-[280px] bg-transparent p-0 text-left text-base font-semibold outline-none"
                                style={{ color: theme.node.text }}
                            />
                        ) : (
                            <button
                                type="button"
                                className="min-w-0 max-w-[280px] truncate text-left text-sm font-semibold transition-opacity hover:opacity-75"
                                onClick={onStartTitleEditing}
                                title={t("canvas.renameHint")}
                            >
                                {title}
                            </button>
                        )}
                    </div>
                    <div className="hidden shrink-0 items-center gap-2 @min-[760px]:flex">
                        <SnapshotStorageStatus kind="projects" />
                    </div>
                </div>

                <div className="pointer-events-auto flex shrink-0 items-center gap-1 p-1" style={{ color: theme.node.text }}>
                    <Dropdown trigger={["click"]} menu={{ items: workflowItems }}>
                        <Button type="text" className="!h-8 !rounded-lg" aria-label={t("canvas.workflow.entry")} title={t("canvas.workflow.entry")} icon={<Workflow className="size-4" />}>
                            <span className="hidden @min-[600px]:inline">{t("canvas.workflow.entry")}</span>
                        </Button>
                    </Dropdown>
                    <Button
                        type="text"
                        className="!h-8 !rounded-lg"
                        aria-label="Agent"
                        aria-pressed={agentOpen}
                        title={compactAgentStatus.connected ? t("canvas.agentConnected", { kind: t("agent.kind.opencode") }) : compactAgentStatus.enabled ? t("canvas.agentConnecting", { kind: t("agent.kind.opencode"), activity: compactAgentStatus.activity || t("canvas.connecting") }) : "Agent"}
                        style={agentOpen ? { background: theme.toolbar.activeBg, color: theme.toolbar.activeText } : undefined}
                        icon={<span className="relative inline-flex items-center justify-center"><Bot className="size-4" />{compactAgentStatus.connected || compactAgentStatus.enabled ? <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full" style={{ background: compactAgentStatus.connected ? "#22c55e" : "#f59e0b" }} /> : null}</span>}
                        onClick={onToggleAgent}
                    >
                        <span className="hidden @min-[600px]:inline">Agent</span>
                    </Button>
                    <Tooltip title={t("canvas.generationHistory.entry")}>
                        <Button type="text" className="!h-8 !w-8 !min-w-8 !rounded-lg !p-0" aria-label={t("canvas.generationHistory.entry")} icon={<History className="size-4" />} onClick={onOpenGenerationHistory} />
                    </Tooltip>
                    <Popover trigger="click" placement="bottomRight" content={<UserStatusActions variant="canvas" onOpenShortcuts={() => setShortcutsOpen(true)} onOpenPlugins={onOpenPlugins} />}>
                        <Button type="text" className="!h-8 !w-8 !min-w-8 !p-0" icon={<Ellipsis className="size-4" />} aria-label={t("canvas.imageTools.more")} title={t("canvas.imageTools.more")} />
                    </Popover>
                </div>
            </div>
            <Modal destroyOnHidden title={t("canvas.shortcuts")} open={shortcutsOpen} onCancel={() => setShortcutsOpen(false)} afterClose={restoreCanvasFocus} footer={null} centered>
                <div className="space-y-2 border-t pt-4 text-sm" style={{ borderColor: theme.node.stroke }}>
                    <Shortcut keys={["Space", t("canvas.shortcut.drag")]} value={t("canvas.shortcut.toggleTool")} />
                    <Shortcut keys={[t("canvas.shortcut.wheel")]} value={t("canvas.shortcut.zoom")} />
                    <Shortcut keys={[t("canvas.shortcut.zoomSlider")]} value={t("canvas.shortcut.preciseZoom")} />
                    <Shortcut keys={[t("canvas.shortcut.drag")]} value={t("canvas.shortcut.boxSelect")} />
                    <Shortcut keys={["Shift / Cmd", t("canvas.shortcut.click")]} value={t("canvas.shortcut.addSelection")} />
                    <Shortcut keys={["Ctrl / Cmd", "A"]} value={t("canvas.shortcut.selectAll")} />
                    <Shortcut keys={["Ctrl / Cmd", "C / V"]} value={t("canvas.shortcut.copyPaste")} />
                    <Shortcut keys={["Ctrl / Cmd", "G"]} value={t("canvas.shortcut.group")} />
                    <Shortcut keys={["Ctrl / Cmd", "Shift", "G"]} value={t("canvas.shortcut.ungroup")} />
                    <Shortcut keys={["Ctrl / Cmd", "Z"]} value={t("canvas.undo")} />
                    <Shortcut keys={["Ctrl / Cmd", "Shift", "Z"]} value={t("canvas.redo")} />
                    <Shortcut keys={["Ctrl / Cmd", "Y"]} value={t("canvas.redo")} />
                    <Shortcut keys={["Delete / Backspace"]} value={t("canvas.shortcut.delete")} />
                    <Shortcut keys={["Esc"]} value={t("canvas.shortcut.escape")} />
                    <Shortcut keys={[t("canvas.shortcut.dropMedia")]} value={t("canvas.shortcut.upload")} />
                </div>
            </Modal>
        </>
    );
}

function MenuLabel({ text, shortcut }: { text: string; shortcut: string }) {
    return (
        <span className="flex min-w-36 items-center justify-between gap-8">
            <span>{text}</span>
            <span className="text-xs opacity-45">{shortcut}</span>
        </span>
    );
}

function CompactAgentStatus({ status, onClick }: { status: { connected: boolean; enabled: boolean; activity: string }; onClick: () => void }) {
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const { t } = useTranslation();
    const kind = t("agent.kind.opencode");
    const label = status.connected ? t("canvas.agentConnected", { kind }) : status.enabled ? t("canvas.agentConnecting", { kind, activity: status.activity || t("canvas.connecting") }) : t("canvas.agentDisconnected", { kind });
    const dotColor = status.connected ? "#22c55e" : status.enabled ? "#f59e0b" : theme.node.muted;
    return (
        <button type="button" className="flex h-8 items-center gap-1.5 text-xs transition hover:opacity-75" style={{ color: status.connected ? "#16a34a" : status.enabled ? "#d97706" : theme.node.muted }} onClick={onClick} title={t("canvas.openAgent")}>
            <span className="size-2 rounded-full" style={{ background: dotColor }} />
            <span className="max-w-[140px] truncate">{label}</span>
        </button>
    );
}

function Shortcut({ keys, value }: { keys: string[]; value: string }) {
    return (
        <div className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-6 rounded-lg px-1 py-1.5">
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                {keys.map((key, index) => (
                    <span key={`${key}-${index}`} className="flex items-center gap-1.5">
                        {index ? <span className="text-xs opacity-35">+</span> : null}
                        <kbd
                            className="min-w-9 rounded-md border px-2.5 py-1.5 text-center text-xs font-medium leading-none shadow-[inset_0_-1px_0_rgba(0,0,0,.08),0_1px_2px_rgba(0,0,0,.06)]"
                            style={{ borderColor: "rgba(120,113,108,.28)", background: "linear-gradient(#fff, rgba(245,245,244,.92))", color: "rgb(68,64,60)" }}
                        >
                            {key}
                        </kbd>
                    </span>
                ))}
            </span>
            <span className="text-right text-sm opacity-55">{value}</span>
        </div>
    );
}
