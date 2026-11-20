/**
 * 视频导出容器与编码器的选择。
 *
 * 选容器不是偏好，是硬约束：实测 WebKitGTK 2.52（Tauri Linux 版用的引擎）的 `VideoEncoder`
 * 存在，但对 H.264 / AAC 返回不支持，只支持 VP8 / VP9 / Opus；Chromium 系（Web 版、
 * Windows WebView2）与 Safari（macOS）支持 AVC。写死 MP4 会让 Linux 桌面版的导出 100% 失败，
 * 而且往往要等编码跑到一半才报错，用户以为是卡死。
 *
 * 所以导出前先探测，能 MP4 就 MP4，否则降级 WebM，两者都不行就直接给出可读的错误。
 */

export type TimelineContainer = "mp4" | "webm";
export type EncoderChoice = {
    container: TimelineContainer;
    videoCodec: "avc" | "vp9" | "vp8";
    audioCodec: "aac" | "opus";
};

export async function pickEncoder(width: number, height: number, fps: number, needsAudio: boolean): Promise<EncoderChoice> {
    if (typeof VideoEncoder === "undefined") throw new Error("当前环境不支持视频编码（缺少 WebCodecs）");
    const bitrate = Math.round(width * height * fps * 0.12);
    const videoOk = async (codec: string) =>
        VideoEncoder.isConfigSupported({ codec, width, height, bitrate, framerate: fps })
            .then((result) => Boolean(result.supported))
            .catch(() => false);

    if (await videoOk("avc1.42001f")) {
        // 只有画面、没有音轨时不该被 AAC 拖累：能出 MP4 就出 MP4。
        const audioOk = !needsAudio || (typeof AudioEncoder !== "undefined"
            && await AudioEncoder.isConfigSupported({ codec: "mp4a.40.2", sampleRate: 48_000, numberOfChannels: 2, bitrate: 192_000 })
                .then((result) => Boolean(result.supported))
                .catch(() => false));
        if (audioOk) return { container: "mp4", videoCodec: "avc", audioCodec: "aac" };
    }
    if (await videoOk("vp09.00.10.08")) return { container: "webm", videoCodec: "vp9", audioCodec: "opus" };
    if (await videoOk("vp8")) return { container: "webm", videoCodec: "vp8", audioCodec: "opus" };
    throw new Error("当前环境不支持 H.264 或 VP8/VP9 视频编码，无法导出视频");
}
