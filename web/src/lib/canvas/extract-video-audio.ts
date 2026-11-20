import { getMediaBlob } from "@/services/file-storage";
import type { CanvasNodeData } from "@/types/canvas";

export async function extractVideoAudio(node: CanvasNodeData) {
    const { ALL_FORMATS, AudioBufferSink, AudioBufferSource, BlobSource, BufferTarget, Input, Output, WavOutputFormat } = await import("mediabunny");
    const blob = node.metadata?.storageKey ? await getMediaBlob(node.metadata.storageKey) : null;
    const source = blob || await (async () => {
        const response = await fetch(node.metadata?.content || "");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.blob();
    })();
    const input = new Input({ source: new BlobSource(source), formats: ALL_FORMATS });
    try {
        const tracks = await input.getAudioTracks();
        if (!tracks.length) throw new Error("no-audio-track");
        const target = new BufferTarget();
        const output = new Output({ format: new WavOutputFormat(), target });
        const audioSource = new AudioBufferSource({ codec: "pcm-s16" });
        output.addAudioTrack(audioSource);
        await output.start();
        const sink = new AudioBufferSink(tracks[0]!);
        // AudioBufferSource 只能顺序拼接，不接受逐段 timestamp（只有首段的 startTimestamp）。
        // 因此音轨中间的静音间隙会被压平、后续内容整体前移。常见手机/相机素材音轨从 0 秒连续开始，
        // 不受影响；若将来要支持带间隙的素材，需按 chunk.timestamp 手动补静音段。
        for await (const chunk of sink.buffers()) await audioSource.add(chunk.buffer);
        await output.finalize();
        if (!target.buffer) throw new Error("empty-output");
        return new Blob([target.buffer], { type: "audio/wav" });
    } finally {
        input.dispose();
    }
}
