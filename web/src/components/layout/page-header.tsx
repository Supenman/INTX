import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function PageHeader({
    title,
    description,
    actions,
    className,
}: {
    title: string;
    description?: string;
    actions?: ReactNode;
    className?: string;
}) {
    return (
        <header className={cn("flex min-h-16 flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-border/70 pb-4", className)}>
            <div className="min-w-0">
                <h1 className="typ-title text-foreground">{title}</h1>
                {description ? <p className="typ-caption mt-1.5 max-w-2xl text-muted-foreground">{description}</p> : null}
            </div>
            {actions ? <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
    );
}

/** 响应式布局取工作区内容宽度，侧栏折叠后卡片可使用腾出的空间。 */
export function PageShell({ children }: { children: ReactNode }) {
    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
            <div className="@container/workspace mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col px-4 py-5 sm:px-6">{children}</div>
        </div>
    );
}
