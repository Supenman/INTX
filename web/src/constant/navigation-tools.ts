import { BookOpen, Clapperboard, Images, ListChecks, Maximize2, Settings2 } from "lucide-react";

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
        slug: "config",
        icon: Settings2,
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
