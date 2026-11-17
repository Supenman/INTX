import { FolderPlus, Search, SearchX } from "lucide-react";
import { type ReactNode, type UIEvent, useEffect, useState } from "react";
import { App, Button, Input, Spin, Tag } from "antd";
import { useTranslation } from "react-i18next";

import { PageHeader, PageShell } from "@/components/layout/page-header";
import { PromptCard } from "@/components/prompts/prompt-card";
import { usePromptList } from "@/components/prompts/use-prompt-list";
import { PromptDetailDialog } from "./components/prompt-detail-dialog";
import { useCopyText } from "@/hooks/use-copy-text";
import { cn } from "@/lib/utils";
import { useAssetStore } from "@/stores/use-asset-store";
import { ALL_PROMPTS_OPTION, type Prompt } from "@/services/api/prompts";

export default function PromptsPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [titleKeyword, setTitleKeyword] = useState("");
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [selectedCategory, setSelectedCategory] = useState(ALL_PROMPTS_OPTION);
    const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
    const addAsset = useAssetStore((state) => state.addAsset);
    const copyText = useCopyText();
    const { query, items: promptItems, tags: promptTags, categories: promptCategoryOptions, total: totalPrompts } = usePromptList({ keyword: titleKeyword, tags: selectedTags, category: selectedCategory });

    useEffect(() => {
        if (query.isError) message.error(query.error instanceof Error ? query.error.message : t("prompts.loadFailed"));
    }, [message, query.error, query.isError, t]);

    const toggleTag = (tag: string) => {
        if (tag === ALL_PROMPTS_OPTION) return setSelectedTags([]);
        setSelectedTags((items) => (items.includes(tag) ? items.filter((item) => item !== tag) : [...items, tag]));
    };

    const savePromptAsset = async (item: Prompt) => {
        addAsset({ kind: "text", title: item.title, coverUrl: item.coverUrl, tags: item.tags, source: item.category, data: { content: item.prompt }, metadata: { source: "prompt-library", promptId: item.id, githubUrl: item.githubUrl } });
        try {
            await useAssetStore.getState().confirmSave();
            message.success(t("common.addedToAssets"));
        } catch {
            message.error(t("common.saveToLocalFailed"));
        }
    };

    const handleListScroll = (event: UIEvent<HTMLDivElement>) => {
        const target = event.currentTarget;
        if (query.hasNextPage && !query.isFetchingNextPage && target.scrollTop + target.clientHeight >= target.scrollHeight - 160) void query.fetchNextPage();
    };

    const hasFilter = Boolean(titleKeyword.trim()) || selectedTags.length > 0 || selectedCategory !== ALL_PROMPTS_OPTION;

    return (
        <PageShell className="px-4 py-4 sm:px-6 sm:py-5">
            <main className="min-h-0 flex-1 overflow-y-auto" onScroll={handleListScroll}>
                <PageHeader
                    title={t("prompts.title")}
                    description={t("prompts.total", { count: totalPrompts })}
                    actions={
                        <Input
                            allowClear
                            prefix={<Search className="size-3.5 text-muted-foreground" />}
                            value={titleKeyword}
                            placeholder={t("prompts.search")}
                            onChange={(event) => setTitleKeyword(event.target.value)}
                            className="w-full sm:w-72"
                        />
                    }
                />

                <div className="mt-5 grid grid-cols-1 items-start gap-6 lg:grid-cols-[208px_minmax(0,1fr)]">
                    <aside className="thin-scrollbar min-w-0 border-b border-border/60 pb-5 lg:sticky lg:top-0 lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto lg:border-b-0 lg:pb-2">
                        <PromptFilter label={t("prompts.category")} options={promptCategoryOptions} selected={selectedCategory} onChange={setSelectedCategory} />
                        <div className="mt-6">
                            <div className="typ-overline mb-2.5 text-muted-foreground">{t("prompts.tags")}</div>
                            <div className="flex flex-wrap gap-1.5">
                                {promptTags.map((tag) => {
                                    const active = tag === ALL_PROMPTS_OPTION ? selectedTags.length === 0 : selectedTags.includes(tag);
                                    return (
                                        <Tag.CheckableTag key={tag} checked={active} className={cn("prompt-filter-tag", active && "is-active")} onChange={() => toggleTag(tag)}>
                                            {tag === ALL_PROMPTS_OPTION ? t("common.all") : tag}
                                        </Tag.CheckableTag>
                                    );
                                })}
                            </div>
                        </div>
                    </aside>

                    <section className="min-w-0">
                        {query.isLoading ? (
                            <div className="flex h-64 items-center justify-center rounded-xl bg-[var(--surface-sunken)]">
                                <Spin />
                            </div>
                        ) : null}
                        {!query.isLoading ? (
                            <PromptGrid
                                items={promptItems}
                                onOpen={setSelectedPrompt}
                                renderActions={(item) => (
                                    <Button type="text" size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => savePromptAsset(item)}>
                                        {t("common.addToAssets")}
                                    </Button>
                                )}
                                onCopy={(item) => copyText(item.prompt, t("common.promptCopied"))}
                                emptyTitle={hasFilter ? t("prompts.empty") : t("prompts.emptyAll")}
                                emptyHint={hasFilter ? t("prompts.emptyFilteredHint") : t("prompts.emptyAllHint")}
                            />
                        ) : null}
                        <div className="typ-caption mt-6 text-center text-muted-foreground">{query.isFetchingNextPage ? t("prompts.loading") : query.hasNextPage ? t("prompts.loadMore") : promptItems.length > 0 ? t("prompts.end") : null}</div>
                    </section>
                </div>
            </main>

            <PromptDetailDialog prompt={selectedPrompt} onClose={() => setSelectedPrompt(null)} onCopy={(prompt) => copyText(prompt, t("common.promptCopied"))} onSaveAsset={savePromptAsset} />
        </PageShell>
    );
}

function PromptFilter({ label, options, selected, onChange }: { label: string; options: string[]; selected: string; onChange: (value: string) => void }) {
    const { t } = useTranslation();
    return (
        <div>
            <div className="typ-overline mb-2.5 text-muted-foreground">{label}</div>
            <div className="flex flex-wrap gap-1.5">
                {options.map((option) => (
                    <Tag.CheckableTag key={option} checked={selected === option} className={cn("prompt-filter-tag", selected === option && "is-active")} onChange={() => onChange(option)}>
                        {option === ALL_PROMPTS_OPTION ? t("common.all") : option}
                    </Tag.CheckableTag>
                ))}
            </div>
        </div>
    );
}

function PromptGrid({
    items,
    onOpen,
    onCopy,
    renderActions,
    emptyTitle,
    emptyHint,
}: {
    items: Prompt[];
    onOpen: (item: Prompt) => void;
    onCopy: (item: Prompt) => void;
    renderActions: (item: Prompt) => ReactNode;
    emptyTitle: string;
    emptyHint: string;
}) {
    if (!items.length) return <PromptEmpty title={emptyTitle} hint={emptyHint} />;
    return (
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {items.map((item) => (
                <div key={`${item.sourceId}:${item.id}`} className="min-w-0">
                    <PromptCard item={item} onOpen={() => onOpen(item)} onCopy={() => onCopy(item)} extraAction={renderActions(item)} />
                </div>
            ))}
        </div>
    );
}

function PromptEmpty({ title, hint }: { title: string; hint: string }) {
    return (
        <div className="flex min-h-[280px] flex-col items-center justify-center rounded-xl bg-[var(--surface-sunken)] px-6 py-16 text-center">
            <div className="flex size-11 items-center justify-center rounded-full bg-[var(--surface-card)] text-muted-foreground">
                <SearchX className="size-5" />
            </div>
            <p className="typ-heading mt-4">{title}</p>
            <p className="typ-caption mt-1.5 max-w-xs text-muted-foreground">{hint}</p>
        </div>
    );
}
