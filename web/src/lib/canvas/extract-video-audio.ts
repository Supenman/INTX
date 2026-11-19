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
        for await (const chunk of sink.buffers()) await audioSource.add(chunk.buffer);
        await output.finalize();
        if (!target.buffer) throw new Error("empty-output");
        return new Blob([target.buffer], { type: "audio/wav" });
    } finally {
        input.dispose();
    }
}
