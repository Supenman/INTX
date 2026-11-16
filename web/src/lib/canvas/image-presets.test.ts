/**
 * 图片预设的数据契约：张数、尺寸、指令拼接。
 *
 * 这几项错一项就会白花钱（比如分镜本该 4 张却合成 1 张、三视图被渠道的
 * 1:1 覆盖成方的），所以用断言钉死，而不是靠肉眼过一遍。
 */
import { describe, expect, it, vi } from "vitest";

// i18n 初始化会读 localStorage；这些用例只验纯数据，给个内存桩就够。
vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
});

const { IMAGE_PRESET_IDS, imagePresetOptions, isImagePresetId, resolveImagePreset } = await import("./image-presets");

describe("图片预设 · 张数与尺寸", () => {
    it("五个预设都能取到标题、尺寸和至少一条指令", () => {
        for (const id of IMAGE_PRESET_IDS) {
            const preset = resolveImagePreset(id);
            expect(preset.title.length, id).toBeGreaterThan(0);
            expect(preset.prompts.length, id).toBeGreaterThan(0);
            expect(preset.size, id).toMatch(/^\d+x\d+$/);
            expect(preset.prompts.every((prompt) => prompt.trim().length > 0), id).toBe(true);
        }
    });

    it("三视图各 1 张，分镜与多机位各 4 张", () => {
        expect(resolveImagePreset("character-three-view").prompts).toHaveLength(1);
        expect(resolveImagePreset("face-three-view").prompts).toHaveLength(1);
        expect(resolveImagePreset("product-three-view").prompts).toHaveLength(1);
        expect(resolveImagePreset("storyboard").prompts).toHaveLength(4);
        expect(resolveImagePreset("multi-camera").prompts).toHaveLength(4);
    });

    it("尺寸按预设固定：三视图 16:9、面部三视图 3:1", () => {
        expect(resolveImagePreset("character-three-view").size).toBe("2048x1152");
        expect(resolveImagePreset("product-three-view").size).toBe("2048x1152");
        expect(resolveImagePreset("face-three-view").size).toBe("3456x1152");
        // 3:1 必须是精确宽度，别被 21:9 之类的近似比例替代
        const [width, height] = resolveImagePreset("face-three-view").size.split("x").map(Number);
        expect(width / height).toBeCloseTo(3, 5);
    });

    it("分镜/多机位的四条指令互不相同（否则四张图会一样）", () => {
        for (const id of ["storyboard", "multi-camera"] as const) {
            const prompts = resolveImagePreset(id).prompts;
            expect(new Set(prompts).size, id).toBe(prompts.length);
        }
    });
});

describe("图片预设 · 指令拼接", () => {
    it("每条指令都追加一致性要求，避免换机位时主体跟着变", () => {
        for (const id of IMAGE_PRESET_IDS) {
            const prompts = resolveImagePreset(id).prompts;
            // 同一预设的多条指令共享同一个结尾
            const tails = prompts.map((prompt) => prompt.slice(-12));
            expect(new Set(tails).size, id).toBe(1);
            // 结尾之前必须还有正文，不能只剩一句后缀
            expect(prompts.every((prompt) => prompt.length > 12), id).toBe(true);
        }
    });
});

describe("图片预设 · 选项列表", () => {
    it("选项顺序稳定，且与 id 列表一一对应", () => {
        expect(imagePresetOptions().map((option) => option.id)).toEqual([...IMAGE_PRESET_IDS]);
    });

    it("只认已知 id，脏数据不进去", () => {
        expect(isImagePresetId("storyboard")).toBe(true);
        expect(isImagePresetId("three-view")).toBe(false);
        expect(isImagePresetId(undefined)).toBe(false);
    });
});
