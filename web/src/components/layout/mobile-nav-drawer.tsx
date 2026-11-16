import { Drawer } from "antd";
import { GithubOutlined } from "@ant-design/icons";
import { BookOpen } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { APP_VERSION, DOCS_URL, REPO_URL } from "@/constant/env";
import { cn } from "@/lib/utils";

type MobileNavDrawerProps = {
    open: boolean;
    activeToolSlug?: NavigationToolSlug;
    onClose: () => void;
};

export function MobileNavDrawer({ open, activeToolSlug, onClose }: MobileNavDrawerProps) {
    const { t } = useTranslation();
    const rowClass = "flex items-center gap-3 rounded-md px-2.5 py-2.5 typ-body-compact transition-colors";

    return (
        <Drawer title={t("topNav.navigation")} placement="left" size={280} open={open} onClose={onClose} className="md:hidden">
            <nav className="space-y-0.5">
                {navigationTools.map((tool) => {
                    const Icon = tool.icon;
                    const active = tool.slug === activeToolSlug;
                    return (
                        <Link
                            key={tool.slug}
                            to={`/${tool.slug}`}
                            onClick={onClose}
                            className={cn(
                                rowClass,
                                active ? "bg-[var(--control-selected-bg)] font-medium text-foreground" : "text-muted-foreground hover:bg-[var(--surface-card-hover)] hover:text-foreground",
                            )}
                        >
                            <Icon className="size-4 shrink-0" />
                            <span className="truncate">{t(`navigation.${tool.slug}`)}</span>
                        </Link>
                    );
                })}
            </nav>

            {/* 顶栏在窄屏收起了资源入口，这里补齐，避免功能找不到 */}
            <div className="mt-5 border-t border-border/60 pt-4">
                <p className="typ-overline mb-2 px-2.5 text-muted-foreground">{t("topNav.resources")}</p>
                <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className={cn(rowClass, "text-muted-foreground hover:bg-[var(--surface-card-hover)] hover:text-foreground")}>
                    <BookOpen className="size-4 shrink-0" />
                    {t("topNav.docs")}
                </a>
                <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className={cn(rowClass, "text-muted-foreground hover:bg-[var(--surface-card-hover)] hover:text-foreground")}>
                    <GithubOutlined className="shrink-0 text-base" />
                    {t("topNav.sourceCode")}
                </a>
            </div>

            <p className="typ-caption mt-5 px-2.5 text-muted-foreground/70">v{APP_VERSION}</p>
        </Drawer>
    );
}
