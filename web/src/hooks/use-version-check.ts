import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App } from "antd";
import { useTranslation } from "react-i18next";
import { APP_VERSION } from "@/constant/env";
import { parseChangelog, type ReleaseInfo } from "@/lib/release";
import { runtime } from "@/lib/runtime/capabilities";

// 版本与更新日志读本仓库，不能读上游项目——否则用户看到的是别人的版本号，点击更新跳到别人仓库。
// 注意：仓库目前是 private，raw / jsDelivr 都会 404，本 hook 只能等仓库转公开后才真正生效。
// 这不是代码问题，转公开前不去伪造一个假成功。见 docs/品牌去上游-发布清单.md。
const REPO_RAW = "https://raw.githubusercontent.com/Supenman/INTX/dev";
const latestVersionUrl = `${REPO_RAW}/VERSION`;
const latestChangelogUrl = `${REPO_RAW}/CHANGELOG.md`;

function readLocalReleases(): ReleaseInfo[] {
    return __APP_RELEASES__ || [];
}

function toVersionParts(version: string) {
    const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
    return match ? match.slice(1).map(Number) : null;
}

function isNewerVersion(latestVersion: string, currentVersion: string) {
    const latest = toVersionParts(latestVersion);
    const current = toVersionParts(currentVersion);
    if (!latest || !current) return false;
    return latest.some((value, index) => value > current[index] && latest.slice(0, index).every((part, prevIndex) => part === current[prevIndex]));
}

export function useVersionCheck() {
    const { t } = useTranslation();
    const currentVersion = APP_VERSION;
    const { message } = App.useApp();
    const localReleases = useMemo(readLocalReleases, []);
    const [latestVersion, setLatestVersion] = useState(currentVersion);
    const [releases, setReleases] = useState<ReleaseInfo[]>(localReleases);
    const [checking, setChecking] = useState(false);
    const [open, setOpen] = useState(false);
    const hasNewVersion = isNewerVersion(latestVersion, currentVersion);

    // 桌面端真实更新链路：Tauri updater 校验签名后下载安装。
    // update 对象用 ref 持有（含下载所需元数据），不进 state。
    const updateRef = useRef<import("@tauri-apps/plugin-updater").Update | null>(null);
    const [updatable, setUpdatable] = useState(false);
    const [updatableVersion, setUpdatableVersion] = useState("");
    const [installing, setInstalling] = useState(false);
    const [progress, setProgress] = useState(0);

    // 检测真实可安装更新。浏览器 dev、未配 pubkey、未发布 release 都会失败，
    // 一律静默降级为「无可安装更新」——查看更新日志的功能不受影响。
    const checkAppUpdate = useCallback(async () => {
        if (runtime !== "desktop") return;
        try {
            const { check } = await import("@tauri-apps/plugin-updater");
            const update = await check();
            updateRef.current = update && update.available ? update : null;
            setUpdatable(updateRef.current !== null);
            setUpdatableVersion(update?.version || "");
        } catch {
            updateRef.current = null;
            setUpdatable(false);
        }
    }, []);

    const checkLatestVersion = useCallback(async () => {
        try {
            const response = await fetch(latestVersionUrl);
            if (!response.ok) return false;
            const version = await response.text();
            setLatestVersion(version.trim() || currentVersion);
            return true;
        } catch {
            return false;
        }
    }, [currentVersion]);

    const checkLatestRelease = useCallback(
        async (showMessage = false) => {
            setChecking(true);
            try {
                const [versionResponse, changelogResponse] = await Promise.all([fetch(latestVersionUrl), fetch(latestChangelogUrl)]);
                if (!versionResponse.ok) throw new Error(t("version.readFailed"));
                if (!changelogResponse.ok) throw new Error(t("version.changelogFailed"));
                const [version, changelog] = await Promise.all([versionResponse.text(), changelogResponse.text()]);
                setLatestVersion(version.trim() || currentVersion);
                if (changelog.trim()) setReleases(parseChangelog(changelog));
                if (showMessage) message.success(t("version.updated"));
                return true;
            } catch {
                setLatestVersion(currentVersion);
                setReleases(localReleases);
                if (showMessage) message.error(t("version.updateFailed"));
                return false;
            } finally {
                setChecking(false);
            }
        },
        [currentVersion, localReleases, message, t],
    );

    useEffect(() => {
        void checkLatestVersion();
    }, [checkLatestVersion]);

    // 下载并安装更新。带进度回调；完成后需用户手动重启 INTX 才生效。
    const installUpdate = useCallback(async () => {
        const update = updateRef.current;
        if (!update || installing) return false;
        setInstalling(true);
        setProgress(0);
        try {
            let total = 0;
            let downloaded = 0;
            await update.downloadAndInstall((event) => {
                if (event.event === "Started" && event.data.contentLength) {
                    total = event.data.contentLength;
                } else if (event.event === "Progress" && total > 0) {
                    downloaded += event.data.chunkLength;
                    setProgress(Math.min(100, Math.round((downloaded / total) * 100)));
                }
            });
            setProgress(100);
            updateRef.current = null;
            setUpdatable(false);
            return true;
        } catch {
            return false;
        } finally {
            setInstalling(false);
        }
    }, [installing]);

    const openReleaseModal = useCallback(() => {
        setOpen(true);
        void checkLatestRelease();
        void checkAppUpdate();
    }, [checkLatestRelease, checkAppUpdate]);

    return {
        open,
        setOpen,
        openReleaseModal,
        latestVersion,
        releases,
        checking,
        hasNewVersion,
        checkLatestRelease,
        updatable,
        updatableVersion,
        installing,
        progress,
        installUpdate,
    };
}
