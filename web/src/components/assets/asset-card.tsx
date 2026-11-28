import { Button, Card, Checkbox, Drawer, Image, Space, Tag, Tooltip, Typography } from "antd";
import { ArrowUpRight, Copy, Download, PencilLine, Trash2 } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";

import { formatBytes } from "@/lib/image-utils";
import { cn } from "@/lib/utils";
import { getImagePreviewRevision, subscribeImagePreviews } from "@/services/image-storage";
import { assetCoverUrl, type Asset } from "@/stores/use-asset-store";

export function assetSummary(asset: Asset) {
    if (asset.kind === "text") return asset.data.content;
    return `${asset.data.width}x${asset.data.height} · ${formatBytes(asset.data.bytes)} · ${asset.data.mimeType}`;
}

export function AssetCard({
    asset,
    selected,
    onSelect,
    onOpen,
    onEdit,
    onCopy,
    onDownload,
    onOpenInCanvas,
    onTagClick,
    onDelete,
}: {
    asset: Asset;
    selected: boolean;
    onSelect: (checked: boolean) => void;
    onOpen: (trigger: HTMLElement) => void;
    onEdit: () => void;
    onCopy: (asset: Asset) => void;
    onDownload: (asset: Asset) => void;
    onOpenInCanvas: (asset: Asset) => void;
    onTagClick: (tag: string) => void;
    onDelete: () => void;
}) {
    const { t } = useTranslation();
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const cover = assetCoverUrl(asset);
    const summary = assetSummary(asset);
    return (
        <Card
            className={cn("surface-card-interactive relative overflow-hidden hover:bg-[var(--surface-card-hover)] focus-within:bg-[var(--surface-card-hover)]", selected && "ring-2 ring-primary")}
            styles={{ body: { padding: 0 } }}
            cover={
                <button type="button" className="group relative block w-full overflow-hidden text-left focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring" aria-label={asset.title} onClick={(event) => onOpen(event.currentTarget)}>
                    {cover ? (
                        <img src={cover} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover" />
                    ) : (
                        <div className="line-clamp-5 aspect-[4/3] overflow-hidden bg-[var(--surface-sunken)] p-4 text-xs leading-5 break-words whitespace-pre-wrap text-muted-foreground">{asset.kind === "text" ? asset.data.content : t("assets.noCover")}</div>
                    )}
                </button>
            }
        >
            <div className="absolute left-2 top-2 z-10 grid size-7 place-items-center rounded-md border border-border bg-card shadow-sm">
                <Checkbox checked={selected} aria-label={t("assets.selectAsset", { name: asset.title })} onChange={(event) => onSelect(event.target.checked)} />
            </div>
            <div className="p-3.5">
                <button type="button" className="focus-ring block w-full text-left" onClick={(event) => onOpen(event.currentTarget)}>
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h2 className="typ-body-compact line-clamp-1 font-medium text-foreground">{asset.title}</h2>
                            <p className="typ-caption mt-0.5 line-clamp-1 text-muted-foreground">{asset.source || t("assets.unknownSource")}</p>
                        </div>
                        <Tag className="m-0 shrink-0 typ-label">{t(`assets.kinds.${asset.kind}`)}</Tag>
                    </div>
                    {asset.kind === "image" || asset.kind === "video" ? <p className="typ-caption mt-2 line-clamp-1 text-muted-foreground">{summary}</p> : null}
                </button>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {(asset.tags || []).slice(0, 3).map((tag) => (
                        <button
                            key={tag}
                            type="button"
                            onClick={() => onTagClick(tag)}
                            className="focus-ring rounded-md bg-[var(--surface-sunken)] px-1.5 py-0.5 typ-label text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                        >
                            {tag}
                        </button>
                    ))}
                    {!asset.tags?.length ? <Tag className="m-0 typ-label">{t("assets.noTags")}</Tag> : null}
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-1 border-t border-border/60 px-2.5 py-2">
                <Button type="text" size="small" onClick={(event) => onOpen(event.currentTarget)}>
                    {t("common.view")}
                </Button>
                <Tooltip title={t("assets.openInNewCanvas")}>
                    <Button type="text" size="small" aria-label={t("assets.openInNewCanvas")} icon={<ArrowUpRight className="size-3.5" />} onClick={() => onOpenInCanvas(asset)} />
                </Tooltip>
                {asset.kind !== "video" ? (
                    <Button type="text" size="small" icon={<PencilLine className="size-3.5" />} onClick={onEdit}>
                        {t("common.edit")}
                    </Button>
                ) : null}
                {asset.kind === "text" ? (
                    <Button type="text" size="small" icon={<Copy className="size-3.5" />} onClick={() => void onCopy(asset)}>
                        {t("common.copy")}
                    </Button>
                ) : null}
                {asset.kind === "image" || asset.kind === "video" ? (
                    <Button type="text" size="small" aria-label={t("common.download")} icon={<Download className="size-3.5" />} onClick={() => onDownload(asset)} />
                ) : null}
                <Button type="text" size="small" danger aria-label={t("common.delete")} className="ml-auto" icon={<Trash2 className="size-3.5" />} onClick={onDelete} />
            </div>
        </Card>
    );
}

export function AssetDrawer({
    asset,
    open,
    onClose,
    onClosed,
    onCopy,
    onDownload,
    onOpenInCanvas,
}: {
    asset: Asset | null;
    open: boolean;
    onClose: () => void;
    onClosed: () => void;
    onCopy: (asset: Asset) => void;
    onDownload: (asset: Asset) => void;
    onOpenInCanvas: (asset: Asset) => void;
}) {
    const { t } = useTranslation();
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const cover = asset ? asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "") : "";
    return (
        <Drawer title={t("assets.details")} open={open} size="large" onClose={onClose} afterOpenChange={(visible) => { if (!visible) onClosed(); }} destroyOnHidden>
            {asset ? (
                <div className="space-y-5">
                    {cover ? (
                        <Image src={assetCoverUrl(asset)} preview={{ src: cover }} alt={asset.title} className="rounded-lg" />
                    ) : (
                        <div className="rounded-lg bg-[var(--surface-sunken)] p-4 text-sm leading-6 break-words whitespace-pre-wrap text-foreground/80">{asset.kind === "text" ? asset.data.content : t("assets.noCover")}</div>
                    )}
                    <div>
                        <Typography.Title level={4} className="!mb-2">
                            {asset.title}
                        </Typography.Title>
                        <Space size={[4, 4]} wrap>
                            <Tag>{t(`assets.kinds.${asset.kind}`)}</Tag>
                            {(asset.tags || []).map((tag) => (
                                <Tag key={tag}>{tag}</Tag>
                            ))}
                        </Space>
                    </div>
                    <div className="rounded-lg bg-[var(--surface-sunken)] p-4">
                        <Typography.Text type="secondary" className="block text-xs">
                            {t("assets.fields.textContent")}
                        </Typography.Text>
                        {asset.kind === "text" ? (
                            <Typography.Paragraph className="mt-2 whitespace-pre-wrap">{asset.data.content}</Typography.Paragraph>
                        ) : asset.kind === "video" ? (
                            <video src={asset.data.url} controls ref={(element) => { if (!open) element?.pause(); }} className="mt-2 aspect-video w-full rounded-lg bg-[var(--surface-sunken)]" />
                        ) : (
                            <Typography.Text className="mt-2 block">
                                {asset.data.width}x{asset.data.height} · {formatBytes(asset.data.bytes)} · {asset.data.mimeType}
                            </Typography.Text>
                        )}
                    </div>
                    {asset.note ? (
                        <div>
                            <Typography.Text type="secondary">{t("assets.fields.note")}</Typography.Text>
                            <Typography.Paragraph className="mt-1">{asset.note}</Typography.Paragraph>
                        </div>
                    ) : null}
                    <Space wrap>
                        <Button icon={<ArrowUpRight className="size-4" />} onClick={() => onOpenInCanvas(asset)}>
                            {t("assets.openInNewCanvas")}
                        </Button>
                        {asset.kind === "text" ? (
                            <Button type="primary" icon={<Copy className="size-4" />} onClick={() => onCopy(asset)}>
                                {t("assets.copyText")}
                            </Button>
                        ) : null}
                        {asset.kind === "image" || asset.kind === "video" ? (
                            <Button type="primary" icon={<Download className="size-4" />} onClick={() => onDownload(asset)}>
                                {asset.kind === "video" ? t("assets.downloadVideo") : t("assets.downloadImage")}
                            </Button>
                        ) : null}
                    </Space>
                </div>
            ) : null}
        </Drawer>
    );
}
