import { invoke, isTauri } from "@tauri-apps/api/core";
import { LOCAL_COMFY_CHANNEL_ID, useConfigStore, type ModelChannel } from "@/stores/use-config-store";

let hydrated = false;

function extractSecrets(channels: ModelChannel[]): Record<string, string> {
    const secrets: Record<string, string> = {};
    for (const channel of channels) {
        if (channel.id === LOCAL_COMFY_CHANNEL_ID) continue;
        const key = channel.apiKey.trim();
        if (key) secrets[channel.id] = key;
    }
    return secrets;
}

export async function syncChannelSecrets(channels: ModelChannel[]): Promise<void> {
    if (!isTauri() || !hydrated) return;
    try {
        await invoke("save_channel_secrets", { secrets: extractSecrets(channels) });
    } catch {
        // 凭据库不可用时静默跳过，避免阻断 UI 操作
    }
}

export async function hydrateChannelSecrets(): Promise<void> {
    if (!isTauri()) return;
    try {
        const stored = await invoke<Record<string, string>>("load_channel_secrets");
        const state = useConfigStore.getState();
        let needsMigrateToKeyring = false;
        let needsMergeToStore = false;

        const nextChannels = state.config.channels.map((channel) => {
            if (channel.id === LOCAL_COMFY_CHANNEL_ID) return channel;
            const fromKeyring = stored[channel.id]?.trim() || "";
            const fromLegacy = channel.apiKey.trim();
            if (fromKeyring && fromKeyring !== fromLegacy) {
                needsMergeToStore = true;
                return { ...channel, apiKey: fromKeyring };
            }
            if (!fromKeyring && fromLegacy) {
                needsMigrateToKeyring = true;
            }
            return channel;
        });

        hydrated = true;
        if (needsMergeToStore) {
            state.updateConfig("channels", nextChannels);
        }
        if (needsMigrateToKeyring) {
            await syncChannelSecrets(nextChannels);
            // 触发一次脱敏重存，抹掉 localStorage 里的历史明文密钥
            state.updateConfig("channels", nextChannels);
        }
    } catch {
        hydrated = true;
    }
}
