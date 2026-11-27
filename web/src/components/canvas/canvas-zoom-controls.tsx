import type { ReactNode } from "react";
import { Compass, Focus, Grid3X3, HelpCircle, Images, LayoutGrid, LocateFixed, Maximize2, Minus, Plus, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Modal, Popover, Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { openCanvasNodeSearch } from "@/components/canvas/canvas-node-search-modal";
import { requestCanvasAutoArrange } from "@/lib/canvas/canvas-auto-arrange";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasAssetsTab } from "./canvas-side-panel";
import type { InsertAssetPayload } from "./asset-picker-modal";
import type { CanvasNodeData } from "@/types/canvas";

type CanvasZoomControlsProps = {
    scale: number;
    onScaleChange: (scale: number) => void;
    onReset: () => void;
    onFitCanvas?: () => void;
    onAutoArrange?: () => void;
    onOpenNodeSearch?: () => void;
    onEnterFocusMode?: () => void;
    snapToGrid?: boolean;
    onSnapToGridChange?: (enabled: boolean) => void;
    isMiniMapOpen: boolean;
    onToggleMiniMap: () => void;
    onOpenAssets: () => void;
    onInsertAsset: (payload: InsertAssetPayload) => void;
    canvasImages: CanvasNodeData[];
    onFocusImage: (id: string) => void;
};

const MIN_SCALE = 0.05;
const MAX_SCALE = 5;
const ZOOM_PRESETS = [0.5, 1, 1.5, 2] as const;

export function CanvasZoomControls({
    scale,
    onScaleChange,
    onReset,
    onFitCanvas,
    onAutoArrange,
    onOpenNodeSearch,
    onEnterFocusMode,
    snapToGrid,
    onSnapToGridChange,
    isMiniMapOpen,
    onToggleMiniMap,
    onOpenAssets,
    onInsertAsset,
    canvasImages,
    onFocusImage,
}: CanvasZoomControlsProps) {
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const [assetsOpen, setAssetsOpen] = useState(false);
    const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
    const [showCanvasImages, setShowCanvasImages] = useState(false);
    const [percentDraft, setPercentDraft] = useState(() => String(Math.round(scale * 100)));
    const inputRef = useRef<HTMLInputElement>(null);
    const { t } = useTranslation();
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const dockStyle = {
        background: theme.toolbar.panel,
        borderColor: theme.toolbar.border,
        color: theme.toolbar.item,
        boxShadow: "var(--shadow-lg)",
    };
    const activeStyle = { background: theme.toolbar.activeBg, color: theme.toolbar.activeText };
    const percent = Math.round(scale * 100);

    useEffect(() => {
        if (document.activeElement !== inputRef.current) setPercentDraft(String(percent));
    }, [percent, zoomMenuOpen]);

    const commitScale = (next: number) => {
        const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(next * 100) / 100));
        onScaleChange(clamped);
    };
    const stepZoom = (delta: number) => commitScale(scale + delta);
    const commitDraft = () => {
        const parsed = Number.parseFloat(percentDraft.replace(/[^\d.]/g, ""));
        if (!Number.isFinite(parsed)) {
            setPercentDraft(String(percent));
            return;
        }
        commitScale(parsed / 100);
    };

    return (
        <div
            className="absolute bottom-4 left-4 z-50"
            data-canvas-no-zoom
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <div className="flex h-12 items-center gap-0.5 rounded-2xl border px-1.5 backdrop-blur-xl" style={dockStyle}>
                <Popover
                    trigger="click"
                    placement="topLeft"
                    open={assetsOpen}
                    onOpenChange={setAssetsOpen}
                    destroyOnHidden
                    content={
                        <div className="flex h-[min(52dvh,390px)] w-[min(320px,calc(100vw-56px))] flex-col">
                            <div className="flex items-center justify-between gap-2 pb-2 pl-3">
                                <div className="flex min-w-0 items-center gap-1">
                                    <Button size="small" type={showCanvasImages ? "text" : "default"} aria-pressed={!showCanvasImages} onClick={() => setShowCanvasImages(false)}>
                                        {t("canvas.sidePanel.assets")}
                                    </Button>
                                    <Button size="small" type={showCanvasImages ? "default" : "text"} aria-pressed={showCanvasImages} onClick={() => setShowCanvasImages(true)}>
                                        {t("canvas.projectPage.canvasImage")}
                                    </Button>
                                </div>
                                {!showCanvasImages && (
                                    <Button type="text" size="small" onClick={() => { setAssetsOpen(false); onOpenAssets(); }}>
                                        {t("canvas.assetPicker.title")}
                                    </Button>
                                )}
                            </div>
                            <div className="min-h-0 flex-1">
                                {showCanvasImages ? (
                                    <div className="thin-scrollbar h-full overflow-auto">
                                        {canvasImages.map((node) => (
                                            <button
                                                key={node.id}
                                                type="button"
                                                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-[var(--surface-card-hover)]"
                                                onClick={() => { setAssetsOpen(false); onFocusImage(node.id); }}
                                            >
                                                <Focus aria-hidden className="size-4 shrink-0" />
                                                <span className="truncate">{node.title || t("canvas.node.untitled")}</span>
                                            </button>
                                        ))}
                                        {!canvasImages.length && <p className="px-2 py-4 text-sm text-muted-foreground">{t("canvas.projectPage.noImageToSave")}</p>}
                                    </div>
                                ) : (
                                    <CanvasAssetsTab theme={theme} onInsert={onInsertAsset} />
                                )}
                            </div>
                        </div>
                    }
                >
                    <Button type="text" className="!h-8 !w-8 !min-w-8 !p-0" style={assetsOpen ? activeStyle : { color: theme.toolbar.item }} icon={<Images className="size-4" />} aria-expanded={assetsOpen} aria-label={t("canvas.sidePanel.assets")} title={t("canvas.sidePanel.assets")} />
                </Popover>

                <Tooltip title={isMiniMapOpen ? t("canvas.miniMapClose") : t("canvas.miniMapOpen")}>
                    <Button
                        type="text"
                        className="!h-8 !w-8 !min-w-8 !p-0"
                        style={isMiniMapOpen ? activeStyle : { color: theme.toolbar.item }}
                        icon={<Compass className="size-4" />}
                        onClick={onToggleMiniMap}
                        aria-label={isMiniMapOpen ? t("canvas.miniMapClose") : t("canvas.miniMapOpen")}
                    />
                </Tooltip>

                {onSnapToGridChange ? (
                    <Tooltip title={t("canvas.toolbar.snapToGrid", { size: 16 })}>
                        <Button
                            type="text"
                            className="!h-8 !w-8 !min-w-8 !p-0"
                            style={snapToGrid ? activeStyle : { color: theme.toolbar.item }}
                            icon={<Grid3X3 className="size-4" />}
                            onClick={() => onSnapToGridChange(!snapToGrid)}
                            aria-pressed={Boolean(snapToGrid)}
                            aria-label={t("canvas.toolbar.snapToGrid", { size: 16 })}
                        />
                    </Tooltip>
                ) : null}

                <Tooltip title={`${t("canvas.resetView")} (Shift+1)`}>
                    <Button
                        type="text"
                        className="!h-8 !w-8 !min-w-8 !p-0"
                        style={{ color: theme.toolbar.item }}
                        icon={<Focus className="size-4" />}
                        onClick={onFitCanvas ?? onReset}
                        aria-label={t("canvas.resetView")}
                    />
                </Tooltip>

                <Tooltip title={t("canvas.nodeToolbar.autoArrange")}>
                    <Button
                        type="text"
                        className="!h-8 !w-8 !min-w-8 !p-0"
                        style={{ color: theme.toolbar.item }}
                        icon={<LayoutGrid className="size-4" />}
                        onClick={onAutoArrange ?? requestCanvasAutoArrange}
                        aria-label={t("canvas.nodeToolbar.autoArrange")}
                    />
                </Tooltip>

                <div className="mx-0.5 h-5 w-px" style={{ background: theme.toolbar.border }} />

                <Popover
                    trigger="click"
                    placement="top"
                    open={zoomMenuOpen}
                    onOpenChange={setZoomMenuOpen}
                    destroyOnHidden
                    content={
                        <div className="flex w-44 flex-col gap-1.5" data-canvas-no-zoom>
                            <label
                                className="flex h-8 items-center gap-1 rounded-[var(--r-md)] border px-2 text-xs"
                                style={{ borderColor: theme.toolbar.border, background: theme.node.fill, color: theme.node.text }}
                            >
                                <input
                                    ref={inputRef}
                                    type="text"
                                    inputMode="decimal"
                                    value={percentDraft}
                                    aria-label={t("canvas.zoom")}
                                    className="min-w-0 flex-1 bg-transparent text-center font-medium tabular-nums outline-none"
                                    onFocus={(event) => event.currentTarget.select()}
                                    onChange={(event) => setPercentDraft(event.target.value)}
                                    onBlur={commitDraft}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter") {
                                            event.preventDefault();
                                            commitDraft();
                                            setZoomMenuOpen(false);
                                        } else if (event.key === "Escape") {
                                            event.preventDefault();
                                            setPercentDraft(String(percent));
                                            setZoomMenuOpen(false);
                                        }
                                    }}
                                />
                                <span className="opacity-55" aria-hidden>%</span>
                            </label>
                            <div className="flex flex-col gap-0.5">
                                <button
                                    type="button"
                                    className="flex items-center justify-between rounded-md px-2 py-1 text-left text-xs transition hover:bg-[var(--surface-card-hover)]"
                                    style={{ color: theme.node.text }}
                                    onClick={() => stepZoom(0.1)}
                                >
                                    <span className="inline-flex items-center gap-1.5"><Plus className="size-3.5" />{t("canvas.editors.zoomIn")}</span>
                                    <span className="text-[length:var(--fs-label)] opacity-55">Ctrl +</span>
                                </button>
                                <button
                                    type="button"
                                    className="flex items-center justify-between rounded-md px-2 py-1 text-left text-xs transition hover:bg-[var(--surface-card-hover)]"
                                    style={{ color: theme.node.text }}
                                    onClick={() => stepZoom(-0.1)}
                                >
                                    <span className="inline-flex items-center gap-1.5"><Minus className="size-3.5" />{t("canvas.editors.zoomOut")}</span>
                                    <span className="text-[length:var(--fs-label)] opacity-55">Ctrl −</span>
                                </button>
                                <button
                                    type="button"
                                    className="flex items-center justify-between rounded-md px-2 py-1 text-left text-xs transition hover:bg-[var(--surface-card-hover)]"
                                    style={{ color: theme.node.text }}
                                    onClick={() => { (onFitCanvas ?? onReset)(); setZoomMenuOpen(false); }}
                                >
                                    <span className="inline-flex items-center gap-1.5"><LocateFixed className="size-3.5" />{t("canvas.toolbar.fitAll")}</span>
                                    <span className="text-[length:var(--fs-label)] opacity-55">Shift 1</span>
                                </button>
                            </div>
                            <div className="grid grid-cols-4 gap-1 border-t pt-1.5" style={{ borderColor: theme.toolbar.border }}>
                                {ZOOM_PRESETS.map((preset) => (
                                    <button
                                        key={preset}
                                        type="button"
                                        className="rounded-md px-1 py-1 text-center text-[length:var(--fs-label)] tabular-nums transition hover:bg-[var(--surface-card-hover)]"
                                        style={Math.abs(scale - preset) < 0.01 ? activeStyle : { color: theme.node.text }}
                                        onClick={() => { commitScale(preset); setZoomMenuOpen(false); }}
                                    >
                                        {Math.round(preset * 100)}%
                                    </button>
                                ))}
                            </div>
                        </div>
                    }
                >
                    <button
                        type="button"
                        className="focus-ring inline-flex h-8 min-w-12 cursor-pointer items-center justify-center rounded-lg px-2 text-xs font-medium tabular-nums transition hover:bg-[var(--surface-card-hover)]"
                        style={zoomMenuOpen ? activeStyle : { color: theme.node.text }}
                        aria-expanded={zoomMenuOpen}
                        aria-label={t("canvas.zoom")}
                    >
                        <span>{percent}</span>
                        <span className="ml-0.5 text-[length:var(--fs-label)] opacity-55">%</span>
                    </button>
                </Popover>

                <div className="mx-0.5 h-5 w-px" style={{ background: theme.toolbar.border }} />

                <Tooltip title={`${t("canvas.sidePanel.searchNodes")} (Ctrl+F)`}>
                    <Button type="text" className="!h-8 !w-8 !min-w-8 !p-0" style={{ color: theme.toolbar.item }} icon={<Search className="size-4" />} onClick={onOpenNodeSearch ?? openCanvasNodeSearch} aria-label={t("canvas.sidePanel.searchNodes")} />
                </Tooltip>
                {onEnterFocusMode ? (
                    <Tooltip title={t("canvas.toolbar.focusMode")}>
                        <Button type="text" className="!h-8 !w-8 !min-w-8 !p-0" style={{ color: theme.toolbar.item }} icon={<Maximize2 className="size-4" />} onClick={onEnterFocusMode} aria-label={t("canvas.toolbar.focusMode")} />
                    </Tooltip>
                ) : null}
                <Tooltip title={t("canvas.shortcuts")}>
                    <Button type="text" className="!h-8 !w-8 !min-w-8 !p-0" style={shortcutsOpen ? activeStyle : { color: theme.toolbar.item }} icon={<HelpCircle className="size-4" />} onClick={() => setShortcutsOpen(true)} aria-label={t("canvas.shortcuts")} />
                </Tooltip>
            </div>

            <Modal destroyOnHidden title={t("canvas.shortcuts")} open={shortcutsOpen} onCancel={() => setShortcutsOpen(false)} footer={null} centered>
                <div className="space-y-3 border-t pt-4 text-sm" style={{ borderColor: theme.node.stroke }}>
                    <Shortcut label="V / H" value={`${t("canvas.toolbar.select")} / ${t("canvas.toolbar.pan")}`} />
                    <Shortcut label={`Space + ${t("canvas.shortcut.drag")}`} value={t("canvas.shortcut.toggleTool")} />
                    <Shortcut label={t("canvas.shortcut.wheel")} value={t("canvas.shortcut.zoom")} />
                    <Shortcut label={t("canvas.shortcut.drag")} value={t("canvas.shortcut.boxSelect")} />
                    <Shortcut label={`Shift / Cmd + ${t("canvas.shortcut.click")}`} value={t("canvas.shortcut.addSelection")} />
                    <Shortcut label="Ctrl / Cmd + C / V" value={t("canvas.shortcut.copyPasteNodes")} />
                    <Shortcut label="Ctrl / Cmd + G" value={t("canvas.shortcut.group")} />
                    <Shortcut label="Ctrl / Cmd + Shift + G" value={t("canvas.shortcut.ungroup")} />
                    <Shortcut label="Ctrl / Cmd + F" value={t("canvas.shortcut.searchNodes")} />
                    <Shortcut label="Ctrl / Cmd + +/- / 0" value={t("canvas.shortcut.zoomInOut")} />
                    <Shortcut label="Shift + 1 / 2" value={t("canvas.shortcut.fitOrFocus")} />
                    <Shortcut label="↑ / ↓ / ← / →" value={t("canvas.shortcut.nudge")} />
                    <Shortcut label="Delete / Backspace" value={t("canvas.shortcut.delete")} />
                </div>
            </Modal>
        </div>
    );
}

function Shortcut({ label, value }: { label: ReactNode; value: string }) {
    return (
        <div className="flex items-center justify-between gap-4">
            <span className="text-base font-medium">{label}</span>
            <span className="opacity-60">{value}</span>
        </div>
    );
}
