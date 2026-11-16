import { Home } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "antd";
import { useTranslation } from "react-i18next";

export default function NotFound() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    return (
        <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
            <main className="bg-dot-grid flex h-full min-h-0 items-center justify-center overflow-y-auto px-6 py-10">
                <section className="w-full max-w-md text-center">
                    <div className="surface-card mx-auto flex size-14 items-center justify-center font-mono text-lg font-medium text-muted-foreground">404</div>
                    <h1 className="typ-title mt-6">{t("notFound.title")}</h1>
                    <p className="typ-caption mx-auto mt-2.5 max-w-sm text-muted-foreground">{t("notFound.description")}</p>
                    <div className="mt-7 flex flex-wrap justify-center gap-2">
                        <Button type="primary" icon={<Home className="size-4" />} onClick={() => navigate("/")}>
                            {t("notFound.home")}
                        </Button>
                    </div>
                </section>
            </main>
        </div>
    );
}
