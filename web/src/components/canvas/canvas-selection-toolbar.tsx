import { useLayoutEffect, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalSpaceAround, AlignStartHorizontal, AlignStartVertical, AlignVerticalSpaceAround, Download, FileDown, Group, Ungroup } from "lucide-react";
import { Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { nodeBounds } from "@/lib/canvas/canvas-node-geometry";
import { buildToolContext, toolView } from "@/lib/canvas/tool-wiring";
import { isBatchExportable } from "@/domain/asset/batch-export";
import { useBatchExport } from "@/hooks/use-batch-export";
import { useToolbarPrefs } from "@/hooks/use-toolbar-prefs";
import type { AlignAxis, DistributeAxis } from "@/lib/canvas/canvas-align";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData, ViewportTransform } from "@/types/canvas";

const SELECTION_PAD = 14;

/** 图标选型说明：左右的「线」在图标的哪一侧决定读法，和 CSS 里 left/right 一致。 */
const ALIGN_ITEMS: ReadonlyArray<{ axis: AlignAxis; icon: ReactNode; labelKey: string }> = [
    { axis: "left", icon: <AlignStartVertical className="size-4" />, labelKey: "canvas.nodeToolbar.alignLeft" },
    { axis: "center-x", icon: <AlignCenterVertical className="size-4" />, labelKey: "canvas.nodeToolbar.alignCenterX" },
    { axis: "right", icon: <AlignEndVertical className="size-4" />, labelKey: "canvas.nodeToolbar.alignRight" },
    { axis: "top", icon: <AlignStartHorizontal className="size-4" />, labelKey: "canvas.nodeToolbar.alignTop" },
    { axis: "center-y", icon: <AlignCenterHorizontal className="size-4" />, labelKey: "canvas.nodeToolbar.alignCenterY" },
    { axis: "bottom", icon: <AlignEndHorizontal className="size-4" />, labelKey: "canvas.nodeToolbar.alignBottom" },
];

const DISTRIBUTE_ITEMS: ReadonlyArray<{ axis: DistributeAxis; icon: ReactNode; labelKey: string }> = [
    { axis: "horizontal", icon: <AlignHorizontalSpaceAround className="size-4" />, labelKey: "canvas.nodeToolbar.distributeHorizontal" },
    { axis: "vertical", icon: <AlignVerticalSpaceAround className="size-4" />, labelKey: "canvas.nodeToolbar.distributeVertical" },
];

export function CanvasSelectionToolbar({
    nodes,
    viewport,
    showToolbar,
    canGroup,
    canUngroup,
    onGroup,
    onUngroup,
    onAlign,
    onDistribute,
    onSaveWorkflow,
}: {
    nodes: CanvasNodeData[];
    viewport: ViewportTransform;
    showToolbar: boolean;
    canGroup: boolean;
    canUngroup: boolean;
    onGroup: () => void;
    onUngroup: () => void;
    onAlign: (axis: AlignAxis) => void;
    onDistribute: (axis: DistributeAxis) => void;
    onSaveWorkflow: () => void;
}) {
    const { t } = useTranslation();
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const toolbarRef = useRef<HTMLDivElement>(null);
    // 分布按钮的「至少 3 个节点」判定改由注册表给出；节点数仍是唯一真源。
    const toolCtx = useMemo(
        () => buildToolContext({ toolMode: "select", selectedCount: nodes.length, nodeCount: nodes.length, clipboardCount: 0, canUndo: false, canRedo: false, demoMode: false }),
        [nodes.length],
    );
    const { prefs } = useToolbarPrefs("selection");
    const distributeView = toolView("selection", "distribute-horizontal", toolCtx, prefs);
    const downloadView = toolView("selection", "download-selection", toolCtx, prefs);
    const batchExport = useBatchExport();
    if (nodes.length < 2) return null;

    const bounds = nodeBounds(nodes);
    const left = viewport.x + bounds.left * viewport.k - SELECTION_PAD;
    const top = viewport.y + bounds.top * viewport.k - SELECTION_PAD;
    const width = (bounds.right - bounds.left) * viewport.k + SELECTION_PAD * 2;
    const height = (bounds.bottom - bounds.top) * viewport.k + SELECTION_PAD * 2;
    // 对齐/分布不再依赖「能不能打组」：之前只有 canGroup 时才出浮栏，于是选中两个
    // 已经同组的节点、或全是分组时，浮栏整个消失。对齐需要的是「至少两个节点」。
    const showActions = showToolbar;
    const canDistribute = nodes.length >= 3 && distributeView.visible && !distributeView.disabled;
    // 选区里可能混着文本节点，能下载的只有带媒体的那些；一个都没有就灰掉，
    // 免得用户点了才被告知「没有可导出的」。
    const mediaCount = nodes.filter(isBatchExportable).length;
    const hasMedia = mediaCount > 0;
    useLayoutEffect(() => {
        const toolbar = toolbarRef.current;
        const container = toolbar?.parentElement;
        if (!showActions || !toolbar || !container) return;
        const place = () => {
            const cw = container.clientWidth;
            const ch = container.clientHeight;
            const tw = toolbar.offsetWidth;
            const th = toolbar.offsetHeight;
            const preferredX = left + width / 2;
            const x = tw <= cw - 16 ? Math.min(Math.max(preferredX, tw / 2 + 8), cw - tw / 2 - 8) : cw / 2;
            const above = top - 8;
            const below = top + height + th + 8;
            const y = above >= th + 8 ? Math.min(above, ch - 8) : below <= ch - 8 ? below : Math.max(th + 8, Math.min(above, ch - 8));
            toolbar.style.left = `${x}px`;
            toolbar.style.top = `${y}px`;
        };
        place();
        const observer = new ResizeObserver(place);
        observer.observe(toolbar);
        observer.observe(container);
        window.addEventListener("resize", place);
        return () => { observer.disconnect(); window.removeEventListener("resize", place); };
    }, [showActions, left, top, width, height]);
    const tooltipStyles = { root: { color: theme.node.text, boxShadow: colorTheme === "dark" ? "0 8px 24px rgba(0,0,0,.38)" : "0 8px 24px rgba(15,23,42,.16)", fontSize: 13, fontWeight: 500 } };

    return (
        <>
            <svg className="pointer-events-none absolute z-[65] overflow-visible" style={{ left, top, width, height }}>
                <rect
                    x={1}
                    y={1}
                    width={Math.max(width - 2, 0)}
                    height={Math.max(height - 2, 0)}
                    rx={16}
                    ry={16}
                    fill={theme.canvas.selectionFill}
                    stroke={theme.canvas.selectionStroke}
                    strokeOpacity={0.55}
                    strokeWidth={1.5}
                    strokeDasharray="7 5"
                    strokeLinecap="round"
                />
            </svg>
            {showActions ? (
                <div
                    ref={toolbarRef}
                    className="absolute z-[70] flex h-11 -translate-x-1/2 -translate-y-full items-center overflow-visible rounded-2xl border px-1 text-sm shadow-lg backdrop-blur"
                    style={{ left: left + width / 2, top: top - 8, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text, "--selection-toolbar-hover": theme.toolbar.itemHover } as CSSProperties}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    {ALIGN_ITEMS.map((item) => (
                        <SelectionIconAction key={item.axis} title={t(item.labelKey)} icon={item.icon} tooltipBg={theme.toolbar.panel} tooltipStyles={tooltipStyles} onClick={() => onAlign(item.axis)} />
                    ))}
                    <Divider color={theme.toolbar.border} />
                    {DISTRIBUTE_ITEMS.map((item) => (
                        <SelectionIconAction
                            key={item.axis}
                            title={t(item.labelKey)}
                            icon={item.icon}
                            disabled={!canDistribute}
                            tooltipBg={theme.toolbar.panel}
                            tooltipStyles={tooltipStyles}
                            onClick={() => onDistribute(item.axis)}
                        />
                    ))}
                    {canGroup || canUngroup ? <Divider color={theme.toolbar.border} /> : null}
                    {canGroup ? <SelectionAction title={t("canvas.nodeToolbar.groupTitle")} label={t("canvas.nodeToolbar.group")} icon={<Group className="size-4" />} tooltipBg={theme.toolbar.panel} tooltipStyles={tooltipStyles} onClick={onGroup} /> : null}
                    {canUngroup ? <SelectionAction title={t("canvas.nodeToolbar.ungroupTitle")} label={t("canvas.nodeToolbar.ungroup")} icon={<Ungroup className="size-4" />} tooltipBg={theme.toolbar.panel} tooltipStyles={tooltipStyles} onClick={onUngroup} /> : null}
                    <Divider color={theme.toolbar.border} />
                    {downloadView.visible ? (
                        <SelectionIconAction
                            title={t("canvas.batchExport.title", { count: hasMedia ? mediaCount : 0 })}
                            icon={<Download className="size-4" />}
                            disabled={batchExport.busy || !hasMedia}
                            tooltipBg={theme.toolbar.panel}
                            tooltipStyles={tooltipStyles}
                            onClick={() => void batchExport.run(nodes)}
                        />
                    ) : null}
                    <SelectionIconAction title={t("canvas.workflow.save")} icon={<FileDown className="size-4" />} tooltipBg={theme.toolbar.panel} tooltipStyles={tooltipStyles} onClick={onSaveWorkflow} />
                </div>
            ) : null}
        </>
    );
}

function Divider({ color }: { color: string }) {
    return <span className="mx-1 h-5 w-px shrink-0" style={{ background: color }} />;
}

function SelectionIconAction({ title, icon, onClick, disabled = false, tooltipBg, tooltipStyles }: { title: string; icon: ReactNode; onClick: () => void; disabled?: boolean; tooltipBg: string; tooltipStyles: { root: CSSProperties } }) {
    return (
        <Tooltip title={title} placement="top" mouseEnterDelay={0.2} color={tooltipBg} styles={tooltipStyles}>
            <button
                type="button"
                className="group relative flex h-10 items-center px-0.5 disabled:cursor-not-allowed disabled:opacity-35"
                onClick={onClick}
                disabled={disabled}
                aria-label={title}
            >
                <span className="flex size-8 items-center justify-center rounded-lg transition group-hover:bg-[var(--selection-toolbar-hover)] group-focus-visible:bg-[var(--selection-toolbar-hover)] group-disabled:group-hover:bg-transparent motion-safe:group-active:scale-95">{icon}</span>
            </button>
        </Tooltip>
    );
}

function SelectionAction({ title, label, icon, onClick, tooltipBg, tooltipStyles }: { title: string; label: string; icon: ReactNode; onClick: () => void; tooltipBg: string; tooltipStyles: { root: CSSProperties } }) {
    return (
        <Tooltip title={title} placement="top" mouseEnterDelay={0.2} color={tooltipBg} styles={tooltipStyles}>
            <button type="button" className="group relative flex h-10 items-center whitespace-nowrap px-1" onClick={onClick} aria-label={title}>
                <span className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 transition group-hover:bg-[var(--selection-toolbar-hover)] group-focus-visible:bg-[var(--selection-toolbar-hover)] motion-safe:group-active:scale-95">
                    {icon}
                    <span>{label}</span>
                </span>
            </button>
        </Tooltip>
    );
}
