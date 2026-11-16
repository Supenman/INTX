import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * 统一页面头：标题 / 描述 / 右侧操作。
 * 三个主页面（工作台、提示词、配置）共用，避免各页自行拼字号导致层级不一致。
 */
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
        <header className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-3", className)}>
            <div className="min-w-0">
                <h1 className="typ-title text-foreground">{title}</h1>
                {description ? <p className="typ-caption mt-1.5 max-w-2xl text-muted-foreground">{description}</p> : null}
            </div>
            {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
    );
}

/**
 * 页面主体容器：统一最大宽度与左右留白。
 * 工作台这类要撑满高度的页面用 `fill`。
 */
export function PageShell({ children, className }: { children: ReactNode; className?: string }) {
    return <div className={cn("flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground", className)}>{children}</div>;
}
