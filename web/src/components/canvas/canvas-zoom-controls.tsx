import type { ReactNode } from "react";
import { Compass, Focus, HelpCircle, Images, LayoutGrid, LocateFixed, Maximize2, Minus, Plus, Search } from "lucide-react";
import { useState } from "react";
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
    isMiniMapOpen: boolean;
    onToggleMiniMap: () => void;
    onOpenAssets: () => void;
    onInsertAsset: (payload: InsertAssetPayload) => void;
    canvasImages: CanvasNodeData[];
    onFocusImage: (id: string) => void;
};

export function CanvasZoomControls({ scale, onScaleChange, onReset, onFitCanvas, onAutoArrange, onOpenNodeSearch, onEnterFocusMode, isMiniMapOpen, onToggleMiniMap, onOpenAssets, onInsertAsset, canvasImages, onFocusImage }: CanvasZoomControlsProps) {
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const [assetsOpen, setAssetsOpen] = useState(false);
    const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
    const [showCanvasImages, setShowCanvasImages] = useState(false);
    const { t } = useTranslation();
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const dockStyle = { background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item, boxShadow: colorTheme === "dark" ? "0 18px 45px rgba(0,0,0,.32)" : "0 16px 40px rgba(15,23,42,.12)" };
    const activeStyle = { background: theme.toolbar.activeBg, color: theme.toolbar.activeText };
    const stepZoom = (delta: number) => onScaleChange(Math.min(5, Math.max(0.05, Math.round((scale + delta) * 100) / 100)));

    return (
        <div className="absolute bottom-5 left-5 z-50" data-canvas-no-zoom onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <div className="flex h-14 items-center gap-1 rounded-xl border px-2 shadow-lg backdrop-blur" style={dockStyle}>
                <Popover trigger="click" placement="topLeft" open={assetsOpen} onOpenChange={setAssetsOpen} destroyOnHidden content={
                    <div className="flex h-[min(52dvh,390px)] w-[min(320px,calc(100vw-56px))] flex-col">
                        <div className="flex items-center justify-between gap-2 pb-2 pl-3">
                            <div className="flex min-w-0 items-center gap-1">
                                <Button size="small" type={showCanvasImages ? "text" : "default"} aria-pressed={!showCanvasImages} onClick={() => setShowCanvasImages(false)}>{t("canvas.sidePanel.assets")}</Button>
                                <Button size="small" type={showCanvasImages ? "default" : "text"} aria-pressed={showCanvasImages} onClick={() => setShowCanvasImages(true)}>{t("canvas.projectPage.canvasImage")}</Button>
                            </div>
                            {!showCanvasImages && <Button type="text" size="small" onClick={() => { setAssetsOpen(false); onOpenAssets(); }}>{t("canvas.assetPicker.title")}</Button>}
                        </div>
                        <div className="min-h-0 flex-1">
                            {showCanvasImages ? (
                                <div className="thin-scrollbar h-full overflow-auto">
                                    {canvasImages.map((node) => (
                                        <button key={node.id} type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-[var(--surface-card-hover)]"
                                            onClick={() => { setAssetsOpen(false); onFocusImage(node.id); }}>
                                            <Focus aria-hidden className="size-4 shrink-0" />
                                            <span className="truncate">{node.title || t("canvas.node.untitled")}</span>
                                        </button>
                                    ))}
                                    {!canvasImages.length && <p className="px-2 py-4 text-sm text-muted-foreground">{t("canvas.projectPage.noImageToSave")}</p>}
                                </div>
                            ) : <CanvasAssetsTab theme={theme} onInsert={onInsertAsset} />}
                        </div>
                    </div>
                }>
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
                <Tooltip title={t("canvas.resetView")}>
                    <Button type="text" className="!h-8 !w-8 !min-w-8 !p-0" style={{ color: theme.toolbar.item }} icon={<Focus className="size-4" />} onClick={onReset} aria-label={t("canvas.resetView")} />
                </Tooltip>
                <Tooltip title={t("canvas.zoom")}>
                    <input
                        type="range"
                        min="5"
                        max="500"
                        step="1"
                        value={Math.round(scale * 100)}
                        className="w-24"
                        style={{ accentColor: theme.node.activeStroke }}
                        onChange={(event) => onScaleChange(Number(event.target.value) / 100)}
                        aria-label={t("canvas.zoom")}
                    />
                </Tooltip>
                <Popover trigger="click" placement="top" open={zoomMenuOpen} onOpenChange={setZoomMenuOpen} destroyOnHidden content={
                    <div className="flex w-36 flex-col gap-1" data-canvas-no-zoom>
                        <div className="flex items-center justify-between gap-1 pb-1">
                            <Button size="small" type="text" icon={<Minus className="size-3.5" />} aria-label={t("canvas.editors.zoomOut")} onClick={() => stepZoom(-0.1)} />
                            <span className="text-xs font-medium tabular-nums">{Math.round(scale * 100)}%</span>
                            <Button size="small" type="text" icon={<Plus className="size-3.5" />} aria-label={t("canvas.editors.zoomIn")} onClick={() => stepZoom(0.1)} />
                        </div>
                        <div className="grid grid-cols-2 gap-1 border-t pt-1" style={{ borderColor: theme.toolbar.border }}>
                            {[0.5, 1, 1.5, 2].map((preset) => <button key={preset} type="button" className="rounded-md px-2 py-1 text-xs tabular-nums hover:bg-black/5 dark:hover:bg-white/10" style={Math.abs(scale - preset) < 0.01 ? activeStyle : { color: theme.node.text }} onClick={() => { onScaleChange(preset); setZoomMenuOpen(false); }}>{Math.round(preset * 100)}%</button>)}
                        </div>
                        <div className="flex flex-col gap-0.5 border-t pt-1" style={{ borderColor: theme.toolbar.border }}>
                            {onFitCanvas ? <button type="button" className="flex items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs hover:bg-black/5 dark:hover:bg-white/10" style={{ color: theme.node.text }} onClick={() => { onFitCanvas(); setZoomMenuOpen(false); }}><LocateFixed className="size-3.5" />{t("canvas.toolbar.fitAll")}</button> : null}
                            <button type="button" className="flex items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs transition hover:bg-black/5 dark:hover:bg-white/10" style={{ color: theme.node.text }} onClick={() => { (onAutoArrange ?? requestCanvasAutoArrange)(); setZoomMenuOpen(false); }}><LayoutGrid className="size-3.5 shrink-0" /><span>{t("canvas.nodeToolbar.autoArrange")}</span></button>
                            <button type="button" className="flex items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs hover:bg-black/5 dark:hover:bg-white/10" style={{ color: theme.node.text }} onClick={() => { onReset(); setZoomMenuOpen(false); }}><Focus className="size-3.5" />{t("canvas.resetView")}</button>
                        </div>
                    </div>
                }>
                    <button type="button" className="h-7 min-w-11 rounded-md px-1.5 text-right text-xs tabular-nums hover:bg-black/5 dark:hover:bg-white/10" style={zoomMenuOpen ? activeStyle : { color: theme.node.muted }} aria-expanded={zoomMenuOpen} aria-label={t("canvas.zoom")}>{Math.round(scale * 100)}%</button>
                </Popover>
                <Tooltip title={`${t("canvas.sidePanel.searchNodes")} (Ctrl+F)`}>
                    <Button type="text" className="!h-8 !w-8 !min-w-8 !p-0" style={{ color: theme.toolbar.item }} icon={<Search className="size-4" />} onClick={onOpenNodeSearch ?? openCanvasNodeSearch} aria-label={t("canvas.sidePanel.searchNodes")} />
                </Tooltip>
                {onEnterFocusMode ? <Tooltip title={t("canvas.toolbar.focusMode")}><Button type="text" className="!h-8 !w-8 !min-w-8 !p-0" style={{ color: theme.toolbar.item }} icon={<Maximize2 className="size-4" />} onClick={onEnterFocusMode} aria-label={t("canvas.toolbar.focusMode")} /></Tooltip> : null}
                <Tooltip title={t("canvas.shortcuts")}>
                    <Button type="text" className="!h-8 !w-8 !min-w-8 !p-0" style={shortcutsOpen ? activeStyle : { color: theme.toolbar.item }} icon={<HelpCircle className="size-4" />} onClick={() => setShortcutsOpen(true)} aria-label={t("canvas.shortcuts")} />
                </Tooltip>
            </div>
            <Modal destroyOnHidden title={t("canvas.shortcuts")} open={shortcutsOpen} onCancel={() => setShortcutsOpen(false)} footer={null} centered>
                <div className="space-y-3 border-t pt-4 text-sm" style={{ borderColor: theme.node.stroke }}>
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
