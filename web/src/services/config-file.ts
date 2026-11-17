import { saveAs } from "file-saver";

import i18n from "@/i18n";
import { useConfigStore, type AiConfig, type WebdavSyncConfig } from "@/stores/use-config-store";

type AppConfigFile = {
    app: "infinite-canvas";
    version: 1;
    exportedAt: string;
    config: AiConfig;
    webdav: WebdavSyncConfig;
};

export function exportAppConfig() {
    const { config, webdav } = useConfigStore.getState();
    // 导出文件会离开本机：API Key 与 WebDAV 密码不写进去，导入后由用户重新填写。
    const safeConfig: AiConfig = { ...config, apiKey: "", channels: config.channels.map((channel) => ({ ...channel, apiKey: "" })) };
    const safeWebdav: WebdavSyncConfig = { ...webdav, password: "" };
    const data: AppConfigFile = { app: "infinite-canvas", version: 1, exportedAt: new Date().toISOString(), config: safeConfig, webdav: safeWebdav };
    saveAs(new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }), "infinite-canvas-config.json");
}

export async function importAppConfig(file: File) {
    let data: AppConfigFile;
    try {
        data = JSON.parse(await file.text()) as AppConfigFile;
    } catch {
        throw new Error(i18n.t("config.invalidFile"));
    }
    if (data.app !== "infinite-canvas" || data.version !== 1 || !data.config || !data.webdav) throw new Error(i18n.t("config.invalidFile"));
    useConfigStore.setState({ config: data.config, webdav: data.webdav });
}
