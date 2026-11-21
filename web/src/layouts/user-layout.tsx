import type { ReactNode } from "react";

import { AgentPanel } from "@/components/agent/agent-panel";
import { AppTopNav } from "@/components/layout/app-top-nav";

export default function UserLayout({ children }: { children: ReactNode }) {
    return (
        <div className="flex h-dvh overflow-hidden bg-background text-foreground">
            <AppTopNav />
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>
            <AgentPanel />
        </div>
    );
}
