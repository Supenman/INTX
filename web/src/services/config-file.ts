import i18n from "@/i18n";
import { saveFile, type SaveFileOutcome } from "@/lib/runtime/save-file";
import { useConfigStore, type AiConfig } from "@/stores/use-config-store";

type AppConfigFile = {
    app: "intx" | "infinite-canvas";
    version: 1;
    exportedAt: string;
    config: AiConfig;
};

export async function exportAppConfig(): Promise<SaveFileOutcome> {
    const { config } = useConfigStore.getState();
    // 导出文件会离开本机：API Key 不写进去，导入后由用户重新填写。
    const safeConfig: AiConfig = { ...config, apiKey: "", channels: config.channels.map((channel) => ({ ...channel, apiKey: "" })) };
    const data: AppConfigFile = { app: "intx", version: 1, exportedAt: new Date().toISOString(), config: safeConfig };
    return saveFile(new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }), "intx-config.json");
}

export async function importAppConfig(file: File) {
    let data: AppConfigFile;
    try {
        data = JSON.parse(await file.text()) as AppConfigFile;
    } catch {
        throw new Error(i18n.t("config.invalidFile"));
    }
    if ((data.app !== "intx" && data.app !== "infinite-canvas") || data.version !== 1 || !data.config) {
        throw new Error(i18n.t("config.invalidFile"));
    }
    useConfigStore.setState({ config: data.config });
}
