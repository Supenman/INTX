import { Button, Modal, Tag } from "antd";
import { Archive, Crosshair, Eye, History, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { EmptyState } from "@/components/layout/empty-state";
import { previewUrlFor } from "@/services/image-storage";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

type Props = {
    nodes: CanvasNodeData[];
    onClose: () => void;
    onLocate: (node: CanvasNodeData) => void;
    onPreview: (node: CanvasNodeData, imageId?: string) => void;
    onInsert: (node: CanvasNodeData, imageId?: string) => void;
    onArchive: (node: CanvasNodeData, imageId?: string) => void;
};

export function CanvasGenerationHistoryModal({ nodes, onClose, onLocate, onPreview, onInsert, onArchive }: Props) {
    const { t } = useTranslation();
    const history = nodes.filter(({ metadata }) => metadata && (
        metadata.inputPrompt !== undefined || metadata.retrySourceId || metadata.generationType || metadata.videoTaskId
    )).reverse();

    return (
        <Modal title={t("canvas.generationHistory.title")} open onCancel={onClose} footer={null} width={780}>
            <p className="mb-3 text-xs text-muted-foreground">{t("canvas.generationHistory.description")}</p>
            {!history.length ? (
                <EmptyState icon={History} title={t("canvas.generationHistory.empty")} description={t("canvas.generationHistory.emptyHint")} />
            ) : (
                <div className="thin-scrollbar max-h-[60vh] space-y-3 overflow-y-auto pr-1">
                    {history.map((node) => {
                        const images = node.type === CanvasNodeType.Image ? node.metadata?.images?.filter((image) => image.status === "success" && image.content) ?? [] : [];
                        const results = images.length
                            ? images.map((image) => ({ id: image.id, src: previewUrlFor(image.storageKey) || image.content, outputNodeId: image.outputNodeId }))
                            : node.metadata?.content && node.metadata.status !== "loading" ? [{ id: undefined, src: previewUrlFor(node.metadata.storageKey) || node.metadata.content, outputNodeId: undefined }] : [];
                        const media = node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video;
                        const status = node.metadata?.status === "success" ? "succeeded" : node.metadata?.status === "loading" ? "running" : "failed";
                        return (
                            <section key={node.id} className="space-y-2 rounded-lg border border-border p-3">
                                <div className="flex flex-wrap items-center gap-2">
                                    <Tag className="m-0">{t(`canvas.nodeTypes.${node.type}`, { defaultValue: node.type })}</Tag>
                                    {node.metadata?.status && node.metadata.status !== "idle" && <span className="text-xs text-muted-foreground">{t(`tasks.status.${status}`)}</span>}
                                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{node.metadata?.model}</span>
                                    <Button size="small" type="text" icon={<Crosshair className="size-4" />} onClick={() => onLocate(node)}>{t("canvas.generationHistory.locate")}</Button>
                                </div>
                                <p className="line-clamp-2 text-sm">{node.metadata?.prompt || node.title}</p>
                                {node.metadata?.errorDetails && <p className="line-clamp-2 text-xs text-destructive">{node.metadata.errorDetails}</p>}
                                {media && results.length > 0 && (
                                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                        {results.map(({ id, src, outputNodeId }) => (
                                            <div key={id ?? node.id} className="flex items-center gap-2 rounded-md border border-border p-2">
                                                {node.type === CanvasNodeType.Image ? <img src={src} alt="" className="size-12 shrink-0 rounded object-cover" /> : <video src={src} preload="metadata" muted className="size-12 shrink-0 rounded object-cover" />}
                                                <div className="flex flex-wrap gap-1">
                                                    {outputNodeId && <span className="w-full px-1 text-xs text-muted-foreground">{t("canvas.generationHistory.outputNode", { id: outputNodeId })}</span>}
                                                    <Button size="small" type="text" icon={<Eye className="size-4" />} onClick={() => onPreview(node, id)}>{t("common.view")}</Button>
                                                    <Button size="small" type="text" icon={<Plus className="size-4" />} onClick={() => onInsert(node, id)}>{t("canvas.generationHistory.insert")}</Button>
                                                    <Button size="small" type="text" icon={<Archive className="size-4" />} onClick={() => onArchive(node, id)}>{t("canvas.nodeToolbar.saveAsset")}</Button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </section>
                        );
                    })}
                </div>
            )}
        </Modal>
    );
}
