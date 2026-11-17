import { Copy, Download, PencilLine, Plus, Search, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { App, Button, Card, Drawer, Empty, Form, Image, Input, Modal, Pagination, Select, Space, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";

import { PageHeader, PageShell } from "@/components/layout/page-header";
import { useCopyText } from "@/hooks/use-copy-text";
import { useSaveFile, useSaveNotice } from "@/hooks/use-save-file";
import { formatBytes, readFileAsDataUrl } from "@/lib/image-utils";
import { getMediaBlob } from "@/services/file-storage";
import { getImageBlob, getImagePreviewRevision, subscribeImagePreviews, uploadImage } from "@/services/image-storage";
import { cn } from "@/lib/utils";
import { assetCoverUrl, useAssetStore, type Asset, type AssetKind, type ImageAsset } from "@/stores/use-asset-store";
import { exportAssets, readAssetPackage } from "./asset-transfer";
import { SnapshotStorageStatus } from "@/components/layout/snapshot-storage-status";

type AssetFormValues = {
    kind: AssetKind;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    content?: string;
};

type ImageDraft = ImageAsset["data"] | null;

const kindOptions = ["all", "text", "image", "video"] as const;

export default function AssetsPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const copyText = useCopyText();
    const saveFileWithNotice = useSaveFile();
    const saveNotice = useSaveNotice();
    const [form] = Form.useForm<AssetFormValues>();
    const coverInputRef = useRef<HTMLInputElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const assetInputRef = useRef<HTMLInputElement>(null);
    const hydrated = useAssetStore((state) => state.hydrated);
    const assets = useAssetStore((state) => state.assets);
    const addAsset = useAssetStore((state) => state.addAsset);
    const updateAsset = useAssetStore((state) => state.updateAsset);
    const removeAsset = useAssetStore((state) => state.removeAsset);
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState<AssetKind | "all">("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
    const [isAssetOpen, setIsAssetOpen] = useState(false);
    const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
    const [deletingAsset, setDeletingAsset] = useState<Asset | null>(null);
    const [formKind, setFormKind] = useState<AssetKind>("text");
    const [imageDraft, setImageDraft] = useState<ImageDraft>(null);
    const coverUrl = Form.useWatch("coverUrl", form) || "";
    const title = Form.useWatch("title", form) || "";
    const tags = Form.useWatch("tags", form) || [];
    const content = Form.useWatch("content", form) || "";
    const validAssets = useMemo(() => assets.filter((asset) => asset.kind === "text" || asset.kind === "image" || asset.kind === "video"), [assets]);

    const filteredAssets = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return validAssets.filter((asset) => {
            if (kindFilter !== "all" && asset.kind !== kindFilter) return false;
            if (!query) return true;
            return assetSearchText(asset).includes(query);
        });
    }, [validAssets, keyword, kindFilter]);

    const visibleAssets = useMemo(() => {
        const start = (page - 1) * pageSize;
        return filteredAssets.slice(start, start + pageSize);
    }, [filteredAssets, page, pageSize]);

    const hasFilter = Boolean(keyword.trim()) || kindFilter !== "all";

    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(filteredAssets.length / pageSize));
        setPage((value) => Math.min(value, maxPage));
    }, [filteredAssets.length, pageSize]);

    const openCreate = () => {
        setEditingAsset(null);
        setImageDraft(null);
        setFormKind("text");
        form.setFieldsValue({ kind: "text", title: "", coverUrl: "", tags: [], source: t("assets.manual"), note: "", content: "" });
        setIsAssetOpen(true);
    };

    const openEdit = (asset: Asset) => {
        setEditingAsset(asset);
        setFormKind(asset.kind);
        setImageDraft(asset.kind === "image" ? asset.data : null);
        form.setFieldsValue({
            kind: asset.kind,
            title: asset.title,
            coverUrl: asset.coverUrl,
            tags: asset.tags || [],
            source: asset.source,
            note: asset.note,
            content: asset.kind === "text" ? asset.data.content : "",
        });
        setIsAssetOpen(true);
    };

    const saveAsset = async () => {
        const values = await form.validateFields();
        const base = {
            title: values.title.trim(),
            coverUrl: values.coverUrl?.trim() || (values.kind === "image" && imageDraft ? imageDraft.dataUrl : ""),
            tags: values.tags || [],
            source: values.source?.trim(),
            note: values.note?.trim(),
            metadata: editingAsset?.metadata || { source: "manual" },
        };

        if (values.kind === "text") {
            const asset = { ...base, kind: "text" as const, data: { content: (values.content || "").trim() } };
            editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset);
        } else {
            if (!imageDraft) {
                message.error(t("assets.selectImage"));
                return;
            }
            const asset = { ...base, kind: "image" as const, data: imageDraft };
            editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset);
        }

        try {
            await useAssetStore.getState().confirmSave();
            message.success(editingAsset ? t("assets.updated") : t("assets.saved"));
            setIsAssetOpen(false);
        } catch {
            message.error(t("assets.saveFailed"));
        }
    };

    const readCoverFile = async (file?: File) => {
        if (!file) return;
        const dataUrl = await readFileAsDataUrl(file);
        form.setFieldValue("coverUrl", dataUrl);
    };

    const readImageFile = async (file?: File) => {
        if (!file || !file.type.startsWith("image/")) return;
        const image = await uploadImage(file);
        const draft = { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType };
        setImageDraft(draft);
        if (!form.getFieldValue("coverUrl")) form.setFieldValue("coverUrl", draft.dataUrl);
        if (!form.getFieldValue("title")) form.setFieldValue("title", file.name);
    };

    const copyAssetText = async (asset: Asset) => {
        if (asset.kind !== "text") return;
        copyText(asset.data.content, t("assets.textCopied"));
    };

    const downloadImage = async (asset: Asset) => {
        if (asset.kind !== "image" && asset.kind !== "video") return;
        try {
            const blob = await readAssetMediaBlob(asset);
            if (!blob) {
                message.error(t("assets.downloadFailed"));
                return;
            }
            const ext = asset.data.mimeType?.split("/")[1]?.split("+")[0] || (asset.kind === "video" ? "mp4" : "png");
            await saveFileWithNotice(blob, `${asset.title || "asset"}.${ext}`);
        } catch {
            message.error(t("assets.downloadFailed"));
        }
    };

    const exportAllAssets = async () => {
        if (!validAssets.length) {
            message.warning(t("assets.noneToExport"));
            return;
        }
        try {
            saveNotice(await exportAssets(validAssets, t("assets.packageName")));
        } catch (error) {
            console.error(error);
            message.error(t("common.saveFailed"));
        }
    };

    const importAssetZip = async (file?: File) => {
        if (!file) return;
        try {
            const importedAssets = await readAssetPackage(file);
            importedAssets.forEach((asset) => {
                const payload = { ...asset } as Record<string, unknown>;
                delete payload.id;
                delete payload.createdAt;
                delete payload.updatedAt;
                addAsset(payload as Parameters<typeof addAsset>[0]);
            });
            try {
                await useAssetStore.getState().confirmSave();
                message.success(t("assets.imported", { count: importedAssets.length }));
            } catch {
                message.error(t("assets.importSaveFailed"));
            }
        } catch {
            message.error(t("assets.importFailed"));
        } finally {
            if (assetInputRef.current) assetInputRef.current.value = "";
        }
    };

    const confirmDelete = async () => {
        if (!deletingAsset) return;
        removeAsset(deletingAsset.id);
        try {
            await useAssetStore.getState().confirmSave();
            message.success(t("assets.deleted"));
            setDeletingAsset(null);
        } catch {
            message.error(t("assets.deleteSaveFailed"));
        }
    };

    if (!hydrated) return <main className="flex h-full items-center justify-center bg-background text-foreground"><SnapshotStorageStatus kind="assets" /></main>;

    return (
        <PageShell className="px-6 py-5">
            <main className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-6xl">
                    <PageHeader
                        title={t("assets.title")}
                        description={t("assets.description")}
                        actions={
                            <>
                                <Button type="text" onClick={() => void exportAllAssets()}>
                                    {t("assets.export")}
                                </Button>
                                <Button type="text" onClick={() => assetInputRef.current?.click()}>
                                    {t("assets.import")}
                                </Button>
                                <Button type="primary" icon={<Plus className="size-4" />} onClick={openCreate}>
                                    {t("assets.add")}
                                </Button>
                            </>
                        }
                    />

                    <div className="mt-5 flex items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="typ-overline mr-1 text-muted-foreground">{t("assets.type")}</span>
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

                        <div className="flex items-center gap-3">
                            <div className="block">
                                <SnapshotStorageStatus kind="assets" />
                            </div>
                            <Input
                                allowClear
                                className="w-64"
                                prefix={<Search className="size-3.5 text-muted-foreground" />}
                                value={keyword}
                                placeholder={t("assets.search")}
                                onChange={(event) => {
                                    setPage(1);
                                    setKeyword(event.target.value);
                                }}
                                onPressEnter={(event) => {
                                    setPage(1);
                                    setKeyword((event.target as HTMLInputElement).value);
                                }}
                            />
                        </div>
                    </div>

                    <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
                        {visibleAssets.map((asset) => (
                            <AssetCard key={asset.id} asset={asset} onOpen={() => setPreviewAsset(asset)} onEdit={() => openEdit(asset)} onCopy={copyAssetText} onDownload={downloadImage} onDelete={() => setDeletingAsset(asset)} />
                        ))}
                    </div>

                    {!visibleAssets.length ? (
                        <div className="mt-5 flex min-h-[280px] flex-col items-center justify-center rounded-xl bg-[var(--surface-sunken)] px-6 py-16 text-center">
                            <div className="flex size-11 items-center justify-center rounded-full bg-[var(--surface-card)] text-muted-foreground">
                                <Search className="size-5" />
                            </div>
                            <p className="typ-heading mt-4">{hasFilter ? t("assets.empty") : t("assets.emptyAll")}</p>
                            <p className="typ-caption mt-1.5 max-w-xs text-muted-foreground">{hasFilter ? t("assets.emptyHint") : t("assets.emptyAllHint")}</p>
                        </div>
                    ) : null}

                    {filteredAssets.length > pageSize ? (
                        <div className="mt-5 flex justify-center">
                            <Pagination
                                current={page}
                                pageSize={pageSize}
                                total={filteredAssets.length}
                                showSizeChanger
                                pageSizeOptions={[10, 20, 50, 100]}
                                onChange={(nextPage, nextPageSize) => {
                                    setPage(nextPage);
                                    setPageSize(nextPageSize);
                                }}
                            />
                        </div>
                    ) : null}
                </div>
            </main>

            <Modal title={editingAsset ? t("assets.edit") : t("assets.add")} open={isAssetOpen} width={980} onCancel={() => setIsAssetOpen(false)} onOk={() => void saveAsset()} okText={t("common.save")} cancelText={t("common.cancel")} destroyOnHidden>
                <div className="grid gap-6 pt-1 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <Form form={form} layout="vertical" requiredMark={false} initialValues={{ kind: "text", tags: [] }}>
                        <Form.Item name="kind" label={t("assets.type")}>
                            <Select
                                options={[
                                    { label: t("assets.kinds.text"), value: "text" },
                                    { label: t("assets.kinds.image"), value: "image" },
                                ]}
                                onChange={(value) => setFormKind(value)}
                            />
                        </Form.Item>
                        <Form.Item name="title" label={t("assets.fields.title")} rules={[{ required: true, message: t("assets.fields.titleRequired") }]}>
                            <Input size="large" placeholder={t("assets.fields.titlePlaceholder")} />
                        </Form.Item>
                        <Form.Item name="coverUrl" label={t("assets.fields.coverUrl")}>
                            <Space.Compact className="w-full">
                                <Input placeholder={t("assets.fields.coverPlaceholder")} />
                                <Button icon={<Upload className="size-3.5" />} onClick={() => coverInputRef.current?.click()}>
                                    {t("common.upload")}
                                </Button>
                            </Space.Compact>
                        </Form.Item>
                        <Form.Item name="tags" label={t("assets.fields.tags")}>
                            <Select mode="tags" tokenSeparators={[",", "，"]} placeholder={t("assets.fields.tagsPlaceholder")} />
                        </Form.Item>
                        <div className="grid grid-cols-2 gap-4">
                            <Form.Item name="source" label={t("assets.fields.source")}>
                                <Input placeholder={t("assets.fields.sourcePlaceholder")} />
                            </Form.Item>
                            <Form.Item name="note" label={t("assets.fields.note")}>
                                <Input placeholder={t("assets.fields.optional")} />
                            </Form.Item>
                        </div>
                        {formKind === "text" ? (
                            <Form.Item name="content" label={t("assets.fields.textContent")} rules={[{ required: true, message: t("assets.fields.textRequired") }]}>
                                <Input.TextArea rows={8} placeholder={t("assets.fields.textPlaceholder")} />
                            </Form.Item>
                        ) : (
                            <Form.Item label={t("assets.fields.imageContent")} required>
                                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border p-3.5">
                                    <Button icon={<Upload className="size-4" />} onClick={() => imageInputRef.current?.click()}>
                                        {t("assets.selectImageFile")}
                                    </Button>
                                    {imageDraft ? (
                                        <span className="typ-caption text-muted-foreground">
                                            {imageDraft.width}x{imageDraft.height} · {formatBytes(imageDraft.bytes)}
                                        </span>
                                    ) : (
                                        <span className="typ-caption text-muted-foreground">
                                            {t("assets.noImageSelected")}
                                        </span>
                                    )}
                                </div>
                            </Form.Item>
                        )}
                    </Form>
                    <div className="rounded-xl bg-[var(--surface-sunken)] p-4">
                        <Typography.Text strong>{t("assets.preview")}</Typography.Text>
                        <div className="mt-3 overflow-hidden rounded-lg bg-[var(--surface-card)]">
                            {coverUrl || imageDraft?.dataUrl ? (
                                <img src={coverUrl || imageDraft?.dataUrl} alt="" className="aspect-[4/3] w-full object-cover" />
                            ) : (
                                <div className="line-clamp-6 flex aspect-[4/3] items-center justify-center overflow-hidden bg-[var(--surface-sunken)] p-4 text-center text-xs leading-5 break-words whitespace-pre-wrap text-muted-foreground">{content || t("assets.noCover")}</div>
                            )}
                            <div className="p-4">
                                <Typography.Text strong ellipsis className="block">
                                    {title || t("assets.untitled")}
                                </Typography.Text>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {tags.length ? (
                                        tags.map((tag) => (
                                            <Tag key={tag} className="m-0">
                                                {tag}
                                            </Tag>
                                        ))
                                    ) : (
                                        <Tag className="m-0">{t("assets.untagged")}</Tag>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                        void readCoverFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
                <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                        void readImageFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
            </Modal>

            <AssetDrawer asset={previewAsset} onClose={() => setPreviewAsset(null)} onCopy={copyAssetText} onDownload={downloadImage} />

            <input ref={assetInputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importAssetZip(event.target.files?.[0])} />

            <Modal destroyOnHidden title={t("assets.deleteTitle")} open={Boolean(deletingAsset)} onCancel={() => setDeletingAsset(null)} onOk={confirmDelete} okText={t("common.delete")} okButtonProps={{ danger: true }} cancelText={t("common.cancel")}>
                {t("assets.deleteConfirm", { name: deletingAsset?.title })}
            </Modal>
        </PageShell>
    );
}

function AssetCard({ asset, onOpen, onEdit, onCopy, onDownload, onDelete }: { asset: Asset; onOpen: () => void; onEdit: () => void; onCopy: (asset: Asset) => void; onDownload: (asset: Asset) => void; onDelete: () => void }) {
    const { t } = useTranslation();
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const cover = assetCoverUrl(asset);
    const summary = assetSummary(asset);
    return (
        <Card
            hoverable
            className="surface-card-interactive overflow-hidden"
            styles={{ body: { padding: 0 } }}
            cover={
                <button type="button" className="block w-full text-left" onClick={onOpen}>
                    {cover ? (
                        <img src={cover} alt={asset.title} className="aspect-[4/3] w-full object-cover" />
                    ) : (
                        <div className="line-clamp-5 aspect-[4/3] overflow-hidden bg-[var(--surface-sunken)] p-4 text-xs leading-5 break-words whitespace-pre-wrap text-muted-foreground">{asset.kind === "text" ? asset.data.content : t("assets.noCover")}</div>
                    )}
                </button>
            }
        >
            <button type="button" className="block w-full text-left" onClick={onOpen}>
                <div className="p-3.5">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h2 className="typ-body-compact line-clamp-1 font-medium text-foreground">{asset.title}</h2>
                            <p className="typ-caption mt-0.5 line-clamp-1 text-muted-foreground">{asset.source || t("assets.unknownSource")}</p>
                        </div>
                        <Tag className="m-0 shrink-0 text-[11px]">{t(`assets.kinds.${asset.kind}`)}</Tag>
                    </div>
                    {asset.kind === "image" || asset.kind === "video" ? <p className="typ-caption mt-2 line-clamp-1 text-muted-foreground">{summary}</p> : null}
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {(asset.tags || []).slice(0, 3).map((tag) => (
                            <Tag key={tag} className="m-0 text-[11px]">
                                {tag}
                            </Tag>
                        ))}
                        {!asset.tags?.length ? <Tag className="m-0 text-[11px]">{t("assets.noTags")}</Tag> : null}
                    </div>
                </div>
            </button>
            <div className="flex items-center gap-1.5 border-t border-border/60 px-2.5 py-2">
                <Button type="text" size="small" onClick={onOpen}>
                    {t("common.view")}
                </Button>
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
                    <Button type="text" size="small" icon={<Download className="size-3.5" />} onClick={() => onDownload(asset)} />
                ) : null}
                <Button type="text" size="small" danger className="ml-auto" icon={<Trash2 className="size-3.5" />} onClick={onDelete} />
            </div>
        </Card>
    );
}

function AssetDrawer({ asset, onClose, onCopy, onDownload }: { asset: Asset | null; onClose: () => void; onCopy: (asset: Asset) => void; onDownload: (asset: Asset) => void }) {
    const { t } = useTranslation();
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const cover = asset ? asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "") : "";
    return (
        <Drawer title={t("assets.details")} open={Boolean(asset)} size="large" onClose={onClose}>
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
                            <video src={asset.data.url} controls className="mt-2 aspect-video w-full rounded-lg bg-black" />
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
                    <Space>
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

async function readAssetMediaBlob(asset: Extract<Asset, { kind: "image" | "video" }>) {
    const storageKey = asset.data.storageKey;
    if (storageKey) {
        const stored = asset.kind === "image" ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
        if (stored) return stored;
    }
    const url = asset.kind === "video" ? asset.data.url : asset.data.dataUrl || asset.coverUrl;
    if (!url) return null;
    const response = await fetch(url);
    return response.ok ? response.blob() : null;
}

function assetSummary(asset: Asset) {
    if (asset.kind === "text") return asset.data.content;
    return `${asset.data.width}x${asset.data.height} · ${formatBytes(asset.data.bytes)} · ${asset.data.mimeType}`;
}

function assetSearchText(asset: Asset) {
    return [asset.title, asset.source || "", asset.note || "", (asset.tags || []).join(" "), asset.kind === "text" ? asset.data.content : asset.data.mimeType].join(" ").toLowerCase();
}
