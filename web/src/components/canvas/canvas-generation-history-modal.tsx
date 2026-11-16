import { Modal, Tag } from "antd";
import dayjs from "dayjs";
import { ImageOff, History } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { loadTaskLog, useTaskLogStore } from "@/services/generation";
import { assetCoverUrl, useAssetStore, type Asset } from "@/stores/use-asset-store";

/**
 * 画布侧的「生成历史」：把任务台账里成功且产物还在素材库的结果直接插回画布。
 *
 * 只读台账，不重发、不查单；选择后走画布已有的资产插入链路（同一套节点创建逻辑）。
 */
export function CanvasGenerationHistoryModal({ open, onClose, onInsert }: { open: boolean; onClose: () => void; onInsert: (payload: InsertAssetPayload) => void }) {
    const { t } = useTranslation();
    const tasks = useTaskLogStore((state) => state.tasks);
    const assets = useAssetStore((state) => state.assets);

    useEffect(() => {
        if (!open) return;
        void loadTaskLog();
        void useAssetStore.getState().load();
    }, [open]);

    const groups = useMemo(() => {
        const byId = new Map(assets.map((asset) => [asset.id, asset]));
        return tasks
            .map((task) => ({
                task,
                items: task.resultAssetIds
                    .map((id) => byId.get(id))
                    .filter((asset): asset is Asset => asset !== undefined && (asset.kind === "image" || asset.kind === "video")),
            }))
            .filter((group) => group.items.length > 0)
            .slice(0, 30);
    }, [tasks, assets]);

    const payloadOf = (taskPrompt: string, asset: Asset): InsertAssetPayload => {
        const title = asset.title || taskPrompt.slice(0, 24);
        if (asset.kind === "video") {
            const data = asset.data as { url: string; storageKey?: string; width?: number; height?: number };
            return { kind: "video", url: data.url, title, storageKey: data.storageKey, width: data.width, height: data.height };
        }
        const data = asset.data as { dataUrl?: string; storageKey?: string };
        return { kind: "image", dataUrl: data.dataUrl || assetCoverUrl(asset), title, storageKey: data.storageKey };
    };

    return (
        <Modal title={t("canvas.generationHistory.title")} open={open} onCancel={onClose} footer={null} width={780} destroyOnHidden>
            <p className="mb-3 text-xs text-stone-500">{t("canvas.generationHistory.description")}</p>
            {groups.length === 0 ? (
                <div className="rounded-lg border border-dashed border-stone-300 px-4 py-14 text-center text-sm text-stone-500 dark:border-stone-700">
                    <History className="mx-auto mb-2 size-5" />
                    <div>{t("canvas.generationHistory.empty")}</div>
                    <div className="mt-1 text-xs">{t("canvas.generationHistory.emptyHint")}</div>
                </div>
            ) : (
                <div className="thin-scrollbar max-h-[60vh] space-y-4 overflow-y-auto pr-1">
                    {groups.map(({ task, items }) => (
                        <section key={task.id} className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
                                <Tag className="m-0">{t(`tasks.kind.${task.kind}`, { defaultValue: task.kind })}</Tag>
                                <span className="truncate">{task.params.model || "—"}</span>
                                <span>·</span>
                                <span>{dayjs(task.createdAt).format("MM-DD HH:mm")}</span>
                                <span>·</span>
                                <span>{t("tasks.detail.results")} {items.length}</span>
                            </div>
                            <div className="mt-1 truncate text-sm text-stone-800 dark:text-stone-200">{task.params.prompt || "—"}</div>
                            <div className="mt-2 flex flex-wrap gap-2">
                                {items.map((asset) => {
                                    const cover = asset.kind === "image" ? assetCoverUrl(asset) : assetCoverUrl(asset);
                                    return (
                                        <button
                                            key={asset.id}
                                            type="button"
                                            title={t("canvas.generationHistory.insert")}
                                            className="group relative size-20 overflow-hidden rounded-md border border-stone-200 bg-stone-100 transition hover:border-stone-400 dark:border-stone-700 dark:bg-stone-800 dark:hover:border-stone-500"
                                            onClick={() => {
                                                onInsert(payloadOf(task.params.prompt, asset));
                                                onClose();
                                            }}
                                        >
                                            {cover ? <img src={cover} alt={asset.title} className="size-full object-cover" /> : <ImageOff className="absolute inset-0 m-auto size-5 text-stone-400" />}
                                        </button>
                                    );
                                })}
                            </div>
                        </section>
                    ))}
                </div>
            )}
        </Modal>
    );
}
