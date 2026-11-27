import { App, Button, Checkbox, Input, Modal, Segmented, Tabs } from "antd";
import { RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { fetchChannelModels } from "@/services/api/image";
import { guessCapability, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";

type CapabilityFilter = "all" | ModelCapability;

// Channel model selector: fetch upstream models or add them manually, filter by capability, and include checked models.
export function ModelSelectModal({ open, channel, selectedNames, onConfirm, onClose }: { open: boolean; channel: ModelChannel | null; selectedNames: string[]; onConfirm: (names: string[]) => void; onClose: () => void }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [existing, setExisting] = useState<string[]>([]);
    const [fetched, setFetched] = useState<string[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [activeTab, setActiveTab] = useState("new");
    const [search, setSearch] = useState("");
    const [capabilityFilter, setCapabilityFilter] = useState<CapabilityFilter>("all");
    const [manual, setManual] = useState("");
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!open) return;
        setExisting(selectedNames);
        setFetched([]);
        setSelected(new Set(selectedNames));
        setActiveTab(selectedNames.length ? "existing" : "new");
        setSearch("");
        setCapabilityFilter("all");
        setManual("");
    }, [open, selectedNames]);

    const currentList = activeTab === "new" ? fetched : existing;
    const visibleList = useMemo(() => {
        const keyword = search.trim().toLowerCase();
        return currentList.filter((name) => {
            if (capabilityFilter !== "all" && guessCapability(name) !== capabilityFilter) return false;
            return !keyword || name.toLowerCase().includes(keyword);
        });
    }, [capabilityFilter, currentList, search]);
    const visibleSelectedCount = visibleList.filter((name) => selected.has(name)).length;

    const toggle = (name: string, checked: boolean) =>
        setSelected((current) => {
            const next = new Set(current);
            if (checked) next.add(name);
            else next.delete(name);
            return next;
        });

    const selectVisible = (checked: boolean) =>
        setSelected((current) => {
            const next = new Set(current);
            visibleList.forEach((name) => (checked ? next.add(name) : next.delete(name)));
            return next;
        });

    const addManual = () => {
        const name = manual.trim();
        if (!name) return;
        if (!fetched.includes(name) && !existing.includes(name)) setFetched((current) => [name, ...current]);
        setSelected((current) => new Set(current).add(name));
        setManual("");
        setActiveTab("new");
    };

    const fetchModels = async () => {
        if (!channel) return;
        if (!channel.baseUrl.trim() || !channel.apiKey.trim()) {
            message.error(t("config.modelSelect.missingConfig"));
            return;
        }
        setLoading(true);
        try {
            const models = await fetchChannelModels(channel);
            setFetched(models);
            setActiveTab("new");
            message.success(t("config.modelSelect.fetched", { count: models.length }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("config.modelSelect.fetchFailed"));
        } finally {
            setLoading(false);
        }
    };

    const confirm = () => {
        const ordered = [...existing, ...fetched].filter((name, index, list) => list.indexOf(name) === index).filter((name) => selected.has(name));
        onConfirm(ordered);
        onClose();
    };

    const filterOptions: Array<{ label: string; value: CapabilityFilter }> = [
        { label: t("common.all"), value: "all" },
        { label: t("config.channelEditor.capabilities.image"), value: "image" },
        { label: t("config.channelEditor.capabilities.video"), value: "video" },
        { label: t("config.channelEditor.capabilities.text"), value: "text" },
        { label: t("config.channelEditor.capabilities.audio"), value: "audio" },
    ];

    return (
        <Modal
            destroyOnHidden
            open={open}
            width={880}
            centered
            onCancel={onClose}
            title={
                <span>
                    {t("config.modelSelect.title")}{" "}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {t("config.modelSelect.selected", { selected: selected.size, total: new Set([...existing, ...fetched]).size })}
                    </span>
                </span>
            }
            styles={{ body: { maxHeight: "62vh", overflowY: "auto" } }}
            footer={[
                <Button key="cancel" onClick={onClose}>
                    {t("common.cancel")}
                </Button>,
                <Button key="confirm" type="primary" onClick={confirm}>
                    {t("config.modelSelect.confirm")}
                </Button>,
            ]}
        >
            <div className="flex flex-wrap items-center gap-2.5">
                <Input className="min-w-[200px] flex-1" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("config.modelSelect.search")} prefix={<Search className="size-4 text-muted-foreground" />} allowClear />
                <Input className="min-w-[180px] flex-1" value={manual} onChange={(event) => setManual(event.target.value)} onPressEnter={addManual} placeholder={t("config.modelSelect.modelName")} />
                <Button onClick={addManual}>{t("config.modelSelect.add")}</Button>
                <Button type="primary" ghost icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void fetchModels()}>
                    {t("config.modelSelect.fetch")}
                </Button>
            </div>
            <div className="mt-2 text-xs text-muted-foreground">{t("config.modelSelect.description")}</div>

            <Tabs
                className="mt-3"
                activeKey={activeTab}
                onChange={setActiveTab}
                items={[
                    { key: "new", label: t("config.modelSelect.fetchedTab", { count: fetched.length }) },
                    { key: "existing", label: t("config.modelSelect.existingTab", { count: existing.length }) },
                ]}
            />

            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                    <Segmented size="small" value={capabilityFilter} options={filterOptions} onChange={(value) => setCapabilityFilter(value as CapabilityFilter)} />
                    <span className="text-xs text-muted-foreground">{t("config.modelSelect.visibleSelected", { selected: visibleSelectedCount, total: visibleList.length })}</span>
                </div>
                <div className="flex gap-2">
                    <Button size="small" disabled={!visibleList.length} onClick={() => selectVisible(true)}>
                        {t("config.modelSelect.selectVisible")}
                    </Button>
                    <Button size="small" disabled={!visibleSelectedCount} onClick={() => selectVisible(false)}>
                        {t("config.modelSelect.clearVisible")}
                    </Button>
                </div>
            </div>

            {visibleList.length ? (
                <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
                    {visibleList.map((name) => {
                        const inferred = guessCapability(name);
                        return (
                            <Checkbox key={name} checked={selected.has(name)} onChange={(event) => toggle(name, event.target.checked)}>
                                <span className="inline-flex max-w-full items-center gap-1.5">
                                    <span className="truncate" title={name}>
                                        {name}
                                    </span>
                                    <span className="shrink-0 rounded bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[length:var(--fs-label)] text-muted-foreground">
                                        {t(`config.channelEditor.capabilities.${inferred}`)}
                                    </span>
                                </span>
                            </Checkbox>
                        );
                    })}
                </div>
            ) : (
                <div className="py-8 text-center text-sm text-muted-foreground">{t(activeTab === "new" ? "config.modelSelect.fetchedEmpty" : "config.modelSelect.existingEmpty")}</div>
            )}
        </Modal>
    );
}
