import { afterEach, describe, expect, it, vi } from "vitest";
import { pickEncoder } from "./encoder-selection";

/** 用「支持哪些 codec 前缀」来模拟不同引擎的能力矩阵。 */
function stubCodecs(supported: { video: string[]; audio?: string[] }) {
    vi.stubGlobal("VideoEncoder", {
        isConfigSupported: async ({ codec }: { codec: string }) => ({
            supported: supported.video.some((prefix) => codec.startsWith(prefix)),
        }),
    });
    vi.stubGlobal("AudioEncoder", {
        isConfigSupported: async ({ codec }: { codec: string }) => ({
            supported: (supported.audio ?? []).some((prefix) => codec.startsWith(prefix)),
        }),
    });
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("pickEncoder", () => {
    it("prefers MP4 when the engine really does H.264 and AAC", async () => {
        // Chromium / WebView2 / macOS WKWebView 的能力面。
        stubCodecs({ video: ["avc1"], audio: ["mp4a"] });
        expect(await pickEncoder(1280, 720, 24, true)).toEqual({ container: "mp4", videoCodec: "avc", audioCodec: "aac" });
    });

    it("falls back to WebM on WebKitGTK, which has VideoEncoder but no H.264", async () => {
        // 实测 WebKitGTK 2.52：VideoEncoder 存在，avc / aac / av1 全是 false，vp8 / vp9 / opus 可用。
        stubCodecs({ video: ["vp09", "vp8"], audio: ["opus"] });
        expect(await pickEncoder(1280, 720, 24, true)).toEqual({ container: "webm", videoCodec: "vp9", audioCodec: "opus" });
    });

    it("keeps MP4 for a silent timeline when only the audio encoder is missing", async () => {
        stubCodecs({ video: ["avc1", "vp09"], audio: [] });
        expect(await pickEncoder(1920, 1080, 30, false)).toEqual({ container: "mp4", videoCodec: "avc", audioCodec: "aac" });
        // 有音轨时不能硬塞进 MP4。
        expect(await pickEncoder(1920, 1080, 30, true)).toEqual({ container: "webm", videoCodec: "vp9", audioCodec: "opus" });
    });

    it("uses VP8 as the last resort before giving up", async () => {
        stubCodecs({ video: ["vp8"], audio: ["opus"] });
        expect(await pickEncoder(640, 360, 24, true)).toEqual({ container: "webm", videoCodec: "vp8", audioCodec: "opus" });
    });

    it("reports a readable error instead of failing midway when nothing is encodable", async () => {
        stubCodecs({ video: [], audio: [] });
        await expect(pickEncoder(1280, 720, 24, false)).rejects.toThrow(/不支持 H\.264 或 VP8\/VP9/);
    });

    it("reports a readable error when WebCodecs is absent entirely", async () => {
        vi.stubGlobal("VideoEncoder", undefined);
        await expect(pickEncoder(1280, 720, 24, false)).rejects.toThrow(/缺少 WebCodecs/);
    });
});
