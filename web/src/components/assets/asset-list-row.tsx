import { Button, Checkbox, Tag, Tooltip } from "antd";
import { ArrowUpRight, Copy, Download, PencilLine, Trash2 } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";

import { formatBytes } from "@/lib/image-utils";
import { cn } from "@/lib/utils";
import { getImagePreviewRevision, subscribeImagePreviews } from "@/services/image-storage";
import { assetCoverUrl, type Asset } from "@/stores/use-asset-store";

export function AssetListRow({
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
    const metaText = asset.kind === "text"
        ? asset.data.content.slice(0, 80)
        : `${asset.data.width}x${asset.data.height} · ${formatBytes(asset.data.bytes)}`;

    return (
        <article
            className={cn(
                "surface-card-interactive flex items-center gap-3 px-3.5 py-2.5 hover:bg-[var(--surface-card-hover)] focus-within:bg-[var(--surface-card-hover)]",
                selected && "ring-2 ring-primary",
            )}
        >
            <Checkbox checked={selected} aria-label={t("assets.selectAsset", { name: asset.title })} onChange={(event) => onSelect(event.target.checked)} />
            <button
                type="button"
                className="focus-ring h-12 w-16 shrink-0 overflow-hidden rounded-lg border border-border bg-[var(--surface-sunken)] text-left"
                aria-label={asset.title}
                onClick={(event) => onOpen(event.currentTarget)}
            >
                {cover ? (
                    <img src={cover} alt="" loading="lazy" className="size-full object-cover" />
                ) : (
                    <div className="line-clamp-3 p-1.5 text-xs leading-4 text-muted-foreground">{asset.kind === "text" ? asset.data.content : t("assets.noCover")}</div>
                )}
            </button>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <button type="button" className="focus-ring min-w-0 truncate rounded-sm text-left text-sm font-medium text-foreground hover:underline" onClick={(event) => onOpen(event.currentTarget)}>
                        {asset.title}
                    </button>
                    <Tag className="m-0 shrink-0 typ-label">{t(`assets.kinds.${asset.kind}`)}</Tag>
                </div>
                <p className="typ-caption mt-0.5 truncate text-muted-foreground">
                    {asset.source || t("assets.unknownSource")} · {metaText}
                </p>
            </div>
            <div className="hidden max-w-48 flex-wrap justify-end gap-1 md:flex">
                {(asset.tags || []).slice(0, 3).map((tag) => (
                    <button
                        key={tag}
                        type="button"
                        onClick={() => onTagClick(tag)}
                        className="focus-ring rounded-md bg-[var(--surface-sunken)] px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                    >
                        {tag}
                    </button>
                ))}
            </div>
            <div className="flex shrink-0 items-center gap-1">
                <Tooltip title={t("assets.openInNewCanvas")}>
                    <Button type="text" size="small" aria-label={t("assets.openInNewCanvas")} icon={<ArrowUpRight className="size-3.5" />} onClick={() => onOpenInCanvas(asset)} />
                </Tooltip>
                {asset.kind !== "video" ? (
                    <Tooltip title={t("common.edit")}>
                        <Button type="text" size="small" aria-label={t("common.edit")} icon={<PencilLine className="size-3.5" />} onClick={onEdit} />
                    </Tooltip>
                ) : null}
                {asset.kind === "text" ? (
                    <Tooltip title={t("common.copy")}>
                        <Button type="text" size="small" aria-label={t("common.copy")} icon={<Copy className="size-3.5" />} onClick={() => void onCopy(asset)} />
                    </Tooltip>
                ) : null}
                {asset.kind === "image" || asset.kind === "video" ? (
                    <Tooltip title={t("common.download")}>
                        <Button type="text" size="small" aria-label={t("common.download")} icon={<Download className="size-3.5" />} onClick={() => onDownload(asset)} />
                    </Tooltip>
                ) : null}
                <Tooltip title={t("common.delete")}>
                    <Button type="text" size="small" danger aria-label={t("common.delete")} icon={<Trash2 className="size-3.5" />} onClick={onDelete} />
                </Tooltip>
            </div>
        </article>
    );
}
