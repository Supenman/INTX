import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Modal, Input, type InputRef } from "antd";
import { BookOpen, Bot, Clapperboard, FolderKanban, HardDrive, House, Images, ListChecks, Maximize2, Plus, Search, Settings2, SlidersHorizontal, type LucideIcon } from "lucide-react";

import { useAgentStore } from "@/stores/use-agent-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { cn } from "@/lib/utils";
import { isImeComposing } from "@/lib/keyboard-event";

type CommandItem = {
    id: string;
    label: string;
    hint?: string;
    icon: LucideIcon;
    run: () => void;
    /** 匹配用的额外关键词（拼音/英文别名），避免只能靠中文文案搜到。 */
    keywords?: string;
};

/**
 * 全局命令面板（⌘K / Ctrl+K）。
 *
 * 只收「去哪」和「新建」两类动作，不做设置项开关——那类动作留在设置页，
 * 否则面板会变成第二套入口。最近项目按更新时间取前 5 个。
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [query, setQuery] = useState("");
    const [activeIndex, setActiveIndex] = useState(0);
    const inputRef = useRef<InputRef>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const projects = useCanvasStore((state) => state.projects);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const createProject = useCanvasStore((state) => state.createProject);
    const toggleAgent = useAgentStore((state) => state.togglePanel);

    const close = useCallback(() => {
        onClose();
    }, [onClose]);

    const afterOpenChange = (visible: boolean) => {
        if (visible) {
            inputRef.current?.focus({ preventScroll: true });
        } else {
            setQuery("");
            setActiveIndex(0);
        }
    };

    const go = useCallback((to: string) => {
        navigate(to);
        close();
    }, [close, navigate]);

    const items = useMemo<CommandItem[]>(() => {
        const base: CommandItem[] = [
            { id: "new-canvas", label: t("commandPalette.newCanvas"), icon: Plus, keywords: "new canvas create xinjian", run: () => {
                if (!hydrated) return;
                const id = createProject(t("canvas.defaultTitle", { count: projects.length + 1 }));
                go(`/canvas/${id}`);
            } },
            { id: "home", label: t("navigation.home"), icon: House, keywords: "home shouye", run: () => go("/") },
            { id: "canvas", label: t("navigation.canvas"), icon: Maximize2, keywords: "canvas project huabu xiangmu", run: () => go("/canvas") },
            { id: "editing-studio", label: t("navigation.editing-studio"), icon: Clapperboard, keywords: "editing studio jianjitai", run: () => go("/editing-studio") },
            { id: "assets", label: t("navigation.assets"), icon: Images, keywords: "assets sucai zichan", run: () => go("/assets") },
            { id: "skills", label: t("navigation.skills"), icon: BookOpen, keywords: "skills jineng", run: () => go("/skills") },
            { id: "tasks", label: t("navigation.tasks"), icon: ListChecks, keywords: "tasks renwu", run: () => go("/tasks") },
            { id: "config-channels", label: t("navigation.config-channels"), icon: Settings2, keywords: "model channel qudao moxing", run: () => go("/config?tab=channels") },
            { id: "config-storage", label: t("navigation.config-storage"), icon: HardDrive, keywords: "storage cunchu", run: () => go("/config?tab=local-storage") },
            { id: "config-preferences", label: t("navigation.config-preferences"), icon: SlidersHorizontal, keywords: "preferences pianhao", run: () => go("/config?tab=preferences") },
            { id: "agent", label: t("commandPalette.toggleAgent"), icon: Bot, keywords: "agent zhineng", run: () => {
                toggleAgent();
                close();
            } },
        ];
        const recent = [...projects]
            .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
            .slice(0, 5)
            .map<CommandItem>((project) => ({
                id: `project-${project.id}`,
                label: project.title,
                hint: t("commandPalette.recentProject"),
                icon: FolderKanban,
                keywords: project.title,
                run: () => go(`/canvas/${project.id}`),
            }));
        return [...base, ...recent];
    }, [close, createProject, go, hydrated, projects, t, toggleAgent]);

    const results = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) return items;
        return items.filter((item) => `${item.label} ${item.keywords ?? ""}`.toLowerCase().includes(needle));
    }, [items, query]);

    useEffect(() => {
        setActiveIndex(0);
    }, [query]);

    // 结果变化时把高亮项滚进可视区，避免键盘走到列表外。
    useEffect(() => {
        listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
    }, [activeIndex]);

    const onKeyDown = (event: ReactKeyboardEvent) => {
        if (isImeComposing(event)) return;
        if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((index) => (results.length ? (index + 1) % results.length : 0));
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((index) => (results.length ? (index - 1 + results.length) % results.length : 0));
        } else if (event.key === "Enter") {
            event.preventDefault();
            results[activeIndex]?.run();
        } else if (event.key === "Escape") {
            event.preventDefault();
            close();
        }
    };

    const onResultKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (isImeComposing(event) || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-index]"));
        const index = buttons.findIndex((button) => button === document.activeElement);
        if (index < 0) return;
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        buttons[(index + direction + buttons.length) % buttons.length]?.focus();
    };

    return (
        <Modal
            open={open}
            onCancel={close}
            afterOpenChange={afterOpenChange}
            aria-label={t("commandPalette.open")}
            focusable={{ focusTriggerAfterClose: true }}
            footer={null}
            closable={false}
            width={560}
            styles={{ body: { padding: 0 } }}
            destroyOnHidden
        >
            <div className="border-b border-border p-3" onKeyDown={onKeyDown}>
                <Input
                    ref={inputRef}
                    variant="borderless"
                    prefix={<Search className="size-4 text-muted-foreground" />}
                    placeholder={t("commandPalette.placeholder")}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                />
            </div>
            <div ref={listRef} onKeyDown={onResultKeyDown} className="max-h-[50vh] overflow-y-auto overscroll-contain p-2">
                {results.length ? results.map((item, index) => {
                    const Icon = item.icon;
                    return (
                        <button
                            key={item.id}
                            type="button"
                            data-index={index}
                            onMouseEnter={() => setActiveIndex(index)}
                            onFocus={() => setActiveIndex(index)}
                            onClick={item.run}
                            className={cn(
                                "focus-ring flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm motion-safe:transition-colors",
                                index === activeIndex ? "bg-[var(--surface-card-hover)] text-foreground" : "text-muted-foreground",
                            )}
                        >
                            <Icon className="size-4 shrink-0" />
                            <span className="min-w-0 flex-1 truncate">{item.label}</span>
                            {item.hint ? <span className="shrink-0 text-xs text-muted-foreground">{item.hint}</span> : null}
                        </button>
                    );
                }) : <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t("commandPalette.noResults")}</p>}
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-border px-3 py-2 text-xs text-muted-foreground">
                <span>↑↓ {t("commandPalette.navigate")}</span>
                <span>↵ {t("commandPalette.select")}</span>
                <span>Esc {t("commandPalette.close")}</span>
            </div>
        </Modal>
    );
}
