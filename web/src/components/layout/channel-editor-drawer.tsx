import { App, Button, Drawer, Input, InputNumber, Segmented, Select, Space } from "antd";
import { CheckCircle2, ListPlus, Plus, Search, Trash2, Wifi, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { createModelChannel, defaultBaseUrlForApiFormat, guessCapability, normalizeChannelModels, type ApiCallFormat, type ChannelModel, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";
import { isRunningHubEndpoint } from "@/domain/provider/endpoints";
import { fetchChannelModels } from "@/services/api/image";
import { ModelScriptEditor } from "./model-script-editor";
import { ModelSelectModal } from "./model-select-modal";

type ScriptTarget = { name: string; capability: ModelCapability; value: string };
type CapabilityFilter = "all" | ModelCapability;
type ConnectionTestState =
    | { status: "idle" }
    | { status: "ok"; count: number; ms: number }
    | { status: "error"; message: string };

export function ChannelEditorDrawer({ open, channel, onSave, onClose }: { open: boolean; channel: ModelChannel | null; onSave: (channel: ModelChannel) => void; onClose: () => void }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [draft, setDraft] = useState<ModelChannel | null>(channel);
    const [selectOpen, setSelectOpen] = useState(false);
    const [scriptTarget, setScriptTarget] = useState<ScriptTarget | null>(null);
    const [quickModelName, setQuickModelName] = useState("");
    const [modelSearch, setModelSearch] = useState("");
    const [capabilityFilter, setCapabilityFilter] = useState<CapabilityFilter>("all");
    const [testing, setTesting] = useState(false);
    const [testState, setTestState] = useState<ConnectionTestState>({ status: "idle" });

    const apiFormatOptions: Array<{ label: string; value: ApiCallFormat }> = [
        { label: "OpenAI", value: "openai" },
        { label: "Gemini", value: "gemini" },
        { label: "RunningHub", value: "runninghub" },
    ];
    const capabilityOptions: Array<{ label: string; value: ModelCapability }> = ["image", "video", "text", "audio"].map((value) => ({ label: t(`config.channelEditor.capabilities.${value}`), value: value as ModelCapability }));
    const filterOptions: Array<{ label: string; value: CapabilityFilter }> = [
        { label: t("common.all"), value: "all" },
        ...capabilityOptions,
    ];

    useEffect(() => {
        if (open && channel) {
            setDraft(channel);
            setQuickModelName("");
            setModelSearch("");
            setCapabilityFilter("all");
            setTestState({ status: "idle" });
        }
    }, [open, channel]);

    const filteredModels = useMemo(() => {
        if (!draft) return [];
        const keyword = modelSearch.trim().toLowerCase();
        return draft.models.filter((model) => {
            if (capabilityFilter !== "all" && model.capability !== capabilityFilter) return false;
            return !keyword || model.name.toLowerCase().includes(keyword);
        });
    }, [capabilityFilter, draft, modelSearch]);

    if (!draft) return null;
    const runningHub = draft.apiFormat === "runninghub";

    const patch = (value: Partial<ModelChannel>) => {
        setDraft((current) => (current ? { ...current, ...value } : current));
        if ("baseUrl" in value || "apiKey" in value || "apiFormat" in value || "proxyMode" in value) {
            setTestState({ status: "idle" });
        }
    };
    const setModels = (models: ChannelModel[]) => patch({ models });

    const changeApiFormat = (apiFormat: ApiCallFormat) => {
        if (apiFormat === "runninghub") {
            patch(createModelChannel({ ...draft, apiFormat, baseUrl: defaultBaseUrlForApiFormat(apiFormat), apiKey: isRunningHubEndpoint(draft.baseUrl) ? draft.apiKey : "" }));
            return;
        }
        const baseUrl = !draft.baseUrl.trim() || draft.baseUrl.trim() === defaultBaseUrlForApiFormat(draft.apiFormat) ? defaultBaseUrlForApiFormat(apiFormat) : draft.baseUrl;
        patch(runningHub ? { apiFormat, baseUrl, apiKey: "", models: [] } : { apiFormat, baseUrl });
    };

    const applySelection = (names: string[]) => {
        const map = new Map(draft.models.map((model) => [model.name, model]));
        setModels(names.map((name) => map.get(name) || { name, capability: guessCapability(name) }));
    };

    const addQuickModel = () => {
        const name = quickModelName.trim();
        if (!name) return;
        if (draft.models.some((model) => model.name === name)) {
            message.info(t("config.channelEditor.modelExists"));
            return;
        }
        setModels([{ name, capability: guessCapability(name) }, ...draft.models]);
        setQuickModelName("");
    };

    const testConnection = async () => {
        if (!draft.baseUrl.trim() || !draft.apiKey.trim()) {
            message.error(t("config.modelSelect.missingConfig"));
            return;
        }
        setTesting(true);
        const startedAt = performance.now();
        try {
            const models = await fetchChannelModels(draft);
            const ms = Math.max(1, Math.round(performance.now() - startedAt));
            setTestState({ status: "ok", count: models.length, ms });
            message.success(t("config.channelEditor.testSuccess", { count: models.length, ms }));
        } catch (error) {
            const detail = error instanceof Error ? error.message : t("config.modelSelect.fetchFailed");
            setTestState({ status: "error", message: detail });
            message.error(detail);
        } finally {
            setTesting(false);
        }
    };

    const setCapability = (name: string, capability: ModelCapability) => setModels(draft.models.map((model) => (model.name === name ? { ...model, capability } : model)));
    const setScript = (name: string, script: string) => setModels(draft.models.map((model) => (model.name === name ? { ...model, script: script || undefined } : model)));
    /** 单价：只有正的有限数字才留下，否则清空（预估显示「未配置单价」）。 */
    const setPricing = (name: string, pricePatch: { amount?: number | null; currency?: string }) =>
        setModels(
            draft.models.map((model) => {
                if (model.name !== name) return model;
                const amount = pricePatch.amount === undefined ? model.pricing?.perImage : pricePatch.amount ?? undefined;
                const currency = pricePatch.currency ?? model.pricing?.currency ?? "CNY";
                const valid = typeof amount === "number" && Number.isFinite(amount) && amount > 0;
                return { ...model, pricing: valid ? { perImage: amount, currency } : undefined };
            }),
        );
    const removeModel = (name: string) => setModels(draft.models.filter((model) => model.name !== name));

    const save = () => {
        onSave({ ...draft, name: draft.name.trim() || t("config.channels.unnamed"), models: normalizeChannelModels(draft.models) });
        onClose();
    };

    return (
        <Drawer
            open={open}
            size={680}
            title={t("config.channelEditor.title")}
            onClose={onClose}
            styles={{ body: { paddingTop: 16 } }}
            extra={
                <Space>
                    <Button onClick={onClose}>{t("common.cancel")}</Button>
                    <Button type="primary" onClick={save}>
                        {t("common.save")}
                    </Button>
                </Space>
            }
        >
            <div className="grid grid-cols-2 gap-4">
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.name")}</span>
                    <Input value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
                </label>
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.protocol")}</span>
                    <Select className="w-full" value={draft.apiFormat} options={apiFormatOptions} onChange={changeApiFormat} />
                </label>
                <label className="col-span-2 block">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.baseUrl")}</span>
                    <Input value={draft.baseUrl} readOnly={runningHub} onChange={(event) => patch({ baseUrl: event.target.value })} placeholder="https://api.example.com" />
                </label>
                <label className="col-span-2 block">
                    <span className="mb-1 block text-sm font-medium">API Key</span>
                    <Input.Password value={draft.apiKey} onChange={(event) => patch({ apiKey: event.target.value })} placeholder="sk-..." />
                    {runningHub ? <span className="mt-1 block text-xs text-muted-foreground">{t("config.channelEditor.runningHubKey")}</span> : null}
                </label>
                <div className="col-span-2 flex flex-wrap items-center justify-between gap-2 rounded-[var(--r-md)] border border-border bg-[var(--surface-sunken)] px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2 text-xs">
                        {testState.status === "ok" ? (
                            <>
                                <CheckCircle2 className="size-4 shrink-0 text-[var(--status-success)]" />
                                <span className="truncate text-foreground">{t("config.channelEditor.testSuccess", { count: testState.count, ms: testState.ms })}</span>
                            </>
                        ) : testState.status === "error" ? (
                            <>
                                <XCircle className="size-4 shrink-0 text-destructive" />
                                <span className="truncate text-destructive" title={testState.message}>{testState.message}</span>
                            </>
                        ) : (
                            <span className="text-muted-foreground">{t("config.channelEditor.testIdleHint")}</span>
                        )}
                    </div>
                    {runningHub ? null : (
                        <Button size="small" icon={<Wifi className="size-3.5" />} loading={testing} disabled={!draft.baseUrl.trim() || !draft.apiKey.trim()} onClick={() => void testConnection()}>
                            {t("config.channelEditor.testConnection")}
                        </Button>
                    )}
                </div>
            </div>

            <div className="mt-6 mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                    <div className="text-sm font-semibold">{t("config.channelEditor.models")}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{t("config.channelEditor.modelDescription", { count: draft.models.length })}</div>
                </div>
                {runningHub ? null : (
                    <Button type="primary" icon={<ListPlus className="size-4" />} onClick={() => setSelectOpen(true)}>
                        {t("config.channelEditor.selectModels")}
                    </Button>
                )}
            </div>

            {!runningHub ? (
                <div className="mb-3 flex flex-wrap items-center gap-2">
                    <Input
                        className="min-w-[180px] flex-1"
                        size="small"
                        value={quickModelName}
                        placeholder={t("config.channelEditor.quickAddPlaceholder")}
                        onChange={(event) => setQuickModelName(event.target.value)}
                        onPressEnter={addQuickModel}
                    />
                    <Button size="small" icon={<Plus className="size-3.5" />} disabled={!quickModelName.trim()} onClick={addQuickModel}>
                        {t("config.modelSelect.add")}
                    </Button>
                </div>
            ) : null}

            {draft.models.length > 0 ? (
                <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                    <Input
                        size="small"
                        className="w-48"
                        value={modelSearch}
                        onChange={(event) => setModelSearch(event.target.value)}
                        placeholder={t("config.modelSelect.search")}
                        prefix={<Search className="size-3.5 text-muted-foreground" />}
                        allowClear
                    />
                    <Segmented size="small" value={capabilityFilter} options={filterOptions} onChange={(value) => setCapabilityFilter(value as CapabilityFilter)} />
                </div>
            ) : null}

            <div className="space-y-1.5 rounded-lg border border-border p-2">
                {filteredModels.length ? (
                    filteredModels.map((model) => (
                        <div key={model.name} className="flex flex-wrap items-center gap-3 rounded-md px-2 py-1.5 transition hover:bg-[var(--surface-card-hover)]">
                            <span className="min-w-0 flex-1 truncate text-sm" title={model.name}>
                                {model.name}
                            </span>
                            <div className="flex shrink-0 items-center gap-2">
                                <Segmented disabled={runningHub} size="small" value={model.capability} options={capabilityOptions} onChange={(value) => setCapability(model.name, value as ModelCapability)} />
                                {model.capability === "image" || model.capability === "video" ? (
                                    <div className="flex items-center gap-1">
                                        <InputNumber
                                            size="small"
                                            className="w-20"
                                            min={0}
                                            step={0.01}
                                            placeholder={t("config.channelEditor.price")}
                                            title={t("config.channelEditor.priceHint")}
                                            value={model.pricing?.perImage}
                                            onChange={(value) => setPricing(model.name, { amount: typeof value === "number" ? value : null })}
                                        />
                                        <Select
                                            size="small"
                                            className="w-[4.25rem]"
                                            value={model.pricing?.currency ?? "CNY"}
                                            options={[{ value: "CNY" }, { value: "USD" }]}
                                            onChange={(currency) => setPricing(model.name, { currency })}
                                        />
                                    </div>
                                ) : null}
                                {runningHub ? null : (
                                    <Button size="small" type={model.script ? "primary" : "default"} ghost={Boolean(model.script)} onClick={() => setScriptTarget({ name: model.name, capability: model.capability, value: model.script || "" })}>
                                        {t(model.script ? "config.channelEditor.scriptReady" : "config.channelEditor.script")}
                                    </Button>
                                )}
                                {runningHub ? null : <Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />} onClick={() => removeModel(model.name)} />}
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="px-2 py-8 text-center text-sm text-muted-foreground">
                        {draft.models.length ? t("config.channelEditor.noMatchingModels") : t("config.channelEditor.empty")}
                    </div>
                )}
            </div>

            <ModelSelectModal open={selectOpen} channel={draft} selectedNames={draft.models.map((model) => model.name)} onConfirm={applySelection} onClose={() => setSelectOpen(false)} />

            <ModelScriptEditor
                open={Boolean(scriptTarget)}
                capability={scriptTarget?.capability || "text"}
                modelName={scriptTarget?.name || ""}
                value={scriptTarget?.value || ""}
                onSave={(script) => scriptTarget && setScript(scriptTarget.name, script)}
                onClose={() => setScriptTarget(null)}
            />
        </Drawer>
    );
}
