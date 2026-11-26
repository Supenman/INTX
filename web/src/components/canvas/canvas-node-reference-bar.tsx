import { ChevronLeft, ChevronRight, FileText, Image as ImageIcon, Link2, Music2, Puzzle, Video, X } from "lucide-react";
import { Popover } from "antd";
import { useSyncExternalStore, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { buildCanvasResourceReferences, getGroupResourceNodes } from "@/lib/canvas/canvas-resource-references";
import { cn } from "@/lib/utils";
import { getImagePreviewRevision, previewUrlFor, subscribeImagePreviews } from "@/services/image-storage";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export function CanvasNodeReferenceBar({ nodeId, nodes, connectedNodes, actions, selecting, videoFrames, frameRoles, onFinishSelection, onDisconnect, onStartSelection, onMove, onReplace }: { nodeId: string; nodes: CanvasNodeData[]; connectedNodes: CanvasNodeData[]; actions?: ReactNode; selecting?: boolean; videoFrames?: boolean; frameRoles?: ReadonlyMap<number, "firstFrame" | "lastFrame">; onFinishSelection?: () => void; onDisconnect?: (fromNodeId: string, toNodeId: string) => void; onStartSelection?: (nodeId: string) => void; onMove?: (sourceId: string, targetId: string, delta: -1 | 1) => void; onReplace?: (sourceId: string, targetId: string, replacementId: string) => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const resources = buildCanvasResourceReferences(nodes);
    const byId = new Map(resources.map((reference) => [reference.nodeId, reference]));
    const references = connectedNodes.flatMap((sourceNode, index) => (
        sourceNode.type === CanvasNodeType.Group ? getGroupResourceNodes(sourceNode.id, nodes) : byId.has(sourceNode.id) ? [sourceNode] : []
    ).map((node, childIndex) => ({ node, sourceNodeId: sourceNode.id, index, first: childIndex === 0 })));
    const connectedIds = new Set(references.map(({ node }) => node.id));
    const frameIds = videoFrames || frameRoles?.size ? [...new Set(references.filter(({ node }) => byId.get(node.id)?.kind === "image").map(({ node }) => node.id))] : [];
    // 提示词里按同类依次编号（图片1、图片2、【文本1】…）。缩略图不显示编号，用户没法把提示词里的名字对上具体哪一张。
    const ordinalByNode = new Map<string, number>();
    const kindTotals: Partial<Record<string, number>> = {};
    references.forEach(({ node }) => {
        const kind = byId.get(node.id)?.kind;
        if (!kind) return;
        kindTotals[kind] = (kindTotals[kind] ?? 0) + 1;
        ordinalByNode.set(node.id, kindTotals[kind]!);
    });
    return (
        <div className="mb-2">
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1 text-xs font-medium" style={{ color: theme.node.muted }}>
                {references.length > 0 && <span>{t("canvas.references.count", { count: references.length })}</span>}
                <div className="ml-auto flex items-center gap-1">
                    {onStartSelection && (
                        <button type="button" className={cn("focus-ring inline-flex items-center gap-1 rounded-md border border-transparent px-2 py-1 hover:bg-[var(--surface-card-hover)] motion-safe:transition-colors", selecting && "border-primary/50 bg-primary/10")} style={{ color: theme.node.text }} aria-pressed={Boolean(selecting)} onClick={selecting ? onFinishSelection : () => onStartSelection(nodeId)}>
                            <Link2 className="size-3.5" />
                            {t(selecting ? "canvas.references.finish" : "canvas.references.add")}
                        </button>
                    )}
                    {actions}
                </div>
            </div>
            {selecting ? <p role="status" className="mb-2 rounded-md border border-primary/30 bg-primary/5 px-2 py-1.5 text-xs" style={{ color: theme.node.text }}>{t("canvas.references.selectingHint")}</p> : null}
            {references.length > 0 && (
                <div className="thin-scrollbar flex min-h-12 gap-2 overflow-x-auto pb-1">
                    {references.map(({ node, sourceNodeId, index, first }) => {
                        const kind = byId.get(node.id)?.kind;
                        const frameIndex = frameIds.indexOf(node.id);
                        const frameRole = frameRoles?.get(frameIndex) ?? (videoFrames && frameIds.length <= 2 ? frameIndex === 0 ? "firstFrame" : frameIndex === 1 ? "lastFrame" : undefined : undefined);
                        const frame = frameRole ? t(`canvas.references.${frameRole}`) : undefined;
                        const replacements = onReplace && kind && sourceNodeId === node.id ? resources.filter((item) => item.kind === kind && item.nodeId !== nodeId && !connectedIds.has(item.nodeId)) : [];
                        return (
                            <ReferenceItem key={`${sourceNodeId}:${node.id}`} node={node} frame={frame} label={byId.get(node.id)?.label} ordinal={frame ? undefined : ordinalByNode.get(node.id)} onRemove={() => onDisconnect?.(sourceNodeId, nodeId)} controls={first && !selecting && (
                                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                    {onMove && <button type="button" disabled={index === 0} title={t("canvas.references.moveEarlier")} aria-label={t("canvas.references.moveEarlier")} className="rounded border border-border p-1 disabled:opacity-40" onClick={() => onMove(sourceNodeId, nodeId, -1)}><ChevronLeft className="size-4" /></button>}
                                    {onMove && <button type="button" disabled={index === connectedNodes.length - 1} title={t("canvas.references.moveLater")} aria-label={t("canvas.references.moveLater")} className="rounded border border-border p-1 disabled:opacity-40" onClick={() => onMove(sourceNodeId, nodeId, 1)}><ChevronRight className="size-4" /></button>}
                                    {!!replacements.length && (
                                        <select aria-label={t("canvas.references.replace")} className="max-w-52 rounded border border-border bg-background px-1 py-1 text-xs" value="" onChange={(event) => onReplace?.(sourceNodeId, nodeId, event.target.value)}>
                                            <option value="" disabled>{t("canvas.references.replace")}</option>
                                            {replacements.map((item) => <option value={item.nodeId} key={item.nodeId}>{item.title}</option>)}
                                        </select>
                                    )}
                                </div>
                            )} />
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function ReferenceItem({ node, frame, label, ordinal, controls, onRemove }: { node: CanvasNodeData; frame?: string; label?: string; ordinal?: number; controls?: ReactNode; onRemove: () => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    const content = node.metadata?.content || resource?.url;
    const thumbnail = previewUrlFor(node.metadata?.storageKey) || content;
    const Icon = resource?.kind === "image" || node.type === CanvasNodeType.Image ? ImageIcon : resource?.kind === "video" || node.type === CanvasNodeType.Video ? Video : resource?.kind === "audio" || node.type === CanvasNodeType.Audio ? Music2 : resource?.kind === "text" || node.type === CanvasNodeType.Text ? FileText : Puzzle;
    return (
        <Popover placement="topLeft" trigger={["hover", "focus"]} mouseEnterDelay={0.15} content={<div data-canvas-no-zoom onPointerDown={(event) => event.stopPropagation()}><ReferencePreview node={node} content={content} />{controls}</div>}>
            <div tabIndex={0} aria-label={[ordinal ? label : "", frame, node.title].filter(Boolean).join(" · ")} className="group focus-ring relative grid size-12 shrink-0 place-items-center rounded-xl border" style={{ background: theme.toolbar.activeBg, borderColor: theme.toolbar.border }}>
                <span className="grid size-full place-items-center overflow-hidden rounded-[inherit]">
                    {(resource?.kind === "image" || node.type === CanvasNodeType.Image) && thumbnail ? <img src={thumbnail} alt="" className="size-full object-cover" /> : (resource?.kind === "video" || node.type === CanvasNodeType.Video) && content ? <video src={content} className="size-full object-cover" muted /> : <Icon className="size-4 opacity-65" />}
                </span>
                {ordinal ? <span aria-hidden className="absolute left-0.5 top-0.5 grid size-4 place-items-center rounded-full text-[length:var(--fs-caption)] font-medium leading-none" style={{ background: theme.toolbar.panel, color: theme.node.text, boxShadow: `0 0 0 1px ${theme.toolbar.border}` }}>{ordinal}</span> : null}
                {frame && <span className="absolute inset-x-0 bottom-0 truncate rounded-b-xl px-1 text-center typ-micro" style={{ background: theme.toolbar.panel }}>{frame}</span>}
                <button type="button" className="focus-ring absolute right-0 top-0 grid size-5 place-items-center rounded-full border opacity-0 shadow-sm group-hover:opacity-100 group-focus-within:opacity-100 motion-safe:transition-opacity" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }} aria-label={t("canvas.references.disconnect")} title={t("canvas.references.disconnect")} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onRemove(); }}><X className="size-3" /></button>
            </div>
        </Popover>
    );
}

function ReferencePreview({ node, content }: { node: CanvasNodeData; content?: string }) {
    const { t } = useTranslation();
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    if ((resource?.kind === "image" || node.type === CanvasNodeType.Image) && content) return <img src={content} alt={node.title} className="max-h-52 w-72 rounded-lg object-contain" />;
    if ((resource?.kind === "video" || node.type === CanvasNodeType.Video) && content) return <video src={content} className="max-h-52 w-72 rounded-lg" muted controls />;
    if ((resource?.kind === "audio" || node.type === CanvasNodeType.Audio) && content) return <audio src={content} className="w-72" controls />;
    return <div className="max-h-52 w-72 overflow-auto whitespace-pre-wrap text-sm">{resource?.text || node.metadata?.content || node.metadata?.prompt || node.title || t("canvas.references.empty")}</div>;
}
