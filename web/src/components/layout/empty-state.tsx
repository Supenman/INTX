import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

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
        <section className={cn("flex min-h-64 flex-col items-center justify-center rounded-xl border border-border/70 bg-[var(--surface-card)] px-6 py-10 text-center", className)}>
            <div className="flex size-10 items-center justify-center rounded-xl bg-[var(--surface-sunken)] text-muted-foreground">
                <Icon className="size-5" aria-hidden />
            </div>
            <p className="typ-heading mt-4">{title}</p>
            {description ? <p className="typ-caption mt-1.5 max-w-xs text-muted-foreground">{description}</p> : null}
            {action ? <div className="mt-5">{action}</div> : null}
        </section>
    );
}
