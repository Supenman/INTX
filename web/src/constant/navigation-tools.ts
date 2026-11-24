import { BookOpen, Clapperboard, HardDrive, Images, ListChecks, Maximize2, Settings2 } from "lucide-react";

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
    {
        slug: "config-channels",
        icon: Settings2,
        to: "/config?tab=channels",
    },
    {
        slug: "config-storage",
        icon: HardDrive,
        to: "/config?tab=local-storage",
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
