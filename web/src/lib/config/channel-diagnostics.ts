import type { AiConfig, ModelCapability, ModelChannel } from "@/stores/use-config-store";
import { selectableModelsByCapability } from "@/stores/use-config-store";

export type ChannelReadinessStatus = "ready" | "missing-url" | "missing-key" | "missing-models";

export type ChannelDiagnostics = {
    ready: boolean;
    status: ChannelReadinessStatus;
    counts: Record<ModelCapability, number>;
};

export type CapabilityCoverageItem = {
    capability: ModelCapability;
    modelKey: "imageModel" | "videoModel" | "textModel" | "audioModel";
    configuredModel: string;
    availableCount: number;
    ready: boolean;
};

const CAPABILITY_MODEL_KEYS: Array<{ capability: ModelCapability; modelKey: CapabilityCoverageItem["modelKey"] }> = [
    { capability: "image", modelKey: "imageModel" },
    { capability: "video", modelKey: "videoModel" },
    { capability: "text", modelKey: "textModel" },
    { capability: "audio", modelKey: "audioModel" },
];

export function diagnoseChannel(channel: ModelChannel): ChannelDiagnostics {
    const counts: Record<ModelCapability, number> = { image: 0, video: 0, text: 0, audio: 0 };
    for (const model of channel.models) {
        if (model.capability in counts) counts[model.capability] += 1;
    }
    if (!channel.baseUrl.trim()) return { ready: false, status: "missing-url", counts };
    if (!channel.apiKey.trim()) return { ready: false, status: "missing-key", counts };
    if (!channel.models.length) return { ready: false, status: "missing-models", counts };
    return { ready: true, status: "ready", counts };
}

export function diagnoseCapabilityCoverage(config: AiConfig): CapabilityCoverageItem[] {
    return CAPABILITY_MODEL_KEYS.map(({ capability, modelKey }) => {
        const available = selectableModelsByCapability(config, capability);
        const configuredModel = config[modelKey] || "";
        return {
            capability,
            modelKey,
            configuredModel,
            availableCount: available.length,
            ready: available.length > 0 && Boolean(configuredModel),
        };
    });
}
