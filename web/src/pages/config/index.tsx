import { useTranslation } from "react-i18next";

import { AppConfigPanel } from "@/components/layout/app-config-modal";
import { PageHeader, PageShell } from "@/components/layout/page-header";

export default function ConfigPage() {
    const { t } = useTranslation();

    return (
        <PageShell className="px-4 py-4 sm:px-6 sm:py-5">
            <main className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-5xl pb-6">
                    <PageHeader title={t("config.title")} description={t("config.description")} />
                    <div className="surface-card mt-5 min-h-[calc(100dvh-13rem)] p-5">
                        <AppConfigPanel />
                    </div>
                </div>
            </main>
        </PageShell>
    );
}
