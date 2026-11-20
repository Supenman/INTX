import { useMemo, type ReactNode } from "react";
import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalSpaceAround, AlignStartHorizontal, AlignStartVertical, AlignVerticalSpaceAround, Download, Group, Ungroup } from "lucide-react";
import { Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { nodeBounds } from "@/lib/canvas/canvas-node-geometry";
import { buildToolContext, toolView } from "@/lib/canvas/tool-wiring";
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
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    // 分布按钮的「至少 3 个节点」判定改由注册表给出；节点数仍是唯一真源。
    const toolCtx = useMemo(
        () => buildToolContext({ toolMode: "select", selectedCount: nodes.length, nodeCount: nodes.length, clipboardCount: 0, canUndo: false, canRedo: false, demoMode: false }),
        [nodes.length],
    );
    const { prefs } = useToolbarPrefs("selection");
    const distributeView = toolView("selection", "distribute-horizontal", toolCtx, prefs);
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
                    className="absolute z-[70] flex h-12 -translate-x-1/2 -translate-y-full items-center overflow-visible rounded-[18px] border border-black/10 bg-white text-[15px] text-[#242529] shadow-[0_8px_28px_rgba(15,23,42,.12)]"
                    style={{ left: left + width / 2, top: top - 8 }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    {ALIGN_ITEMS.map((item) => (
                        <SelectionIconAction key={item.axis} title={t(item.labelKey)} icon={item.icon} onClick={() => onAlign(item.axis)} />
                    ))}
                    <Divider />
                    {DISTRIBUTE_ITEMS.map((item) => (
                        <SelectionIconAction
                            key={item.axis}
                            title={t(item.labelKey)}
                            icon={item.icon}
                            disabled={!canDistribute}
                            onClick={() => onDistribute(item.axis)}
                        />
                    ))}
                    {canGroup || canUngroup ? <Divider /> : null}
                    {canGroup ? <SelectionAction title={t("canvas.nodeToolbar.groupTitle")} label={t("canvas.nodeToolbar.group")} icon={<Group className="size-4" />} onClick={onGroup} /> : null}
                    {canUngroup ? <SelectionAction title={t("canvas.nodeToolbar.ungroupTitle")} label={t("canvas.nodeToolbar.ungroup")} icon={<Ungroup className="size-4" />} onClick={onUngroup} /> : null}
                    <Divider />
                    <SelectionIconAction title={t("canvas.workflow.save")} icon={<Download className="size-4" />} onClick={onSaveWorkflow} />
                </div>
            ) : null}
        </>
    );
}

function Divider() {
    return <span className="mx-1 h-5 w-px shrink-0 bg-black/10" />;
}

function SelectionIconAction({ title, icon, onClick, disabled = false }: { title: string; icon: ReactNode; onClick: () => void; disabled?: boolean }) {
    return (
        <Tooltip title={title} placement="top" mouseEnterDelay={0.2} color="#ffffff" styles={{ root: { color: "#242529", boxShadow: "0 8px 24px rgba(15,23,42,.16)", fontSize: 13, fontWeight: 500 } }}>
            <button
                type="button"
                className="group relative flex h-12 items-center px-0.5 disabled:cursor-not-allowed disabled:opacity-35"
                onClick={onClick}
                disabled={disabled}
                aria-label={title}
            >
                <span className="flex size-9 items-center justify-center rounded-lg transition group-hover:bg-[#f0f0f1] group-disabled:group-hover:bg-transparent">{icon}</span>
            </button>
        </Tooltip>
    );
}

function SelectionAction({ title, label, icon, onClick }: { title: string; label: string; icon: ReactNode; onClick: () => void }) {
    return (
        <Tooltip title={title} placement="top" mouseEnterDelay={0.2} color="#ffffff" styles={{ root: { color: "#242529", boxShadow: "0 8px 24px rgba(15,23,42,.16)", fontSize: 13, fontWeight: 500 } }}>
            <button type="button" className="group relative flex h-12 items-center whitespace-nowrap px-1.5" onClick={onClick} aria-label={title}>
                <span className="flex h-9 items-center gap-2 rounded-lg px-2.5 transition group-hover:bg-[#f0f0f1]">
                    {icon}
                    <span>{label}</span>
                </span>
            </button>
        </Tooltip>
    );
}
