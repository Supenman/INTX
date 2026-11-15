/** opencode 模型选择的纯函数层：只做归一化和校验，不碰网络、进程或存储。 */

/** 固定免费模型；未选择或列表不可用时一律回退到这里，用户不需要提供 Key。 */
export const DEFAULT_OPENCODE_MODEL = { providerID: "opencode", modelID: "nemotron-3.5-lightning-free" };
export const DEFAULT_OPENCODE_MODEL_ID = `${DEFAULT_OPENCODE_MODEL.providerID}/${DEFAULT_OPENCODE_MODEL.modelID}`;

export type OpencodeModelRef = { providerID: string; modelID: string };
export type OpencodeModelOption = { id: string; providerID: string; modelID: string; label: string };
export type OpencodeModelList = { models: OpencodeModelOption[]; defaultId: string };

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

/**
 * 归一化 GET /config/providers 的响应（{ providers, default }）。
 * 结构异常时返回空列表，由调用方提示不可用并回退默认模型，绝不把原始字符串交给 opencode。
 */
export function parseOpencodeModelList(payload: unknown): OpencodeModelList {
    const root = record(payload);
    const providers = Array.isArray(root.providers) ? root.providers : [];
    const defaults = record(root.default);
    const models: OpencodeModelOption[] = [];
    const seen = new Set<string>();
    for (const item of providers) {
        const provider = record(item);
        const providerID = text(provider.id);
        if (!providerID) continue;
        const providerName = text(provider.name) || providerID;
        for (const [modelID, raw] of Object.entries(record(provider.models))) {
            if (!modelID) continue;
            const id = `${providerID}/${modelID}`;
            if (seen.has(id)) continue;
            seen.add(id);
            const modelName = text(record(raw).name) || modelID;
            models.push({ id, providerID, modelID, label: `${providerName} · ${modelName}` });
        }
    }
    return { models, defaultId: pickDefaultId(models, defaults) };
}

/** 优先沿用今天的固定免费模型；其次按 opencode 配置的 default 映射；再退到第一项。 */
function pickDefaultId(models: readonly OpencodeModelOption[], defaults: Record<string, unknown>): string {
    if (!models.length) return "";
    if (models.some((item) => item.id === DEFAULT_OPENCODE_MODEL_ID)) return DEFAULT_OPENCODE_MODEL_ID;
    for (const item of models) {
        if (text(defaults[item.providerID]) === item.modelID) return item.id;
    }
    return models[0].id;
}

/** 只接受列表里存在的 id；未选择、值失效或列表为空都回退默认模型，不静默使用任意字符串。 */
export function resolveOpencodeModel(requested: string | undefined, list: OpencodeModelList): OpencodeModelRef {
    const match = (id: string) => list.models.find((item) => item.id === id);
    const picked = (requested ? match(requested) : undefined) || match(list.defaultId || DEFAULT_OPENCODE_MODEL_ID);
    return picked ? { providerID: picked.providerID, modelID: picked.modelID } : { ...DEFAULT_OPENCODE_MODEL };
}
