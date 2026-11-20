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
 * 默认限宽居中（列表、表单类页面都用这个）；要撑满整屏的用 `width="full"`。
 *
 * 宽度由这里统一管，页面自己不再写 `max-w-*`。
 * 之前四个主页面各写一套（canvas/assets 用 max-w-6xl、config 用 max-w-5xl、
 * tasks 干脆没写），切页时内容左边界在 24 / 144 / 208px 之间跳，看着像没对齐。
 *
 * 内边距（px-6 py-5）也放这里，跟着宽度一起管：先限宽再补内边距，
 * 否则内层居中会把两边 padding 再扣一次，内容比别的页窄一圈。
 */
export function PageShell({ children, className, width = "page" }: { children: ReactNode; className?: string; width?: "page" | "full" }) {
    if (width === "full") {
        return <div className={cn("flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground", className)}>{children}</div>;
    }
    return (
        <div className={cn("flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground", className)}>
            <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col px-6 py-5">{children}</div>
        </div>
    );
}
