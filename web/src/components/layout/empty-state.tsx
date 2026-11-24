import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * 统一空状态：图标 + 标题 + 说明 + 可选动作。
 *
 * 项目库和资产页此前各写一份，`mt-4/mt-5`、`min-h-280/360` 对不上，切页时
 * 视觉会跳。这里只统一结构，不改各页自己的文案。
 */
export function EmptyState({
    icon: Icon,
    title,
    description,
    action,
    className,
}: {
    icon: LucideIcon;
    title: string;
    description?: string;
    action?: ReactNode;
    className?: string;
}) {
    return (
        <section className={cn("flex min-h-[280px] flex-col items-center justify-center rounded-xl bg-[var(--surface-sunken)] px-6 py-16 text-center", className)}>
            <div className="flex size-11 items-center justify-center rounded-full bg-[var(--surface-card)] text-muted-foreground">
                <Icon className="size-5" />
            </div>
            <p className="typ-heading mt-4">{title}</p>
            {description ? <p className="typ-caption mt-1.5 max-w-xs text-muted-foreground">{description}</p> : null}
            {action ? <div className="mt-5">{action}</div> : null}
        </section>
    );
}
