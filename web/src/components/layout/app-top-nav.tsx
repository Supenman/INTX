import { Bot, House, Plus, Search, type LucideIcon } from "lucide-react";
import { Button } from "antd";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { navigationTools } from "@/constant/navigation-tools";
import { AppConfigModal } from "@/components/layout/app-config-modal";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { isDesktopApp } from "@/lib/agent/agent-client";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { useAgentStore } from "@/stores/use-agent-store";
import { CommandPalette } from "@/components/layout/command-palette";

export function AppTopNav() {
    const { t } = useTranslation();
    const { pathname, search } = useLocation();
    const navigate = useNavigate();
    const autoConnectRef = useRef(false);
    const [paletteOpen, setPaletteOpen] = useState(false);
    const agentToken = useAgentStore((state) => state.token);
    const agentEnabled = useAgentStore((state) => state.enabled);
    const agentConnected = useAgentStore((state) => state.connected);
    const connectAgent = useAgentStore((state) => state.connectAgent);
    const connectLocalAgent = useAgentStore((state) => state.connectLocalAgent);
    const togglePanel = useAgentStore((state) => state.togglePanel);
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const hideSidebar = /^\/canvas\/[^/]+/.test(pathname) || pathname === "/editing-studio";

    // 桌面版读本地配置自动连接；浏览器里只能用上次手动填过的地址和 token。
    useEffect(() => {
        if (autoConnectRef.current || agentEnabled || agentConnected) return;
        autoConnectRef.current = true;
        if (isDesktopApp()) void connectLocalAgent({ silent: true });
        else if (agentToken.trim()) void connectAgent({ silent: true });
    }, [agentConnected, agentEnabled, agentToken, connectAgent, connectLocalAgent]);

    // ⌘K / Ctrl+K 呼出命令面板：首页、项目库、剪辑台、资产、任务、设置与最近项目都能从这里直达。
    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
                event.preventDefault();
                setPaletteOpen((open) => !open);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, []);

    return (
        <>
            {!hideSidebar ? (
                <aside className="z-30 flex h-full w-60 shrink-0 flex-col border-r border-border/70 bg-[var(--surface-card)] px-3 py-4">
                    <Link to="/" className="flex h-10 items-center gap-2 px-2 text-foreground transition hover:opacity-75">
                        <span
                            className="size-6 shrink-0 bg-current"
                            style={{ mask: "url(/logo.svg) center / contain no-repeat", WebkitMask: "url(/logo.svg) center / contain no-repeat" }}
                        />
                        <span className="text-base font-semibold tracking-tight">INTX</span>
                    </Link>

                    <Button
                        type="primary"
                        icon={<Plus className="size-4" />}
                        className="!mt-5 !h-10 !justify-start !font-medium"
                        onClick={() => navigate("/canvas?mode=new")}
                    >
                        {t("home.newCanvas")}
                    </Button>

                    <nav className="mt-5 flex flex-col gap-1">
                        <button
                            type="button"
                            onClick={() => setPaletteOpen(true)}
                            className="flex h-10 items-center gap-3 rounded-lg px-3 text-sm text-muted-foreground transition hover:bg-[var(--surface-card-hover)] hover:text-foreground"
                            aria-label={t("commandPalette.open")}
                        >
                            <Search className="size-4 shrink-0" />
                            <span className="flex-1 truncate text-left">{t("commandPalette.search")}</span>
                            <kbd className="shrink-0 rounded border border-border px-1 text-[11px] font-normal text-muted-foreground">⌘K</kbd>
                        </button>
                        <SidebarLink to="/" icon={House} label={t("navigation.home")} active={pathname === "/"} />
                        {navigationTools.map((tool) => {
                            const to = "to" in tool ? tool.to : `/${tool.slug}`;
                            return <SidebarLink key={tool.slug} to={to} icon={tool.icon} label={t(`navigation.${tool.slug}`)} active={isNavigationToolActive(to, pathname, search)} />;
                        })}
                    </nav>

                    <div className="mt-auto border-t border-border/70 pt-3">
                        <button
                            type="button"
                            onClick={togglePanel}
                            className={cn(
                                "flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm transition hover:bg-[var(--surface-card-hover)]",
                                panelOpen && "bg-[var(--surface-card-hover)]",
                            )}
                            aria-label={t(panelOpen ? "topNav.closeAgent" : "topNav.openAgent")}
                        >
                            <Bot className="size-4" />
                            <span className="flex-1 text-left">INTX Agent</span>
                            <span aria-label={agentConnected ? t("agent.status.connected") : t("agent.status.disconnected")} className={cn("size-2 rounded-full", agentConnected ? "bg-emerald-500" : "bg-muted-foreground/40")} />
                        </button>
                        <div className="mt-3 flex items-center justify-between px-2">
                            <UserStatusActions showConfig={false} />
                        </div>
                    </div>
                </aside>
            ) : null}
            <AppConfigModal />
            <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
        </>
    );
}

function isNavigationToolActive(to: string, pathname: string, search: string) {
    const [basePath, query = ""] = to.split("?");
    if (pathname !== basePath && !pathname.startsWith(`${basePath}/`)) return false;
    if (!query) return true;
    const wanted = new URLSearchParams(query).get("tab");
    if (!wanted) return true;
    const current = new URLSearchParams(search).get("tab");
    // 设置页默认落在 channels：未带 tab 时「模型配置」也算激活。
    if (wanted === "channels") return !current || current === wanted;
    return current === wanted;
}

function SidebarLink({ to, icon: Icon, label, active }: { to: string; icon: LucideIcon; label: string; active: boolean }) {
    return (
        <Link
            to={to}
            className={cn(
                "flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition",
                active ? "bg-[var(--surface-card-hover)] font-medium text-foreground" : "text-muted-foreground hover:bg-[var(--surface-card-hover)] hover:text-foreground",
            )}
        >
            <Icon className="size-4 shrink-0" />
            <span className="truncate">{label}</span>
        </Link>
    );
}
