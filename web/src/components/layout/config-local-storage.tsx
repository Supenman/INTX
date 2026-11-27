import { Alert, App, Button, Popconfirm, Spin } from "antd";
import type { TFunction } from "i18next";
import { Archive, Database, Download, FolderDown, FolderUp, HardDrive, Layers3, RefreshCw, Sparkles, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { clearOrphanMedia, clearPreviewCache, readLocalStorageUsage, type LocalStorageUsage } from "@/services/local-storage-usage";
import { backupWorkspaceToFolder, exportWorkspacePackage, importWorkspacePackage, restoreWorkspaceFromFolder } from "@/services/workspace-archive";

const storeLabelKeys: Record<string, string> = {
    app_state: "appState",
    image_files: "images",
    image_previews: "imagePreviews",
    media_files: "media",
    image_generation_logs: "imageLogs",
    video_generation_logs: "videoLogs",
    agent_chat_messages: "agentMessages",
    prompt_cache: "promptCache",
};

export function ConfigLocalStorage({ active }: { active: boolean }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const packageInputRef = useRef<HTMLInputElement>(null);
    const [usage, setUsage] = useState<LocalStorageUsage | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [busyAction, setBusyAction] = useState("");
    const [progressText, setProgressText] = useState("");

    const refresh = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            setUsage(await readLocalStorageUsage());
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("config.localStorage.readFailed"));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        if (active && !usage) void refresh();
    }, [active, refresh, usage]);

    const runAction = async (key: string, runner: () => Promise<void>) => {
        setBusyAction(key);
        setProgressText("");
        try {
            await runner();
            await refresh();
        } catch (reason) {
            message.error(reason instanceof Error ? reason.message : t("config.localStorage.actionFailed"));
        } finally {
            setBusyAction("");
            setProgressText("");
        }
    };

    const handleBackupFolder = () =>
        void runAction("backup-folder", async () => {
            const result = await backupWorkspaceToFolder(setProgressText);
            if (result.canceled) return;
            message.success(
                t("config.localStorage.backupFolderSuccess", {
                    projects: result.projects,
                    assets: result.assets,
                    files: result.files,
                }),
            );
        });

    const handleRestoreFolder = () =>
        void runAction("restore-folder", async () => {
            const result = await restoreWorkspaceFromFolder(setProgressText);
            if (result.canceled) return;
            message.success(
                t("config.localStorage.restoreFolderSuccess", {
                    projects: result.projects,
                    assets: result.assets,
                    files: result.files,
                }),
            );
        });

    const handleExportPackage = () =>
        void runAction("export-package", async () => {
            const { outcome, result } = await exportWorkspacePackage(setProgressText);
            if (outcome.status === "canceled") return;
            if (outcome.status === "failed") throw outcome.error ?? new Error(t("config.localStorage.actionFailed"));
            message.success(
                t("config.localStorage.exportPackageSuccess", {
                    projects: result.projects,
                    assets: result.assets,
                    files: result.files,
                }),
            );
        });

    const handleImportPackage = (file: File) =>
        void runAction("import-package", async () => {
            try {
                const result = await importWorkspacePackage(file, setProgressText);
                message.success(
                    t("config.localStorage.importPackageSuccess", {
                        projects: result.projects,
                        assets: result.assets,
                        files: result.files,
                    }),
                );
            } finally {
                if (packageInputRef.current) packageInputRef.current.value = "";
            }
        });

    const handleClearPreviews = () =>
        void runAction("clear-previews", async () => {
            const result = await clearPreviewCache();
            message.success(t("config.localStorage.clearPreviewsSuccess", { count: result.removed, size: formatStorageBytes(result.freedBytes) }));
        });

    const handleClearOrphans = () =>
        void runAction("clear-orphans", async () => {
            const result = await clearOrphanMedia();
            message.success(t("config.localStorage.clearOrphansSuccess", { count: result.removed, size: formatStorageBytes(result.freedBytes) }));
        });

    const contentBytes = usage?.contentBytes ?? 0;
    const totalRecords = usage?.databases.reduce((sum, db) => sum + db.stores.reduce((s, item) => s + item.records, 0), 0) ?? 0;
    const busy = Boolean(busyAction);

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <section className="flex flex-col justify-between rounded-[var(--r-lg)] border border-border bg-[var(--surface-card)] p-4">
                    <div>
                        <div className="flex items-center gap-2 text-sm font-semibold">
                            <FolderUp className="size-4" />
                            {t("config.localStorage.folderBackupTitle")}
                        </div>
                        <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{t("config.localStorage.folderBackupDescription")}</p>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                        <Button type="primary" icon={<FolderUp className="size-4" />} loading={busyAction === "backup-folder"} disabled={busy && busyAction !== "backup-folder"} onClick={handleBackupFolder}>
                            {t("config.localStorage.backupToFolder")}
                        </Button>
                        <Button icon={<FolderDown className="size-4" />} loading={busyAction === "restore-folder"} disabled={busy && busyAction !== "restore-folder"} onClick={handleRestoreFolder}>
                            {t("config.localStorage.restoreFromFolder")}
                        </Button>
                    </div>
                </section>

                <section className="flex flex-col justify-between rounded-[var(--r-lg)] border border-border bg-[var(--surface-card)] p-4">
                    <div>
                        <div className="flex items-center gap-2 text-sm font-semibold">
                            <Archive className="size-4" />
                            {t("config.localStorage.packageTitle")}
                        </div>
                        <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{t("config.localStorage.packageDescription")}</p>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                        <Button type="primary" icon={<Download className="size-4" />} loading={busyAction === "export-package"} disabled={busy && busyAction !== "export-package"} onClick={handleExportPackage}>
                            {t("config.localStorage.exportPackage")}
                        </Button>
                        <Button icon={<Upload className="size-4" />} loading={busyAction === "import-package"} disabled={busy && busyAction !== "import-package"} onClick={() => packageInputRef.current?.click()}>
                            {t("config.localStorage.importPackage")}
                        </Button>
                        <input
                            ref={packageInputRef}
                            type="file"
                            accept=".zip,.intx.zip,application/zip"
                            className="hidden"
                            onChange={(event) => event.target.files?.[0] && handleImportPackage(event.target.files[0])}
                        />
                    </div>
                </section>
            </div>

            {progressText ? (
                <div role="status" className="rounded-[var(--r-lg)] border border-border bg-[var(--surface-sunken)] px-4 py-2.5 text-xs text-muted-foreground">
                    {progressText}
                </div>
            ) : null}

            <section className="rounded-[var(--r-lg)] border border-border bg-[var(--surface-card)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-2 text-sm font-semibold">
                            <Database className="size-4" />
                            {t("config.localStorage.title")}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">{t("config.localStorage.description")}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Popconfirm title={t("config.localStorage.clearPreviewsConfirm")} okText={t("common.confirm")} cancelText={t("common.cancel")} onConfirm={handleClearPreviews}>
                            <Button icon={<Sparkles className="size-4" />} loading={busyAction === "clear-previews"} disabled={busy && busyAction !== "clear-previews"}>
                                {t("config.localStorage.clearPreviews")}
                            </Button>
                        </Popconfirm>
                        <Popconfirm title={t("config.localStorage.clearOrphansConfirm")} okText={t("common.confirm")} cancelText={t("common.cancel")} onConfirm={handleClearOrphans}>
                            <Button icon={<Trash2 className="size-4" />} loading={busyAction === "clear-orphans"} disabled={busy && busyAction !== "clear-orphans"}>
                                {t("config.localStorage.clearOrphans")}
                            </Button>
                        </Popconfirm>
                        <Button icon={<RefreshCw className="size-4" />} loading={loading} disabled={busy} onClick={() => void refresh()}>
                            {t("config.localStorage.refresh")}
                        </Button>
                    </div>
                </div>
                {error ? <Alert className="mt-4" type="error" showIcon message={t("config.localStorage.readFailed")} description={error} /> : null}
                {!usage && loading ? (
                    <div className="flex min-h-40 items-center justify-center"><Spin /></div>
                ) : usage ? (
                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <StorageMetric icon={<Database className="size-4" />} label={t("config.localStorage.workspaceUsage")} value={formatStorageBytes(contentBytes)} hint={t("config.localStorage.workspaceUsageHint")} />
                        <StorageMetric icon={<HardDrive className="size-4" />} label={t("config.localStorage.totalItems")} value={String(totalRecords)} hint={t("config.localStorage.totalItemsHint")} />
                        <StorageMetric icon={<Layers3 className="size-4" />} label={t("config.localStorage.availableSpace")} value={formatStorageBytes(usage.quota)} hint={usage.quota ? t("config.localStorage.availableSpaceHint") : t("config.localStorage.quotaUnavailable")} />
                    </div>
                ) : null}
            </section>

            {usage?.databases.map((database) => (
                <section key={database.name} className="overflow-hidden rounded-[var(--r-lg)] border border-border bg-[var(--surface-card)]">
                    <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                        <div className="min-w-0">
                            <div className="truncate text-sm font-semibold">{t("config.localStorage.mainDatabase")}</div>
                            <div className="mt-0.5 truncate text-xs text-muted-foreground">{t("config.localStorage.mainDatabaseHint")}</div>
                        </div>
                        <div className="shrink-0 text-sm font-medium tabular-nums">{formatStorageBytes(database.bytes)}</div>
                    </div>
                    <div className="divide-y divide-border">
                        {database.stores.map((store) => (
                            <div key={store.name} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 px-4 py-3 text-sm">
                                <div className="min-w-0 truncate font-medium">{storeLabel(store.name, t)}</div>
                                <div className="text-right text-xs text-muted-foreground tabular-nums">{t("config.localStorage.records", { count: store.records })}</div>
                                <div className="w-20 text-right font-medium tabular-nums">{formatStorageBytes(store.bytes)}</div>
                            </div>
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}

function StorageMetric({ icon, label, value, hint }: { icon: ReactNode; label: string; value: string; hint: string }) {
    return (
        <div className="rounded-lg bg-[var(--surface-sunken)] p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
            <div className="mt-2 text-xl font-semibold tabular-nums">{value}</div>
            <div className="mt-1 typ-label text-muted-foreground">{hint}</div>
        </div>
    );
}

function storeLabel(name: string, t: TFunction) {
    const key = storeLabelKeys[name];
    return key ? t(`config.localStorage.stores.${key}`) : name;
}

function formatStorageBytes(bytes: number | null) {
    if (bytes === null) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
