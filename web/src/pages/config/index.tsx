import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { AppConfigPanel } from "@/components/layout/app-config-modal";
import { ConfigComfyUI } from "@/components/layout/config-comfyui";
import { PageHeader, PageShell } from "@/components/layout/page-header";
import { runtime } from "@/lib/runtime/capabilities";
import { configSectionForTab } from "@/constant/navigation-tools";
import type { ConfigTabKey } from "@/stores/use-config-store";

export default function ConfigPage() {
    const { t } = useTranslation();
    const [searchParams, setSearchParams] = useSearchParams();
    const requestedTab = searchParams.get("tab");
    const section = configSectionForTab(requestedTab);
    const tab = section.tabs.find((key) => key === requestedTab) ?? section.tabs[0];

    // 侧栏「模型配置 / 存储设置」用 ?tab= 直达；面板内切标签时同步回 URL，
    // 保证刷新、分享和侧栏高亮都落在同一个分区。
    const handleTabChange = (nextTab: ConfigTabKey) => {
        const next = new URLSearchParams(searchParams);
        next.set("tab", nextTab);
        setSearchParams(next, { replace: true });
    };

    return (
        <PageShell>
            <main className="min-h-0 flex-1 overflow-y-auto">
                <div className="pb-6">
                    <PageHeader title={t(`navigation.${section.slug}`)} description={t(`config.sectionDescription.${section.slug}`)} />
                    <div className="surface-card mt-5 p-5">
                        <AppConfigPanel initialTab={tab} visibleTabs={section.tabs} onTabChange={handleTabChange} />
                    </div>
                    {runtime === "desktop" && (
                        <div hidden={tab !== "channels"}>
                            <ConfigComfyUI />
                        </div>
                    )}
                </div>
            </main>
        </PageShell>
    );
}
