import { useReducedMotion } from "motion/react";
import { App, Button, Form, Input, Modal, Popconfirm, Progress, Radio, Select, Switch, Tabs } from "antd";
import type { TFunction } from "i18next";
import { AlertCircle, CheckCircle2, Cloud, Copy, Download, Ellipsis, Pencil, Plus, RefreshCw, Trash2, Upload, Wifi } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useSaveNotice } from "@/hooks/use-save-file";
import { useLocation } from "react-router-dom";

import { ModelPicker } from "@/components/model-picker";
import { videoResolutionOptions } from "@/components/video-settings-panel";
import { ChannelEditorDrawer } from "@/components/layout/channel-editor-drawer";
import { ConfigLocalStorage } from "@/components/layout/config-local-storage";
import { ConfigTasks } from "@/components/layout/config-tasks";
import type { AppLocale } from "@/i18n";
import { diagnoseCapabilityCoverage, diagnoseChannel } from "@/lib/config/channel-diagnostics";
import { fetchChannelModels } from "@/services/api/image";
import { exportAppConfig, importAppConfig } from "@/services/config-file";
import { syncAppDataToWebdav, type AppSyncDomainKey, type AppSyncProgressEvent } from "@/services/app-sync";
import { testWebdavConnection, WEBDAV_MANIFEST_FILE_NAME } from "@/services/webdav-sync";
import { audioFormatOptions, audioVoiceOptions, normalizeAudioSpeedValue } from "@/lib/audio-generation";
import { computeMediaSize, inferMediaRatio, inferMediaScale, mediaScaleOptions, parseVideoResolution } from "@/lib/media-size";
import { createModelChannel, modelOptionsFromChannels, normalizeModelOptionValue, selectableModelsByCapability, useConfigStore, type AiConfig, type ApiCallFormat, type ConfigTabKey, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";

type ModelGroup = {
    capability: ModelCapability;
    modelKey: "imageModel" | "videoModel" | "textModel" | "audioModel";
    labelKey: string;
};

type WebdavDomainProgress = {
    stage: string;
    current?: number;
    total?: number;
    status?: "active" | "success" | "exception";
};

const modelGroups: ModelGroup[] = [
    { capability: "image", modelKey: "imageModel", labelKey: "config.preferences.defaultImageModel" },
    { capability: "video", modelKey: "videoModel", labelKey: "config.preferences.defaultVideoModel" },
    { capability: "text", modelKey: "textModel", labelKey: "config.preferences.defaultTextModel" },
    { capability: "audio", modelKey: "audioModel", labelKey: "config.preferences.defaultAudioModel" },
];

const webdavDomainKeys: AppSyncDomainKey[] = ["canvas", "assets", "image-workbench", "video-workbench"];
function createWebdavDomainProgress(): Record<AppSyncDomainKey, WebdavDomainProgress> {
    return webdavDomainKeys.reduce(
        (progress, key) => ({
            ...progress,
            [key]: { stage: "等待同步" },
        }),
        {} as Record<AppSyncDomainKey, WebdavDomainProgress>,
    );
}

export function AppConfigPanel({ showDoneButton = false, initialTab = "channels", visibleTabs, onTabChange }: { showDoneButton?: boolean; initialTab?: ConfigTabKey; visibleTabs?: readonly ConfigTabKey[]; onTabChange?: (tab: ConfigTabKey) => void }) {
    const reducedMotion = useReducedMotion();
    const { message } = App.useApp();
    const { i18n, t } = useTranslation();
    const saveNotice = useSaveNotice();
    const configInputRef = useRef<HTMLInputElement>(null);
    const [localTab, setLocalTab] = useState<ConfigTabKey>(initialTab);
    const activeTab = onTabChange ? initialTab : localTab;
    const [editingChannelId, setEditingChannelId] = useState("");
    const [testingChannelId, setTestingChannelId] = useState("");
    const [testingWebdav, setTestingWebdav] = useState(false);
    const [syncingWebdav, setSyncingWebdav] = useState(false);
    const [webdavSyncStatus, setWebdavSyncStatus] = useState("");
    const [webdavDomainProgress, setWebdavDomainProgress] = useState(createWebdavDomainProgress);
    const config = useConfigStore((state) => state.config);
    const webdav = useConfigStore((state) => state.webdav);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const updateWebdavConfig = useConfigStore((state) => state.updateWebdavConfig);
    const shouldPromptContinue = useConfigStore((state) => state.shouldPromptContinue);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const clearPromptContinue = useConfigStore((state) => state.clearPromptContinue);
    const webdavReady = Boolean(webdav.url.trim());
    const editingChannel = config.channels.find((channel) => channel.id === editingChannelId) || null;
    const locale = i18n.resolvedLanguage as AppLocale;
    const imageResolutionOptions = mediaScaleOptions.map((value) => ({ value, label: value === "auto" ? t("settingsPanels.common.auto") : value.toUpperCase() }));
    useEffect(() => setLocalTab(initialTab), [initialTab]);

    const saveConfig = (nextConfig: AiConfig) => {
        (Object.keys(nextConfig) as Array<keyof AiConfig>).forEach((key) => updateConfig(key, nextConfig[key]));
    };

    const finishConfig = () => {
        const ready = config.channels.some((channel) => channel.baseUrl.trim() && channel.apiKey.trim() && channel.models.length);
        setConfigDialogOpen(false);
        if (!ready) return;
        message.success(t(shouldPromptContinue ? "config.savedContinue" : "config.saved"));
        clearPromptContinue();
    };

    const loadConfigFile = async (file: File) => {
        try {
            await importAppConfig(file);
            message.success(t("config.imported"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("config.importFailed"));
        } finally {
            if (configInputRef.current) configInputRef.current.value = "";
        }
    };

    const updateChannels = (channels: ModelChannel[]) => saveConfig(withChannels(config, channels));

    const addChannel = () => {
        const channel = createModelChannel({ name: t("config.channels.numberedName", { count: config.channels.length + 1 }) });
        updateChannels([...config.channels, channel]);
        setEditingChannelId(channel.id);
    };

    const deleteChannel = (id: string) => {
        if (config.channels.length <= 1) {
            message.warning(t("config.channels.keepOne"));
            return;
        }
        updateChannels(config.channels.filter((channel) => channel.id !== id));
    };

    const saveChannel = (channel: ModelChannel) => {
        updateChannels(config.channels.map((item) => (item.id === channel.id ? channel : item)));
    };

    const duplicateChannel = (source: ModelChannel) => {
        const copy = createModelChannel({
            ...source,
            id: undefined,
            name: `${source.name || t("config.channels.unnamed")} (${t("common.copy")})`,
            models: source.models.map((item) => ({ ...item, pricing: item.pricing ? { ...item.pricing } : undefined })),
        });
        updateChannels([...config.channels, copy]);
        setEditingChannelId(copy.id);
    };

    const testChannel = async (channel: ModelChannel) => {
        if (!channel.baseUrl.trim() || !channel.apiKey.trim()) {
            message.error(t("config.modelSelect.missingConfig"));
            return;
        }
        setTestingChannelId(channel.id);
        const startedAt = performance.now();
        try {
            const models = await fetchChannelModels(channel);
            const ms = Math.max(1, Math.round(performance.now() - startedAt));
            message.success(t("config.channelEditor.testSuccess", { count: models.length, ms }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("config.modelSelect.fetchFailed"));
        } finally {
            setTestingChannelId("");
        }
    };

    const capabilityCoverage = diagnoseCapabilityCoverage(config);

    const testWebdav = async () => {
        if (!webdavReady) {
            message.error(t("config.webdav.missingUrl"));
            return;
        }
        setTestingWebdav(true);
        try {
            await testWebdavConnection(webdav);
            message.success(t("config.webdav.available"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("config.webdav.testFailed"));
        } finally {
            setTestingWebdav(false);
        }
    };

    const updateWebdavProgress = (event: AppSyncProgressEvent) => {
        setWebdavSyncStatus(event.stage);
        if (!event.domain) return;
        setWebdavDomainProgress((current) => ({
            ...current,
            [event.domain as AppSyncDomainKey]: {
                stage: event.stage,
                current: event.current,
                total: event.total,
                status: event.status,
            },
        }));
    };

    const syncWebdav = async () => {
        if (!webdavReady) {
            message.error(t("config.webdav.missingUrl"));
            return;
        }
        setSyncingWebdav(true);
        setWebdavDomainProgress(createWebdavDomainProgress());
        setWebdavSyncStatus(t("config.webdav.preparing"));
        try {
            const result = await syncAppDataToWebdav(webdav, updateWebdavProgress);
            updateWebdavConfig("lastSyncedAt", result.syncedAt);
            message.success(t("config.webdav.completed", { projects: result.projects, assets: result.assets, records: result.imageLogs + result.videoLogs, files: result.uploadedFiles, bytes: formatBytes(result.uploadedBytes) }));
        } catch (error) {
            setWebdavSyncStatus(error instanceof Error ? error.message : t("config.webdav.failed"));
            message.error(error instanceof Error ? error.message : t("config.webdav.failed"));
        } finally {
            setSyncingWebdav(false);
        }
    };

    return (
        <>
            {(!visibleTabs || visibleTabs.includes("channels")) && <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
                <div className="text-xs text-muted-foreground">{t("config.fileSecurity")}</div>
                <div className="flex gap-2">
                    <Button icon={<Upload className="size-4" />} onClick={() => configInputRef.current?.click()}>
                        {t("config.import")}
                    </Button>
                    <Button icon={<Download className="size-4" />} onClick={() => void exportAppConfig().then(saveNotice)}>
                        {t("config.export")}
                    </Button>
                    <input ref={configInputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => event.target.files?.[0] && void loadConfigFile(event.target.files[0])} />
                </div>
            </div>}
            <Tabs
                activeKey={activeTab}
                /* 空间不足时 antd 只会裁掉末尾并塞进「更多」，改用下拉模式保证每个标签都能点到 */
                more={{ icon: <Ellipsis className="size-4" /> }}
                renderTabBar={visibleTabs?.length === 1 ? () => <></> : undefined}
                animated={{ inkBar: !reducedMotion, tabPane: false }}
                className="config-tabs"
                onChange={(key) => {
                    const nextTab = key as ConfigTabKey;
                    if (onTabChange) onTabChange(nextTab);
                    else setLocalTab(nextTab);
                }}
                items={[
                    {
                        key: "channels",
                        label: t("config.tabs.channels"),
                        children: (
                            <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                                    {capabilityCoverage.map((item) => (
                                        <button
                                            key={item.capability}
                                            type="button"
                                            onClick={() => (onTabChange ? onTabChange("preferences") : setLocalTab("preferences"))}
                                            className="focus-ring flex min-w-0 cursor-pointer flex-col gap-1 rounded-[var(--r-lg)] border border-border bg-[var(--surface-sunken)] px-3 py-2.5 text-left transition hover:bg-[var(--surface-card-hover)]"
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="text-xs font-medium text-foreground">{t(`config.channelEditor.capabilities.${item.capability}`)}</span>
                                                {item.ready ? (
                                                    <CheckCircle2 className="size-3.5 shrink-0 text-[var(--status-success)]" aria-hidden />
                                                ) : (
                                                    <AlertCircle className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                                                )}
                                            </div>
                                            <div className="truncate text-xs text-muted-foreground">
                                                {item.ready ? item.configuredModel.split("::").pop() : t("config.channels.unconfigured")}
                                            </div>
                                        </button>
                                    ))}
                                </div>

                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div className="text-xs text-muted-foreground">{t("config.channels.description")}</div>
                                    <Button type="primary" icon={<Plus className="size-4" />} onClick={addChannel}>
                                        {t("config.channels.add")}
                                    </Button>
                                </div>
                                <div className="space-y-2.5">
                                    {config.channels.map((channel) => {
                                        const diag = diagnoseChannel(channel);
                                        const capSummary = (["image", "video", "text", "audio"] as const)
                                            .filter((cap) => diag.counts[cap] > 0)
                                            .map((cap) => `${t(`config.channelEditor.capabilities.${cap}`)} ${diag.counts[cap]}`);
                                        return (
                                            <div key={channel.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--r-lg)] border border-border bg-[var(--surface-card)] px-4 py-3 transition hover:bg-[var(--surface-card-hover)]">
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className="truncate text-sm font-semibold">{channel.name || t("config.channels.unnamed")}</span>
                                                        <span className="rounded bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[length:var(--fs-label)] text-muted-foreground">
                                                            {apiFormatLabel(channel.apiFormat)}
                                                        </span>
                                                        <span
                                                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[length:var(--fs-label)] font-medium ${
                                                                diag.ready ? "bg-[var(--surface-sunken)] text-[var(--status-success)]" : "bg-[var(--surface-sunken)] text-muted-foreground"
                                                            }`}
                                                        >
                                                            {t(`config.channels.status.${diag.status}`)}
                                                        </span>
                                                    </div>
                                                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 truncate text-xs text-muted-foreground">
                                                        <span>{t("config.channels.modelCount", { count: channel.models.length })}</span>
                                                        {capSummary.length ? <span>· {capSummary.join(" / ")}</span> : null}
                                                        <span className="truncate">· {channel.baseUrl || t("config.channels.missingUrl")}</span>
                                                    </div>
                                                </div>
                                                <div className="flex shrink-0 items-center gap-1.5">
                                                    {channel.apiFormat === "runninghub" ? null : (
                                                        <Button
                                                            size="small"
                                                            icon={<Wifi className="size-3.5" />}
                                                            loading={testingChannelId === channel.id}
                                                            disabled={!channel.baseUrl.trim() || !channel.apiKey.trim()}
                                                            onClick={() => void testChannel(channel)}
                                                        >
                                                            {t("config.channelEditor.testConnection")}
                                                        </Button>
                                                    )}
                                                    <Button size="small" icon={<Copy className="size-3.5" />} aria-label={t("config.channels.duplicate")} title={t("config.channels.duplicate")} onClick={() => duplicateChannel(channel)} />
                                                    <Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => setEditingChannelId(channel.id)}>
                                                        {t("common.edit")}
                                                    </Button>
                                                    <Popconfirm title={t("config.channels.deleteConfirm")} okText={t("common.delete")} cancelText={t("common.cancel")} onConfirm={() => deleteChannel(channel.id)}>
                                                        <Button size="small" danger icon={<Trash2 className="size-3.5" />} aria-label={t("common.delete")} />
                                                    </Popconfirm>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ),
                    },
                    {
                        key: "tasks",
                        label: t("config.tabs.tasks"),
                        children: <ConfigTasks />,
                    },
                    {
                        key: "preferences",
                        label: t("config.tabs.preferences"),
                        children: (
                            <Form layout="vertical" requiredMark={false} className="max-w-5xl space-y-4">
                                <section className="rounded-[var(--r-lg)] border border-border bg-[var(--surface-card)] p-4">
                                    <div className="mb-3 text-sm font-semibold">{t("config.preferences.defaultModels")}</div>
                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                                        {modelGroups.map((group) => (
                                            <Form.Item key={group.modelKey} label={t(group.labelKey)} className="mb-0">
                                                <ModelPicker config={config} value={config[group.modelKey]} onChange={(model) => updateConfig(group.modelKey, model)} capability={group.capability} fullWidth />
                                            </Form.Item>
                                        ))}
                                    </div>
                                </section>
                                <section className="rounded-[var(--r-lg)] border border-border bg-[var(--surface-card)] p-4">
                                    <div className="mb-3 text-sm font-semibold">{t("config.preferences.generation")}</div>
                                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                    <Form.Item label={t("config.preferences.canvasImageCount")} extra={t("config.preferences.canvasImageCountDescription")} className="mb-4">
                                        <Input
                                            type="number"
                                            min={1}
                                            max={15}
                                            value={config.canvasImageCount}
                                            onChange={(event) => updateConfig("canvasImageCount", event.target.value)}
                                            onBlur={(event) => updateConfig("canvasImageCount", normalizeImageCount(event.target.value))}
                                        />
                                    </Form.Item>
                                    <Form.Item label={t("config.preferences.imageResolution")} className="mb-4">
                                        <Select aria-label={t("config.preferences.imageResolution")} value={inferMediaScale(config.size)} options={imageResolutionOptions} onChange={(scale) => updateConfig("size", computeMediaSize(scale, inferMediaRatio(config.size)))} />
                                    </Form.Item>
                                    <Form.Item label={t("config.preferences.videoResolution")} className="mb-4">
                                        <Select aria-label={t("config.preferences.videoResolution")} value={parseVideoResolution(config.vquality)} options={videoResolutionOptions} onChange={(value) => updateConfig("vquality", value)} />
                                    </Form.Item>
                                    <Form.Item label={t("config.preferences.audioVoice")} className="mb-4">
                                        <Select aria-label={t("config.preferences.audioVoice")} value={config.audioVoice} options={audioVoiceOptions} onChange={(value) => updateConfig("audioVoice", value)} />
                                    </Form.Item>
                                    <Form.Item label={t("config.preferences.audioFormat")} className="mb-4">
                                        <Select aria-label={t("config.preferences.audioFormat")} value={config.audioFormat} options={audioFormatOptions} onChange={(value) => updateConfig("audioFormat", value)} />
                                    </Form.Item>
                                    <Form.Item label={t("config.preferences.audioSpeed")} className="mb-4">
                                        <Input
                                            type="number"
                                            min={0.25}
                                            max={4}
                                            step={0.05}
                                            value={config.audioSpeed}
                                            onChange={(event) => updateConfig("audioSpeed", event.target.value)}
                                            onBlur={(event) => updateConfig("audioSpeed", normalizeAudioSpeedValue(event.target.value))}
                                        />
                                    </Form.Item>
                                </div>
                                <Form.Item label={t("config.preferences.regenerateBehavior")} className="mb-4">
                                    <Radio.Group value={config.nodeRegenerateBehavior} onChange={(event) => updateConfig("nodeRegenerateBehavior", event.target.value)} className="flex flex-col gap-2">
                                        <Radio value="overwrite">
                                            <span className="block text-sm font-medium">{t("config.preferences.regenerateBehaviorOverwrite")}</span>
                                            <span className="mt-0.5 block text-xs opacity-60">{t("config.preferences.regenerateBehaviorOverwriteDescription")}</span>
                                        </Radio>
                                        <Radio value="new-node">
                                            <span className="block text-sm font-medium">{t("config.preferences.regenerateBehaviorNewNode")}</span>
                                            <span className="mt-0.5 block text-xs opacity-60">{t("config.preferences.regenerateBehaviorNewNodeDescription")}</span>
                                        </Radio>
                                    </Radio.Group>
                                </Form.Item>
                                <Form.Item className="mb-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="text-sm">{t("config.preferences.autoFocusOnSelect")}</span>
                                        <Switch checked={config.autoFocusOnSelect} onChange={(checked) => updateConfig("autoFocusOnSelect", checked)} />
                                    </div>
                                </Form.Item>
                                <Form.Item label={t("config.preferences.audioInstructions")} className="mb-4">
                                    <Input.TextArea rows={2} value={config.audioInstructions} placeholder={t("config.preferences.audioInstructionsPlaceholder")} onChange={(event) => updateConfig("audioInstructions", event.target.value)} />
                                </Form.Item>
                                <Form.Item label={t("config.preferences.systemPrompt")} className="mb-0">
                                    <Input.TextArea rows={4} value={config.systemPrompt} placeholder={t("config.preferences.systemPromptPlaceholder")} onChange={(event) => updateConfig("systemPrompt", event.target.value)} />
                                </Form.Item>
                                </section>
                            </Form>
                        ),
                    },
                    {
                        key: "webdav",
                        label: "WebDAV",
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <section className="rounded-[var(--r-lg)] border border-border p-3">
                                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                            <div className="flex items-center gap-2 text-sm font-semibold">
                                                <Cloud className="size-4" />
                                                {t("config.webdav.title")}
                                            </div>
                                            <div className="mt-1 text-xs text-muted-foreground">{t("config.webdav.description")}</div>
                                        </div>
                                        <div className="text-xs text-muted-foreground">{webdav.lastSyncedAt ? t("config.webdav.lastSynced", { time: formatWebdavTime(webdav.lastSyncedAt, locale) }) : t("config.webdav.neverSynced")}</div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <Form.Item label={t("config.webdav.url")} className="mb-4">
                                            <Input value={webdav.url} placeholder="https://nas.example.com/webdav" onChange={(event) => updateWebdavConfig("url", event.target.value)} />
                                        </Form.Item>
                                        <Form.Item label={t("config.webdav.directory")} extra={t("config.webdav.directoryDescription", { manifest: WEBDAV_MANIFEST_FILE_NAME })} className="mb-4">
                                            <Input value={webdav.directory} placeholder="infinite-canvas" onChange={(event) => updateWebdavConfig("directory", event.target.value)} />
                                        </Form.Item>
                                        <Form.Item label={t("config.webdav.username")} className="mb-0">
                                            <Input value={webdav.username} autoComplete="username" onChange={(event) => updateWebdavConfig("username", event.target.value)} />
                                        </Form.Item>
                                        <Form.Item label={t("config.webdav.password")} className="mb-0">
                                            <Input.Password value={webdav.password} autoComplete="current-password" onChange={(event) => updateWebdavConfig("password", event.target.value)} />
                                        </Form.Item>
                                    </div>
                                    <div className="mt-4 flex flex-wrap items-center gap-2">
                                        <Button icon={<Wifi className="size-4" />} disabled={!webdavReady || syncingWebdav} loading={testingWebdav} onClick={() => void testWebdav()}>
                                            {t("config.webdav.test")}
                                        </Button>
                                        <Button type="primary" icon={<RefreshCw className="size-4" />} disabled={!webdavReady || testingWebdav} loading={syncingWebdav} onClick={() => void syncWebdav()}>
                                            {t(syncingWebdav ? "config.webdav.syncing" : "config.webdav.syncNow")}
                                        </Button>
                                        {webdavSyncStatus ? <span className="text-xs text-muted-foreground">{syncStageLabel(webdavSyncStatus, t)}</span> : null}
                                    </div>
                                    {syncingWebdav || webdavSyncStatus ? <WebdavProgressGrid progress={webdavDomainProgress} t={t} /> : null}
                                </section>
                            </Form>
                        ),
                    },
                    {
                        key: "local-storage",
                        label: t("config.tabs.localStorage"),
                        children: <ConfigLocalStorage active={activeTab === "local-storage"} />,
                    },
                ].filter((item) => !visibleTabs || visibleTabs.some((key) => key === item.key))}
            />
            {showDoneButton ? (
                <div className="mt-4 flex justify-end">
                    <Button type="primary" onClick={finishConfig}>
                        {t("common.done")}
                    </Button>
                </div>
            ) : null}
            <ChannelEditorDrawer open={Boolean(editingChannel)} channel={editingChannel} onSave={saveChannel} onClose={() => setEditingChannelId("")} />
        </>
    );
}

export function AppConfigModal() {
    const { t } = useTranslation();
    const { pathname } = useLocation();
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const configTab = useConfigStore((state) => state.configTab);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);

    // 切页时关闭弹窗：它是从顶栏齿轮打开的全局浮层，跟着路由走会在新页面盖住内容。
    useEffect(() => {
        setConfigDialogOpen(false);
    }, [pathname, setConfigDialogOpen]);

    return (
        <Modal
            destroyOnHidden
            title={
                <div>
                    <div className="text-lg font-semibold">{t("config.title")}</div>
                    <div className="mt-1 text-xs font-normal text-muted-foreground">{t("config.modalDescription")}</div>
                </div>
            }
            open={isConfigOpen}
            width={980}
            centered
            onCancel={() => setConfigDialogOpen(false)}
            styles={{ body: { maxHeight: "72vh", overflowY: "auto", paddingRight: 12 } }}
            footer={null}
        >
            <AppConfigPanel showDoneButton initialTab={configTab} />
        </Modal>
    );
}

function withChannels(config: AiConfig, channels: ModelChannel[]): AiConfig {
    const next: AiConfig = {
        ...config,
        channels,
        models: modelOptionsFromChannels(channels),
        baseUrl: channels[0]?.baseUrl || config.baseUrl,
        apiKey: channels[0]?.apiKey || config.apiKey,
        apiFormat: channels[0]?.apiFormat || config.apiFormat,
    };
    return {
        ...next,
        imageModel: pickDefaultModel(next, "image", config.imageModel),
        videoModel: pickDefaultModel(next, "video", config.videoModel),
        textModel: pickDefaultModel(next, "text", config.textModel),
        audioModel: pickDefaultModel(next, "audio", config.audioModel),
    };
}

function pickDefaultModel(config: AiConfig, capability: ModelCapability, current: string) {
    const options = selectableModelsByCapability(config, capability);
    const normalized = normalizeModelOptionValue(current, config.channels);
    return options.includes(normalized) ? normalized : options[0] || "";
}

function normalizeImageCount(value: string) {
    return String(Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || 3))));
}

function apiFormatLabel(apiFormat: ApiCallFormat) {
    if (apiFormat === "runninghub") return "RunningHub";
    if (apiFormat === "gemini") return "Gemini";
    return "OpenAI";
}

function formatWebdavTime(value: string, locale: AppLocale) {
    return new Date(value).toLocaleString(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function WebdavProgressGrid({ progress, t }: { progress: Record<AppSyncDomainKey, WebdavDomainProgress>; t: TFunction }) {
    return (
        <div className="mt-3 grid gap-2">
            {webdavDomainKeys.map((key) => {
                const item = progress[key];
                const count = item.total ? `${item.current || 0}/${item.total}` : "";
                return (
                    <div key={key} className="rounded-[var(--r-md)] border border-border px-3 py-2">
                        <div className="mb-1 flex min-w-0 items-center justify-between gap-3 text-xs">
                            <span className="shrink-0 font-medium text-foreground">{t(`config.webdav.domains.${domainTranslationKey(key)}`)}</span>
                            <span className="min-w-0 truncate text-right text-muted-foreground">
                                {syncStageLabel(item.stage, t)}
                                {count ? ` · ${count}` : ""}
                            </span>
                        </div>
                        <Progress percent={getWebdavProgressPercent(item)} size="small" status={getWebdavProgressStatus(item)} showInfo={false} />
                    </div>
                );
            })}
        </div>
    );
}

function domainTranslationKey(domain: AppSyncDomainKey) {
    if (domain === "image-workbench") return "imageWorkbench";
    if (domain === "video-workbench") return "videoWorkbench";
    return domain;
}

function syncStageLabel(stage: string, t: TFunction) {
    if (stage === "等待本地数据加载") return t("config.webdav.stages.localWaiting");
    if (stage === "同步完成") return t("config.webdav.stages.syncComplete");
    if (stage === "等待同步") return t("config.webdav.stages.waiting");
    if (stage === "读取远端清单") return t("config.webdav.stages.remoteManifest");
    if (stage === "读取本地数据") return t("config.webdav.stages.localData");
    if (stage === "下载缺失媒体") return t("config.webdav.stages.downloadMedia");
    if (stage === "写入本地合并结果") return t("config.webdav.stages.writeMerge");
    if (stage === "上传新增媒体") return t("config.webdav.stages.uploadMedia");
    if (stage === "媒体已齐全") return t("config.webdav.stages.mediaReady");
    if (stage === "媒体无需上传") return t("config.webdav.stages.mediaSkipped");
    if (stage === "检查缺失媒体") return t("config.webdav.stages.checkMissingMedia");
    if (stage === "下载媒体") return t("config.webdav.stages.downloadMediaFile");
    if (stage === "检查本地媒体") return t("config.webdav.stages.checkLocalMedia");
    if (stage.startsWith("上传媒体 ")) return t("config.webdav.stages.uploadMediaFile", { size: stage.slice(5) });
    if (stage === "完成") return t("config.webdav.stages.complete");
    if (stage.startsWith("上传清单 ")) return t("config.webdav.stages.uploadManifest", { size: stage.slice(5) });
    return stage;
}

function getWebdavProgressPercent(item: WebdavDomainProgress) {
    if (item.status === "success") return 100;
    if (item.total) return Math.min(100, Math.round(((item.current || 0) / item.total) * 100));
    if (item.status === "exception") return 100;
    if (item.stage === "等待同步") return 0;
    if (item.stage === "读取远端清单") return 12;
    if (item.stage === "读取本地数据") return 24;
    if (item.stage === "下载缺失媒体") return 36;
    if (item.stage === "写入本地合并结果") return 58;
    if (item.stage === "上传新增媒体") return 66;
    if (item.stage === "媒体已齐全" || item.stage === "媒体无需上传") return 74;
    if (item.stage.startsWith("上传清单")) return 90;
    return item.status === "active" ? 30 : 0;
}

function getWebdavProgressStatus(item: WebdavDomainProgress): "normal" | "active" | "success" | "exception" {
    if (item.status === "success" || item.status === "exception") return item.status;
    return item.status === "active" ? "active" : "normal";
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
