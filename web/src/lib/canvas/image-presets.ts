/**
 * 图片预设（移植自 OpenDirector v0.1.4 `packages/core/src/opendirector/application/tool_image_edits.py` 的 PRESETS）。
 *
 * Apache-2.0：原始版权 ThinkFlowLab and the OpenDirector contributors，
 * 许可证全文见 `THIRD_PARTY_NOTICES.md` 与上游 `LICENSE`。
 * 修改说明：拆成纯数据 + i18n 取文案，指令从 Python 元组改为按语言键取；
 * 尺寸沿用 INTX 的 `size` 字段（像素串），不再调用上游的 `reframe`。
 *
 * 为什么不复用渠道的 size：三视图必须是固定画幅，否则三个等宽格子在
 * 16:9 以外的比例下会被压变形；分镜/多机位同理（上游固定 2048×1152）。
 * 面部三视图是 3:1，INTX 的比例表里没有，所以直接用像素串。
 *
 * 注意 `3456x1152` 正好等于 `validateImageSize` 的比例上限（`IMAGE_MAX_RATIO = 3`），
 * 边 3456 也在 3840 以内、16 的整倍数。改这个尺寸前先看 `services/api/image.ts`
 * 那几条上限，超一点就会在提交前抛 `imageRatioLimit`，白等一轮。
 *
 * 指令写成祈使句而不是描述句：编辑模型对「把镜头拉远成远景」这种指令的
 * 遵从度，明显高于「一张远景照片」这种描述。上游的注释也是这个意思。
 */
import i18n from "@/i18n";

export const IMAGE_PRESET_IDS = [
    "character-three-view",
    "face-three-view",
    "product-three-view",
    "storyboard",
    "multi-camera",
] as const;

export type ImagePresetId = (typeof IMAGE_PRESET_IDS)[number];

interface PresetSpec {
    titleKey: string;
    /** 单条指令是字符串，多条（分镜/多机位）是字符串数组。 */
    promptKey: string;
    /** 固定输出尺寸：像素串，走 INTX 的 `parsePixelSize`。 */
    size: string;
}

const PRESETS: Record<ImagePresetId, PresetSpec> = {
    "character-three-view": {
        titleKey: "canvas.imagePresets.characterThreeView",
        promptKey: "canvas.imagePresets.characterThreeViewPrompt",
        size: "2048x1152",
    },
    "face-three-view": {
        titleKey: "canvas.imagePresets.faceThreeView",
        promptKey: "canvas.imagePresets.faceThreeViewPrompt",
        size: "3456x1152",
    },
    "product-three-view": {
        titleKey: "canvas.imagePresets.productThreeView",
        promptKey: "canvas.imagePresets.productThreeViewPrompt",
        size: "2048x1152",
    },
    storyboard: {
        titleKey: "canvas.imagePresets.storyboard",
        promptKey: "canvas.imagePresets.storyboardPrompts",
        size: "2048x1152",
    },
    "multi-camera": {
        titleKey: "canvas.imagePresets.multiCamera",
        promptKey: "canvas.imagePresets.multiCameraPrompts",
        size: "2048x1152",
    },
};

export interface ResolvedImagePreset {
    id: ImagePresetId;
    title: string;
    /** 固定尺寸，调用方不要再用渠道的 size 覆盖。 */
    size: string;
    /** 每条指令产出一张；长度就是张数。 */
    prompts: string[];
}

export function isImagePresetId(value: unknown): value is ImagePresetId {
    return typeof value === "string" && (IMAGE_PRESET_IDS as readonly string[]).includes(value);
}

function textList(key: string): string[] {
    const value = i18n.t(key, { returnObjects: true });
    return Array.isArray(value) ? value.map(String) : [String(value)];
}

export function resolveImagePreset(id: ImagePresetId): ResolvedImagePreset {
    const spec = PRESETS[id];
    const appendix = i18n.t("canvas.imagePresets.appendix");
    return {
        id,
        title: i18n.t(spec.titleKey),
        size: spec.size,
        // 上游对每条指令都追加这句：分镜/多机位要换机位，但主体不能跟着变。
        prompts: textList(spec.promptKey).map((prompt) => `${prompt}${appendix}`),
    };
}

export interface ImagePresetOption {
    id: ImagePresetId;
    title: string;
    size: string;
    count: number;
}

export function imagePresetOptions(): ImagePresetOption[] {
    return IMAGE_PRESET_IDS.map((id) => {
        const preset = resolveImagePreset(id);
        return { id, title: preset.title, size: preset.size, count: preset.prompts.length };
    });
}
