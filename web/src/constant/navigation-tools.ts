import { BookOpen, Clapperboard, HardDrive, Images, ListChecks, Maximize2, Settings2 } from "lucide-react";
import type { ConfigTabKey } from "@/stores/use-config-store";

/**
 * 设置分区收口（对齐 BeefTV 的「模型配置 / 存储设置」双入口）：
 * - 模型配置：统一承载渠道、使用偏好（默认模型与生成参数）、待核实任务与本地代理；
 * - 存储设置：统一承载本地存储与 WebDAV 同步。
 */
const configSections = [
    { slug: "config-channels", tabs: ["channels", "preferences", "tasks", "local-proxy"], icon: Settings2 },
    { slug: "config-storage", tabs: ["local-storage", "webdav"], icon: HardDrive },
] as const satisfies ReadonlyArray<{ slug: string; tabs: readonly ConfigTabKey[]; icon: typeof Settings2 }>;

export function configSectionForTab(tab: string | null) {
    return configSections.find((section) => section.tabs.some((key) => key === tab)) ?? configSections[0];
}

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
