import { BookOpen, Clapperboard, HardDrive, Images, ListChecks, Maximize2, Settings2, SlidersHorizontal } from "lucide-react";
import type { ConfigTabKey } from "@/stores/use-config-store";

const configSections = [
    { slug: "config-channels", tabs: ["channels", "tasks", "local-proxy"], icon: Settings2 },
    { slug: "config-storage", tabs: ["local-storage", "webdav"], icon: HardDrive },
    { slug: "config-preferences", tabs: ["preferences"], icon: SlidersHorizontal },
] as const satisfies ReadonlyArray<{ slug: string; tabs: readonly ConfigTabKey[]; icon: typeof Settings2 }>;

export function configSectionForTab(tab: string | null) {
    return configSections.find((section) => section.tabs.some((key) => key === tab)) ?? configSections[0];
}

/**
 * 侧栏一级导航。
 *
 * `to` 可选：默认按 slug 拼 `/${slug}`；设置类入口用 query 直达具体分区，
 * 与 BeefTV 的「模型配置 / 存储设置」两个直达项对齐。
 */
export const navigationTools = [
    {
        slug: "canvas",
        icon: Maximize2,
    },
    {
        slug: "editing-studio",
        icon: Clapperboard,
    },
    {
        slug: "assets",
        icon: Images,
    },
    {
        slug: "skills",
        icon: BookOpen,
    },
    {
        slug: "tasks",
        icon: ListChecks,
    },
    ...configSections.map(({ slug, icon, tabs }) => ({ slug, icon, to: `/config?tab=${tabs[0]}` })),
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
