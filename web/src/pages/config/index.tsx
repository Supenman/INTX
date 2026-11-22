import { useTranslation } from "react-i18next";

import { AppConfigPanel } from "@/components/layout/app-config-modal";
import { ConfigComfyUI } from "@/components/layout/config-comfyui";
import { PageHeader, PageShell } from "@/components/layout/page-header";
import { runtime } from "@/lib/runtime/capabilities";

export default function ConfigPage() {
    const { t } = useTranslation();

    return (
        <PageShell>
            <main className="min-h-0 flex-1 overflow-y-auto">
                <div className="pb-6">
                    <PageHeader title={t("config.title")} description={t("config.description")} />
                    <div className="surface-card mt-5 p-5">
                        <AppConfigPanel />
                    </div>
                    {runtime === "desktop" && <ConfigComfyUI />}
                </div>
            </main>
        </PageShell>
    );
}
