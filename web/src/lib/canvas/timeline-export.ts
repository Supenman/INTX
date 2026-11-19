import type { CanvasNodeData } from "@/types/canvas";
import { getMediaBlob } from "@/services/file-storage";
import { colorGradeFilter } from "@/lib/canvas/color-grade";

export type TimelineExportOptions = { width: number; height: number; fps: number; onProgress?: (value: number) => void };

async function mediaBlob(node: CanvasNodeData) {
    if (node.metadata?.storageKey) {
        const stored = await getMediaBlob(node.metadata.storageKey);
        if (stored) return stored;
    }
    const response = await fetch(node.metadata?.content || "");
    if (!response.ok) throw new Error(`读取「${node.title}」失败：HTTP ${response.status}`);
    return response.blob();
}

function drawContain(context: CanvasRenderingContext2D, source: CanvasImageSource, width: number, height: number, sourceWidth: number, sourceHeight: number, filter: string) {
    context.filter = "none";
    context.fillStyle = "#000";
    context.fillRect(0, 0, width, height);
    const scale = Math.min(width / sourceWidth, height / sourceHeight);
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    context.filter = filter;
    context.drawImage(source, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
    context.filter = "none";
}

export async function encodeTimeline(nodes: CanvasNodeData[], options: TimelineExportOptions) {
    const { ALL_FORMATS, AudioBufferSource, BlobSource, BufferTarget, CanvasSink, CanvasSource, Input, Mp4OutputFormat, Output } = await import("mediabunny");
    const shots = nodes.filter((node) => (node.type === "video" || node.type === "image") && node.metadata?.status === "success" && node.metadata.content)
        .sort((a, b) => (a.metadata?.timelineOrder ?? a.position.x) - (b.metadata?.timelineOrder ?? b.position.x));
    const audios = nodes.filter((node) => node.type === "audio" && node.metadata?.status === "success" && node.metadata.content);
    if (!shots.length) throw new Error("时间线里没有可导出的成功图片或视频镜头");

    const shotDurations = shots.map((node) => Math.max(0, (node.metadata?.timelineTrimEndSeconds ?? (node.metadata?.durationMs ? node.metadata.durationMs / 1000 : 4)) - (node.metadata?.timelineTrimStartSeconds ?? 0)));
    if (!shotDurations.some((clipDuration) => clipDuration > 0)) throw new Error("至少需要一个入点早于出点的镜头");
    const shotStarts: number[] = [];
    let duration = 0;
    shots.forEach((node, index) => {
        shotStarts[index] = duration;
        duration += shotDurations[index]!;
    });

    const decodedAudio: { buffer: AudioBuffer; start: number; trimStart: number; duration: number }[] = [];
    const audioContext = new AudioContext();
    try {
        for (const node of audios) {
            const blob = await mediaBlob(node);
            const buffer = await audioContext.decodeAudioData(await blob.arrayBuffer());
            const trimStart = node.metadata?.timelineTrimStartSeconds ?? 0;
            const trimEnd = node.metadata?.timelineTrimEndSeconds ?? buffer.duration;
            const clipDuration = Math.max(0, Math.min(buffer.duration, trimEnd) - trimStart);
            const start = node.metadata?.timelineStartSeconds ?? 0;
            if (clipDuration > 0) decodedAudio.push({ buffer, start, trimStart, duration: clipDuration });
            duration = Math.max(duration, start + clipDuration);
        }
    } finally {
        await audioContext.close();
    }
    if (duration <= 0) throw new Error("时间线时长必须大于 0");

    const canvas = document.createElement("canvas");
    canvas.width = options.width;
    canvas.height = options.height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("无法创建视频画布");
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat(), target });
    const videoSource = new CanvasSource(canvas, { codec: "avc", bitrate: Math.round(options.width * options.height * options.fps * 0.12) });
    output.addVideoTrack(videoSource, { frameRate: options.fps });

    let audioSource: InstanceType<typeof AudioBufferSource> | undefined;
    let mixedBuffer: AudioBuffer | undefined;
    if (decodedAudio.length) {
        const sampleRate = 48_000;
        const frameCount = Math.ceil(duration * sampleRate);
        const mixed = new OfflineAudioContext(2, frameCount, sampleRate);
        for (const clip of decodedAudio) {
            const source = mixed.createBufferSource();
            source.buffer = clip.buffer;
            source.connect(mixed.destination);
            source.start(clip.start, clip.trimStart, clip.duration);
        }
        mixedBuffer = await mixed.startRendering();
        audioSource = new AudioBufferSource({ codec: "aac", bitrate: 192_000 });
        output.addAudioTrack(audioSource);
    }

    const inputs = new Map<string, { input?: InstanceType<typeof Input>; sink?: InstanceType<typeof CanvasSink>; image?: HTMLImageElement }>();
    try {
        for (const shot of shots) {
            if (shot.type === "image") {
                const image = new Image();
                image.src = shot.metadata!.content!;
                await image.decode();
                inputs.set(shot.id, { image });
                continue;
            }
            const input = new Input({ source: new BlobSource(await mediaBlob(shot)), formats: ALL_FORMATS });
            const track = await input.getPrimaryVideoTrack();
            if (!track) throw new Error(`「${shot.title}」没有可读取的视频轨道`);
            inputs.set(shot.id, { input, sink: new CanvasSink(track) });
        }

        await output.start();
        const frameCount = Math.ceil(duration * options.fps);
        let shotIndex = 0;
        for (let frame = 0; frame < frameCount; frame += 1) {
            const time = frame / options.fps;
            while (shotIndex < shots.length - 1 && time >= shotStarts[shotIndex]! + shotDurations[shotIndex]!) shotIndex += 1;
            const shot = shots[shotIndex]!;
            const localTime = time - shotStarts[shotIndex]! + (shot.metadata?.timelineTrimStartSeconds ?? 0);
            const source = inputs.get(shot.id)!;
            const filter = colorGradeFilter(shot.metadata?.colorGrade);
            if (source.image) {
                drawContain(context, source.image, options.width, options.height, source.image.naturalWidth, source.image.naturalHeight, filter);
            } else {
                const clipEnd = (shot.metadata?.timelineTrimEndSeconds ?? (shot.metadata?.durationMs ? shot.metadata.durationMs / 1000 : Number.POSITIVE_INFINITY)) - 0.001;
                const decodedFrame = await source.sink!.getCanvas(Math.min(localTime, clipEnd));
                if (!decodedFrame) throw new Error(`无法解码「${shot.title}」的 ${localTime.toFixed(2)} 秒画面`);
                drawContain(context, decodedFrame.canvas, options.width, options.height, decodedFrame.canvas.width, decodedFrame.canvas.height, filter);
            }
            await videoSource.add(time, 1 / options.fps, { keyFrame: frame === 0 });
            if (frame % options.fps === 0) options.onProgress?.(Math.min(99, Math.round((time / duration) * 100)));
        }
        if (audioSource && mixedBuffer) await audioSource.add(mixedBuffer);
        await output.finalize();
        options.onProgress?.(100);
        if (!target.buffer) throw new Error("MP4 封装没有生成文件");
        return new Blob([target.buffer], { type: "video/mp4" });
    } finally {
        inputs.forEach(({ input }) => input?.dispose());
    }
}
