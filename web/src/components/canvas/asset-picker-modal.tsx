import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Button, Empty, Input, Modal, Pagination, Tag } from "antd";
import { Check, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { getImagePreviewRevision, subscribeImagePreviews } from "@/services/image-storage";
import { assetCoverUrl, useAssetStore, type Asset } from "@/stores/use-asset-store";

export type InsertAssetPayload = { kind: "text"; content: string; title: string } | { kind: "image"; dataUrl: string; title: string; storageKey?: string } | { kind: "video"; url: string; title: string; storageKey?: string; width?: number; height?: number };

type Props = {
    open: boolean;
    onInsert: (payloads: InsertAssetPayload[]) => Promise<void>;
    onClose: () => void;
};

export function AssetPickerModal({ open, onInsert, onClose }: Props) {
    const { t } = useTranslation();
    const [inserting, setInserting] = useState(false);
    return (
        <Modal title={t("canvas.assetPicker.title")} open={open} onCancel={() => { if (!inserting) onClose(); }} closable={!inserting} footer={null} width={860} destroyOnHidden styles={{ body: { padding: "0 24px 24px", minHeight: 480 } }}>
            {open && <MyAssetsTab inserting={inserting} onInsert={async (payloads) => {
                setInserting(true);
                try {
                    await onInsert(payloads);
                } finally {
                    setInserting(false);
                }
            }} />}
        </Modal>
    );
}

const PAGE_SIZE = 8;

const kindOptions = ["all", "text", "image", "video"];

function PickerCard({ title, kind, cover, selected, onClick }: { title: string; kind: string; cover: string; selected: boolean; onClick: () => void }) {
    const { t } = useTranslation();
    return (
        <button
            type="button"
            className={cn("relative cursor-pointer overflow-hidden rounded-lg border bg-card text-left transition hover:bg-[var(--surface-card-hover)]", selected ? "border-primary ring-1 ring-primary" : "border-border")}
            onClick={onClick}
            aria-pressed={selected}
        >
            {cover ? (
                <img src={cover} alt={title} className="aspect-[4/3] w-full object-cover" />
            ) : (
                <div className="flex aspect-[4/3] items-center justify-center bg-muted p-3 text-center text-xs leading-5 text-muted-foreground">{title}</div>
            )}
            <div className="p-2.5">
                <div className="flex items-center justify-between gap-2">
                    <span className="line-clamp-1 text-xs font-medium text-foreground">{title}</span>
                    <Tag className="m-0 shrink-0 typ-label">{t(`assets.kinds.${kind}`)}</Tag>
                </div>
            </div>
            {selected && <span aria-hidden className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-foreground text-background"><Check className="size-4" /></span>}
        </button>
    );
}

function MyAssetsTab({ inserting, onInsert }: Pick<Props, "onInsert"> & { inserting: boolean }) {
    const { t } = useTranslation();
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const assets = useAssetStore((state) => state.assets);
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState("all");
    const [page, setPage] = useState(1);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
    const [insertFailed, setInsertFailed] = useState(false);
    const selectedAssets = [...selectedIds].flatMap((id) => assets.find((asset) => asset.id === id) ?? []);

    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return assets
            .filter((a) => a.kind === "text" || a.kind === "image" || a.kind === "video")
            .filter((a) => kindFilter === "all" || a.kind === kindFilter)
            .filter((a) => !query || [a.title, ...(a.tags || [])].join(" ").toLowerCase().includes(query));
    }, [assets, keyword, kindFilter]);

    const visible = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page]);

    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
        setPage((v) => Math.min(v, maxPage));
    }, [filtered.length]);

    const handleInsert = async () => {
        if (inserting || !selectedAssets.length) return;
        setInsertFailed(false);
        try {
            await onInsert(selectedAssets.map(toInsertPayload));
        } catch {
            setInsertFailed(true);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
                <Input
                    className="w-56"
                    size="small"
                    prefix={<Search className="size-3.5 text-muted-foreground" />}
                    placeholder={t("canvas.assetPicker.search")}
                    value={keyword}
                    allowClear
                    onChange={(e) => {
                        setPage(1);
                        setKeyword(e.target.value);
                    }}
                />
                <div className="flex gap-1.5">
                    {kindOptions.map((option) => (
                        <Tag.CheckableTag
                            key={option}
                            checked={kindFilter === option}
                            className={cn("prompt-filter-tag", kindFilter === option && "is-active")}
                            onChange={() => {
                                setPage(1);
                                setKindFilter(option);
                            }}
                        >
                            {option === "all" ? t("common.all") : t(`assets.kinds.${option}`)}
                        </Tag.CheckableTag>
                    ))}
                </div>
            </div>

            {visible.length ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {visible.map((asset) => (
                        <PickerCard key={asset.id} title={asset.title} kind={asset.kind} cover={assetCoverUrl(asset)} selected={selectedIds.has(asset.id)} onClick={() => {
                            if (inserting) return;
                            setSelectedIds((current) => {
                                const next = new Set(current);
                                if (next.has(asset.id)) next.delete(asset.id);
                                else next.add(asset.id);
                                return next;
                            });
                        }} />
                    ))}
                </div>
            ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("canvas.assetPicker.empty")} className="py-12" />
            )}

            {filtered.length > PAGE_SIZE && (
                <div className="flex justify-center">
                    <Pagination size="small" current={page} pageSize={PAGE_SIZE} total={filtered.length} onChange={setPage} showSizeChanger={false} />
                </div>
            )}
            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-3">
                {insertFailed && <p role="alert" className="mr-auto text-sm text-destructive">{t("canvas.assetPicker.insertFailed")}</p>}
                <span className="text-sm text-muted-foreground" aria-live="polite">{t("canvas.assetPicker.selected", { count: selectedAssets.length })}</span>
                <Button type="primary" disabled={!selectedAssets.length} loading={inserting} onClick={() => void handleInsert()}>{t("canvas.assetPicker.insertSelected")}</Button>
            </div>
        </div>
    );
}

function toInsertPayload(asset: Asset): InsertAssetPayload {
    if (asset.kind === "text") return { kind: "text", content: asset.data.content, title: asset.title };
    if (asset.kind === "video") return { kind: "video", url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, width: asset.data.width, height: asset.data.height };
    return { kind: "image", dataUrl: asset.data.dataUrl, storageKey: asset.data.storageKey, title: asset.title };
}
