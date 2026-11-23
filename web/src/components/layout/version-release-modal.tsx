import type { CSSProperties } from "react";
import { Modal, Progress, Tag, Timeline, App as AntApp, Button } from "antd";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useVersionCheck } from "@/hooks/use-version-check";
import { cn } from "@/lib/utils";

function getTagColor(type: string) {
    if (type === "新增" || type === "Added") return "green";
    if (type === "修复" || type === "Fixed") return "red";
    if (type === "调整" || type === "Changed") return "blue";
    if (type === "文档" || type === "Docs") return "purple";
    return "default";
}

function releaseTypeLabel(type: string, t: TFunction) {
    const key = ({ 新增: "added", 修复: "fixed", 调整: "changed", 优化: "optimized", 文档: "docs" } as Record<string, string>)[type];
    return key ? t(`version.types.${key}`) : type;
}

type VersionReleaseModalProps = {
    className?: string;
    style?: CSSProperties;
};

export function VersionReleaseModal({ className, style }: VersionReleaseModalProps) {
    const { t } = useTranslation();
    const { message, modal } = AntApp.useApp();
    const { open, setOpen, openReleaseModal, currentVersion, latestVersion, releases, checking, hasNewVersion, checkLatestRelease, updatable, updatableVersion, installing, progress, installUpdate } = useVersionCheck();

    const handleInstall = () => {
        modal.confirm({
            title: t("version.installTitle"),
            content: t("version.installContent", { version: updatableVersion }),
            okText: t("version.installConfirm"),
            cancelText: t("version.cancel"),
            onOk: async () => {
                const ok = await installUpdate();
                if (ok) {
                    message.success(t("version.installDone"));
                } else {
                    message.error(t("version.installFailed"));
                }
            },
        });
    };

    return (
        <>
            <button
                type="button"
                className={cn("shrink-0 cursor-pointer text-xs font-medium text-muted-foreground transition duration-150 hover:text-foreground", className)}
                style={style}
                onClick={openReleaseModal}
                title={t("version.viewUpdates")}
            >
                <span className="relative inline-flex">
                    {currentVersion}
                    {hasNewVersion ? <span className="absolute -right-1.5 -top-1 size-1.5 rounded-full bg-green-500" /> : null}
                </span>
            </button>
            <Modal destroyOnHidden title={t("version.title")} open={open} width={680} centered footer={null} onCancel={() => setOpen(false)}>
                <div className="mb-5 grid grid-cols-2 gap-3">
                    <div className="rounded-[var(--r-lg)] border border-border p-3">
                        <div className="text-xs text-muted-foreground">{t("version.currentVersion")}</div>
                        <div className="mt-1 text-base font-semibold text-foreground">{currentVersion}</div>
                    </div>
                    <div className="rounded-[var(--r-lg)] border border-border p-3">
                        <div className="flex items-center justify-between gap-3">
                            <div className="text-xs text-muted-foreground">{t("version.latestVersion")}</div>
                            <button
                                type="button"
                                className="cursor-pointer bg-transparent p-0 typ-label font-normal text-muted-foreground underline-offset-2 transition duration-150 hover:text-foreground hover:underline"
                                onClick={() => void checkLatestRelease(true)}
                            >
                                {t(checking ? "version.checking" : "version.checkUpdates")}
                            </button>
                        </div>
                        <div className="mt-1 text-base font-semibold text-foreground">{latestVersion}</div>
                    </div>
                </div>
                {updatable ? (
                    <div className="mb-4 rounded-[var(--r-lg)] border border-primary/30 bg-primary/5 p-3">
                        <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <div className="text-sm font-medium text-foreground">{t("version.updateAvailable", { version: updatableVersion })}</div>
                                <div className="mt-0.5 text-xs text-muted-foreground">{t("version.installHint")}</div>
                            </div>
                            <Button type="primary" size="small" loading={installing} disabled={installing} onClick={handleInstall}>
                                {installing ? t("version.installing") : t("version.downloadUpdate")}
                            </Button>
                        </div>
                        {installing ? <Progress percent={progress} size="small" className="mt-2" /> : null}
                    </div>
                ) : null}
                <div className="max-h-[56vh] overflow-y-auto pr-2">
                    <Timeline
                        items={releases.map((release) => ({
                            content: (
                                <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-sm font-semibold text-foreground">{release.version === "Unreleased" ? t("version.unreleased") : release.version}</span>
                                        <span className="text-xs text-muted-foreground">{release.date}</span>
                                        <div className="flex min-w-0 items-center gap-1.5">
                                            {release.version === latestVersion ? <Tag color="green">{t("version.latest")}</Tag> : null}
                                            {release.version === currentVersion ? <Tag>{t("version.current")}</Tag> : null}
                                        </div>
                                    </div>
                                    <div className="mt-2 space-y-1.5">
                                        {release.items.map((item, index) => (
                                            <div key={`${release.version}-${index}`} className="flex items-start gap-2 text-sm leading-6 text-foreground/85">
                                                <Tag color={getTagColor(item.type)} className="m-0 mt-0.5 shrink-0 whitespace-nowrap">
                                                    {releaseTypeLabel(item.type, t)}
                                                </Tag>
                                                <span className="min-w-0 flex-1">{item.content}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ),
                        }))}
                    />
                </div>
            </Modal>
        </>
    );
}
