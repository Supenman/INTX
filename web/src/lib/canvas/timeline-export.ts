import type { CanvasNodeData } from "@/types/canvas";
import type { Timeline } from "@/domain/timeline/model";
import { timelineDuration } from "@/domain/timeline/model";
import { ticksToSeconds } from "@/domain/timeline/time";
import { clipAtSeconds, resolveClips, trackOf, type ResolvedClip } from "@/domain/timeline/view";
import { nodesById } from "@/domain/timeline/resolve";
import { getMediaBlob } from "@/services/file-storage";
import { getImageBlob } from "@/services/image-storage";
import { colorGradeFilter } from "@/lib/canvas/color-grade";
import { pickEncoder, type TimelineContainer } from "@/lib/canvas/encoder-selection";
import { activeTextOverlays, textOf } from "@/lib/canvas/timeline-text";

export type TimelineExportOptions = { width: number; height: number; fps: number; onProgress?: (value: number) => void };
export type TimelineExportResult = { blob: Blob; container: TimelineContainer };


// 图片与音视频存在两套 IndexedDB store 里（`image:` 前缀在图片库，其余在媒体库），
// 只查一个 store 会让另一类素材永远读不到。key 前缀是唯一分流依据，别再猜类型。
async function storedBlob(storageKey: string) {
    return storageKey.startsWith("image:") ? getImageBlob(storageKey) : getMediaBlob(storageKey);
}

async function mediaBlob(node: CanvasNodeData) {
    const storageKey = node.metadata?.storageKey;
    if (storageKey) {
        const stored = await storedBlob(storageKey);
        if (stored) return stored;
    }
    // content 是会话内的 blob: 地址，刷新后即失效。这里只是最后兜底：
    // 有 storageKey 的节点在上一步就该读到，读不到说明素材真的丢了，别静默降级。
    const content = node.metadata?.content;
    if (!content) throw new Error(`「${node.title}」缺少素材，无法导出`);
    const response = await fetch(content);
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

/** 把当前时刻命中的字幕烧到底图上：底部居中、白字黑描边，任意底色都可读。多条纵向错开。 */
function drawTextOverlay(context: CanvasRenderingContext2D, overlays: readonly { text: string }[], width: number, height: number) {
    if (!overlays.length) return;
    const fontSize = Math.max(16, Math.round(height * 0.05));
    const lineHeight = Math.round(fontSize * 1.4);
    context.save();
    context.font = `600 ${fontSize}px system-ui, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "bottom";
    context.lineJoin = "round";
    overlays.forEach((overlay, i) => {
        const y = height - fontSize - 12 - i * lineHeight;
        context.lineWidth = Math.max(3, Math.round(fontSize * 0.15));
        context.strokeStyle = "rgba(0,0,0,0.85)";
        context.fillStyle = "#fff";
        context.strokeText(overlay.text, width / 2, y);
        context.fillText(overlay.text, width / 2, y);
    });
    context.restore();
}

export async function encodeTimeline(nodes: CanvasNodeData[], timeline: Timeline, options: TimelineExportOptions): Promise<TimelineExportResult> {
    const { ALL_FORMATS, AudioBufferSource, BlobSource, BufferTarget, CanvasSink, CanvasSource, Input, Mp4OutputFormat, Output, WebMOutputFormat } = await import("mediabunny");
    const index = nodesById(nodes);
    // 只导出有素材、可成功解码的镜头；悬空 clip（节点已删）直接跳过，不中断整段。
    const shots = resolveClips(trackOf(timeline, "video"), index).filter((item) => {
        const node = item.node;
        return node && (node.type === "video" || node.type === "image") && node.metadata?.status === "success" && node.metadata.content && item.durationSeconds > 0;
    }) as (ResolvedClip & { node: CanvasNodeData })[];
    const audioShots = resolveClips(trackOf(timeline, "audio"), index).filter((item) => {
        const node = item.node;
        return node && node.type === "audio" && node.metadata?.status === "success" && node.metadata.content && item.durationSeconds > 0;
    }) as (ResolvedClip & { node: CanvasNodeData })[];
    // 文字轨：多条可同时命中，节点需有可用文本；无文字轨时这里是空数组，每帧零开销。
    const textShots = resolveClips(trackOf(timeline, "text"), index).filter((item) => {
        const node = item.node;
        return node && node.type === "text" && item.durationSeconds > 0 && Boolean(textOf(node));
    });
    if (!shots.length) throw new Error("时间线里没有可导出的成功图片或视频镜头");

    const duration = ticksToSeconds(timelineDuration(timeline));
    if (duration <= 0) throw new Error("时间线时长必须大于 0");
    // 探测放在最前面：编码器不支持时要立刻告诉用户，不能等编码到 90% 才崩。
    const encoder = await pickEncoder(options.width, options.height, options.fps, audioShots.length > 0);

    const decodedAudio: { buffer: AudioBuffer; start: number; trimStart: number; duration: number }[] = [];
    const audioContext = new AudioContext();
    try {
        for (const item of audioShots) {
            const blob = await mediaBlob(item.node);
            const buffer = await audioContext.decodeAudioData(await blob.arrayBuffer());
            const trimStart = Math.min(item.sourceStartSeconds, buffer.duration);
            const clipDuration = Math.min(item.durationSeconds, Math.max(0, buffer.duration - trimStart));
            if (clipDuration > 0) decodedAudio.push({ buffer, start: item.startSeconds, trimStart, duration: clipDuration });
        }
    } finally {
        await audioContext.close();
    }

    const canvas = document.createElement("canvas");
    canvas.width = options.width;
    canvas.height = options.height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("无法创建视频画布");
    const target = new BufferTarget();
    const output = new Output({ format: encoder.container === "mp4" ? new Mp4OutputFormat() : new WebMOutputFormat(), target });
    const videoSource = new CanvasSource(canvas, { codec: encoder.videoCodec, bitrate: Math.round(options.width * options.height * options.fps * 0.12) });
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
        audioSource = new AudioBufferSource({ codec: encoder.audioCodec, bitrate: encoder.container === "mp4" ? 192_000 : 128_000 });
        output.addAudioTrack(audioSource);
    }

    const inputs = new Map<string, { input?: InstanceType<typeof Input>; sink?: InstanceType<typeof CanvasSink>; image?: HTMLImageElement; objectUrl?: string }>();
    try {
        for (const shot of shots) {
            if (shot.node.type === "image") {
                // 必须走 storageBlob：直接用 metadata.content 会在刷新页面后拿到失效的 blob URL，
                // 整段导出在这里中断。objectURL 要撑到最后一帧画完才能回收，故记进 inputs 由 finally 统一撤销。
                const objectUrl = URL.createObjectURL(await mediaBlob(shot.node));
                const image = new Image();
                image.src = objectUrl;
                try {
                    await image.decode();
                } catch {
                    URL.revokeObjectURL(objectUrl);
                    throw new Error(`「${shot.node.title}」图片解码失败，可能素材已丢失`);
                }
                inputs.set(shot.clip.id, { image, objectUrl });
                continue;
            }
            const input = new Input({ source: new BlobSource(await mediaBlob(shot.node)), formats: ALL_FORMATS });
            const track = await input.getPrimaryVideoTrack();
            if (!track) throw new Error(`「${shot.node.title}」没有可读取的视频轨道`);
            inputs.set(shot.clip.id, { input, sink: new CanvasSink(track) });
        }

        await output.start();
        const frameCount = Math.ceil(duration * options.fps);
        for (let frame = 0; frame < frameCount; frame += 1) {
            const time = frame / options.fps;
            // 黑底：空档或未命中镜头时只清成黑色，不沿用上一帧。
            context.filter = "none";
            context.fillStyle = "#000";
            context.fillRect(0, 0, options.width, options.height);
            const shot = clipAtSeconds(shots, time);
            if (shot) {
                const node = index.get(shot.clip.nodeId);
                const localTime = shot.sourceStartSeconds + (time - shot.startSeconds);
                const source = inputs.get(shot.clip.id)!;
                const filter = colorGradeFilter(node?.metadata?.colorGrade);
                if (source.image) {
                    drawContain(context, source.image, options.width, options.height, source.image.naturalWidth, source.image.naturalHeight, filter);
                } else {
                    const decodedFrame = await source.sink!.getCanvas(localTime);
                    if (decodedFrame) drawContain(context, decodedFrame.canvas, options.width, options.height, decodedFrame.canvas.width, decodedFrame.canvas.height, filter);
                }
            }
            if (textShots.length) {
                drawTextOverlay(context, activeTextOverlays(textShots, time), options.width, options.height);
            }
            // 每 2 秒插一个关键帧：只给首帧打关键帧会让播放器拖动时几乎无法跳转。
            await videoSource.add(time, 1 / options.fps, { keyFrame: frame % (options.fps * 2) === 0 });
            if (frame % options.fps === 0) options.onProgress?.(Math.min(99, Math.round((time / duration) * 100)));
        }
        if (audioSource && mixedBuffer) await audioSource.add(mixedBuffer);
        await output.finalize();
        options.onProgress?.(100);
        if (!target.buffer) throw new Error("视频封装没有生成文件");
        const type = encoder.container === "mp4" ? "video/mp4" : "video/webm";
        return { blob: new Blob([target.buffer], { type }), container: encoder.container };
    } finally {
        inputs.forEach(({ input, objectUrl }) => {
            input?.dispose();
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        });
    }
}
