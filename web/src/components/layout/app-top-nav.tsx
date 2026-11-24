import { ChevronLeft, ChevronRight, House, Plus, type LucideIcon } from "lucide-react";
import { Button } from "antd";
import { motion, useReducedMotion } from "motion/react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { configSectionForTab, navigationTools } from "@/constant/navigation-tools";
import { AppConfigModal } from "@/components/layout/app-config-modal";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { isDesktopApp } from "@/lib/agent/agent-client";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { useAgentStore } from "@/stores/use-agent-store";
import { CommandPalette } from "@/components/layout/command-palette";

const sidebarPreference = "intx:sidebar-collapsed";

export function AppTopNav() {
    const { t } = useTranslation();
    const { pathname, search } = useLocation();
    const navigate = useNavigate();
    const autoConnectRef = useRef(false);
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [collapsed, setCollapsed] = useState(() => {
        try {
            return localStorage.getItem(sidebarPreference) === "1";
        } catch {
            return false;
        }
    });
    const agentToken = useAgentStore((state) => state.token);
    const agentEnabled = useAgentStore((state) => state.enabled);
    const agentConnected = useAgentStore((state) => state.connected);
    const connectAgent = useAgentStore((state) => state.connectAgent);
    const connectLocalAgent = useAgentStore((state) => state.connectLocalAgent);
    const hideSidebar = /^\/canvas\/[^/]+/.test(pathname) || pathname === "/editing-studio";
    const sidebarLabel = t(collapsed ? "topNav.expandSidebar" : "topNav.collapseSidebar");
    const toggleSidebar = () => {
        setCollapsed(!collapsed);
        try {
            localStorage.setItem(sidebarPreference, collapsed ? "0" : "1");
        } catch {
            // The sidebar remains usable when browser storage is unavailable.
        }
    };

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
                <aside className={cn("z-30 flex h-full shrink-0 flex-col overflow-x-hidden overflow-y-auto border-r border-border/70 bg-[var(--surface-card)] py-4 motion-safe:transition-[width,padding] motion-safe:duration-200 motion-safe:ease-out [&_:focus-visible]:outline-2 [&_:focus-visible]:-outline-offset-2 [&_:focus-visible]:outline-current", collapsed ? "w-[4.5rem] px-2.5" : "w-60 px-3")}>
                    <div className={cn("flex h-10 shrink-0 items-center", collapsed ? "justify-center" : "justify-between px-2")}>
                        {!collapsed && <Link to="/" className="flex items-center gap-2 text-foreground transition hover:opacity-75">
                            <span
                                className="size-6 shrink-0 bg-current"
                                style={{ mask: "url(/logo.svg) center / contain no-repeat", WebkitMask: "url(/logo.svg) center / contain no-repeat" }}
                            />
                            <span className="text-base font-semibold tracking-tight">INTX</span>
                        </Link>}
                        <button type="button" title={sidebarLabel} aria-label={sidebarLabel} aria-expanded={!collapsed} aria-controls="workspace-navigation" onClick={toggleSidebar} className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-[var(--surface-card-hover)] hover:text-foreground">
                            {collapsed ? <ChevronRight aria-hidden className="size-4" /> : <ChevronLeft aria-hidden className="size-4" />}
                        </button>
                    </div>

                    <Button
                        type="text"
                        icon={<Plus className="size-4" />}
                        className={cn("!mt-3 !h-9 !w-full shrink-0 !bg-[color-mix(in_srgb,var(--foreground)_15%,var(--surface-card))] !font-medium !text-foreground hover:!bg-[color-mix(in_srgb,var(--foreground)_20%,var(--surface-card))]", !collapsed && "!justify-start")}
                        aria-label={t("home.newCanvas")}
                        title={collapsed ? t("home.newCanvas") : undefined}
                        onClick={() => navigate("/canvas?mode=new")}
                    >
                        {!collapsed && t("home.newCanvas")}
                    </Button>

                    <nav id="workspace-navigation" className="mt-4 flex shrink-0 flex-col gap-1 pb-3">
                        <SidebarLink to="/" icon={House} label={t("navigation.home")} active={pathname === "/"} collapsed={collapsed} />
                        {navigationTools.map((tool) => {
                            const to = "to" in tool ? tool.to : `/${tool.slug}`;
                            return <SidebarLink key={tool.slug} to={to} icon={tool.icon} label={t(`navigation.${tool.slug}`)} active={isNavigationToolActive(to, pathname, search)} collapsed={collapsed} />;
                        })}
                    </nav>

                    <footer className={cn("mt-auto flex shrink-0 border-t border-border/70 pt-2", collapsed ? "justify-center" : "px-2")}>
                        <UserStatusActions showConfig={false} stacked={collapsed} />
                    </footer>
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
    if (basePath === "/config") return configSectionForTab(wanted).slug === configSectionForTab(current).slug;
    return current === wanted;
}

function SidebarLink({ to, icon: Icon, label, active, collapsed }: { to: string; icon: LucideIcon; label: string; active: boolean; collapsed: boolean }) {
    const reduceMotion = useReducedMotion();
    return (
        <Link
            to={to}
            aria-current={active ? "page" : undefined}
            aria-label={collapsed ? label : undefined}
            title={collapsed ? label : undefined}
            className={cn(
                "relative isolate flex h-9 items-center rounded-lg text-sm motion-safe:transition-colors",
                collapsed ? "justify-center" : "gap-3 px-3",
                active
                    ? "font-medium text-foreground"
                    : "text-muted-foreground hover:bg-[color-mix(in_srgb,var(--foreground)_7%,var(--surface-card))] hover:text-foreground focus-visible:bg-[color-mix(in_srgb,var(--foreground)_7%,var(--surface-card))] active:bg-[color-mix(in_srgb,var(--foreground)_10%,var(--surface-card))]",
            )}
        >
            {active && (
                <motion.span
                    aria-hidden
                    layoutId={reduceMotion ? undefined : "intx-sidebar-current-page"}
                    transition={{ type: "spring", stiffness: 420, damping: 36 }}
                    className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit] bg-[color-mix(in_srgb,var(--foreground)_5%,var(--surface-card))]"
                />
            )}
            <Icon aria-hidden className="size-4 shrink-0" />
            {!collapsed && <span className="truncate">{label}</span>}
        </Link>
    );
}
