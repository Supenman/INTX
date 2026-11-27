import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App } from "antd";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { APP_VERSION } from "@/constant/env";
import { parseChangelog, type ReleaseInfo } from "@/lib/release";
import { runtime } from "@/lib/runtime/capabilities";
import { getUpdateManifestUrl, isNewerSemver, resolveAvailableUpdate, type AvailableAppUpdate } from "@/lib/updater";

const REPO_RAW = "https://raw.githubusercontent.com/Supenman/INTX/dev";
const latestVersionUrl = `${REPO_RAW}/VERSION`;
const latestChangelogUrl = `${REPO_RAW}/CHANGELOG.md`;

type NativeUpdateProgress = {
    stage: string;
    downloaded: number;
    total: number;
    percent: number;
};

function readLocalReleases(): ReleaseInfo[] {
    return __APP_RELEASES__ || [];
}

export function useVersionCheck() {
    const { t } = useTranslation();
    const [currentVersion, setCurrentVersion] = useState(APP_VERSION);
    const { message } = App.useApp();
    const localReleases = useMemo(readLocalReleases, []);
    const [remoteVersion, setRemoteVersion] = useState<string>();
    const latestVersion = remoteVersion || currentVersion;
    const [releases, setReleases] = useState<ReleaseInfo[]>(localReleases);
    const [checking, setChecking] = useState(false);
    const [open, setOpen] = useState(false);
    const hasNewVersion = isNewerSemver(latestVersion, currentVersion);

    useEffect(() => {
        if (runtime !== "desktop") return;
        let active = true;
        void getVersion().then((version) => {
            if (active && version) setCurrentVersion(`v${version}`);
        }).catch(() => {});
        return () => { active = false; };
    }, []);

    // 桌面端自研免密码更新链路（方案 A）：拉取 HTTPS update.json → 校验 SHA-256 → 拉起 NSIS 安装。
    const updateRef = useRef<AvailableAppUpdate | null>(null);
    const [updatable, setUpdatable] = useState(false);
    const [updatableVersion, setUpdatableVersion] = useState("");
    const [installing, setInstalling] = useState(false);
    const [progress, setProgress] = useState(0);

    const checkAppUpdate = useCallback(async () => {
        if (runtime !== "desktop") return;
        try {
            const manifestUrl = getUpdateManifestUrl();
            const response = await fetch(manifestUrl, { cache: "no-store" });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const raw: unknown = await response.json();
            const update = resolveAvailableUpdate(raw, currentVersion);
            updateRef.current = update;
            setUpdatable(update !== null);
            setUpdatableVersion(update?.version || "");
        } catch {
            updateRef.current = null;
            setUpdatable(false);
            setUpdatableVersion("");
        }
    }, [currentVersion]);

    const checkLatestVersion = useCallback(async () => {
        try {
            const response = await fetch(latestVersionUrl);
            if (!response.ok) return false;
            const version = await response.text();
            setRemoteVersion(version.trim() || undefined);
            return true;
        } catch {
            return false;
        }
    }, []);

    const checkLatestRelease = useCallback(
        async (showMessage = false) => {
            setChecking(true);
            try {
                const [versionResponse, changelogResponse] = await Promise.all([fetch(latestVersionUrl), fetch(latestChangelogUrl)]);
                if (!versionResponse.ok) throw new Error(t("version.readFailed"));
                if (!changelogResponse.ok) throw new Error(t("version.changelogFailed"));
                const [version, changelog] = await Promise.all([versionResponse.text(), changelogResponse.text()]);
                setRemoteVersion(version.trim() || undefined);
                if (changelog.trim()) setReleases(parseChangelog(changelog));
                void checkAppUpdate();
                if (showMessage) message.success(t("version.updated"));
                return true;
            } catch {
                setRemoteVersion(undefined);
                setReleases(localReleases);
                if (showMessage) message.error(t("version.updateFailed"));
                return false;
            } finally {
                setChecking(false);
            }
        },
        [checkAppUpdate, localReleases, message, t],
    );

    useEffect(() => {
        void checkLatestVersion();
    }, [checkLatestVersion]);

    const installUpdate = useCallback(async () => {
        const update = updateRef.current;
        if (!update || installing) return false;
        setInstalling(true);
        setProgress(0);
        let unlisten: (() => void) | null = null;
        try {
            unlisten = await listen<NativeUpdateProgress>("intx-update-progress", (event) => {
                if (typeof event.payload?.percent === "number") {
                    setProgress(Math.max(0, Math.min(100, event.payload.percent)));
                }
            });
            await invoke("download_and_install_update", {
                url: update.url,
                expectedSha256: update.sha256,
                mirrors: update.mirrors,
            });
            setProgress(100);
            updateRef.current = null;
            setUpdatable(false);
            return true;
        } catch {
            return false;
        } finally {
            unlisten?.();
            setInstalling(false);
        }
    }, [installing]);

    const openReleaseModal = useCallback(() => {
        setOpen(true);
        void checkLatestRelease();
    }, [checkLatestRelease]);

    return {
        open,
        setOpen,
        openReleaseModal,
        currentVersion,
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
