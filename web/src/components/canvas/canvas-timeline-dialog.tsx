import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Film, GripVertical, Music2, Pause, Play, Plus, Scissors, Trash2, Type } from "lucide-react";
import { App, Button, Select } from "antd";
import type { CanvasNodeData } from "@/types/canvas";
import type { Timeline, TimelineTrack } from "@/domain/timeline/model";
import { addClip, moveClip, removeClip, splitClip, timelineDuration, trimClip } from "@/domain/timeline/model";
import { secondsToTicks, ticksPerFrame, ticksToSeconds } from "@/domain/timeline/time";
import { addClipToTrack, clipAtSeconds, pixelToSeconds, replaceTrackClips, resolveClips, snapToEdges, trackOf, type ResolvedClip } from "@/domain/timeline/view";
import { nodesById } from "@/domain/timeline/resolve";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { saveFile } from "@/lib/runtime/save-file";
import { encodeTimeline } from "@/lib/canvas/timeline-export";
import { COLOR_GRADES, colorGradeFilter } from "@/lib/canvas/color-grade";

function label(node: CanvasNodeData | undefined, fallback: string) {
    return node?.title || fallback;
}

export function CanvasTimelineDialog({ open, onClose, nodes, timeline, onTimelineChange, onUpdateNode, onImportAudio, onActiveNodeChange, title }: {
    open: boolean;
    onClose: () => void;
    nodes: CanvasNodeData[];
    timeline: Timeline;
    onTimelineChange: (next: Timeline) => void;
    onUpdateNode: (id: string, patch: Partial<NonNullable<CanvasNodeData["metadata"]>>) => void;
    /** 导入音频，返回新建音频节点 id，以便追加到音频轨。 */
    onImportAudio: (file: File) => Promise<string | null>;
    /** 播放头命中的镜头节点 id（空档或关闭时为 null），供画布联动高亮。 */
    onActiveNodeChange?: (nodeId: string | null) => void;
    title: string;
}) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [resolution, setResolution] = useState("1280x720");
    const [exporting, setExporting] = useState(false);
    const [progress, setProgress] = useState(0);
    const [playhead, setPlayhead] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [pixelsPerSecond, setPixelsPerSecond] = useState(48);
    const [drag, setDrag] = useState<{ clipId: string; originX: number; originTick: number; trackId: TimelineTrack["kind"] } | null>(null);
    const [trimDrag, setTrimDrag] = useState<{ clipId: string; kind: TimelineTrack["kind"]; edge: "start" | "end"; pointerX: number; startTick: number; durationTick: number } | null>(null);
    const [previewError, setPreviewError] = useState("");
    const playbackStart = useRef(0);
    const playbackStartedAt = useRef(0);
    const videoRef = useRef<HTMLVideoElement>(null);
    const audioRefs = useRef(new Map<string, HTMLAudioElement>());

    const fps = timeline.fps;
    const index = useMemo(() => nodesById(nodes), [nodes]);
    const videoTrack = useMemo(() => trackOf(timeline, "video"), [timeline]);
    const audioTrack = useMemo(() => trackOf(timeline, "audio"), [timeline]);
    const textTrack = useMemo(() => trackOf(timeline, "text"), [timeline]);
    const videoClips = useMemo(() => resolveClips(videoTrack, index), [videoTrack, index]);
    const audioClips = useMemo(() => resolveClips(audioTrack, index), [audioTrack, index]);
    const textClips = useMemo(() => resolveClips(textTrack, index), [textTrack, index]);
    const textNodes = useMemo(() => nodes.filter((node) => node.type === "text" && node.metadata?.content?.trim()), [nodes]);
    const totalSeconds = ticksToSeconds(timelineDuration(timeline));
    const visiblePlayhead = Math.min(playhead, totalSeconds);
    const current = clipAtSeconds(videoClips, visiblePlayhead);
    const currentNode = current?.node;

    // 拖动期间 timeline 每次 move 都会更新；用 ref 读最新值，避免 effect 因依赖变化反复摘挂监听器。
    const timelineRef = useRef(timeline);
    timelineRef.current = timeline;
    // 按 kind 替换 clips（领域层纯函数，已钉住 id≠kind 的回归）；从 ref 读最新 timeline 避免拖动中闭包过期。
    const replaceTrack = (kind: TimelineTrack["kind"], nextClips: NonNullable<Timeline["tracks"]>[number]["clips"]) => {
        onTimelineChange(replaceTrackClips(timelineRef.current, kind, nextClips));
    };

    useEffect(() => {
        if (open) {
            setPlayhead(0);
            setPlaying(false);
            setPreviewError("");
        } else {
            setPlaying(false);
            audioRefs.current.forEach((audio) => audio.pause());
        }
    }, [open]);

    // 画布联动：把播放头命中的镜头节点同步出去；空档与关闭时清除高亮。
    useEffect(() => {
        onActiveNodeChange?.(open ? currentNode?.id ?? null : null);
    }, [open, currentNode?.id, onActiveNodeChange]);

    // 视频帧/图片预览：按 clip 的素材内时间点定位，空档处 current 为 null。
    const currentSourceSeconds = current ? current.sourceStartSeconds + (visiblePlayhead - current.startSeconds) : 0;
    useEffect(() => {
        const video = videoRef.current;
        if (!video || currentNode?.type !== "video") return;
        const seek = () => {
            if (Number.isFinite(currentSourceSeconds) && Math.abs(video.currentTime - currentSourceSeconds) > 0.2) video.currentTime = currentSourceSeconds;
            if (playing) void video.play().catch(() => setPreviewError(t("canvas.timeline.previewVideoError")));
            else video.pause();
        };
        if (video.readyState >= 1) seek();
        else video.addEventListener("loadedmetadata", seek, { once: true });
        return () => video.removeEventListener("loadedmetadata", seek);
    }, [currentNode?.id, currentSourceSeconds, playing, t]);

    useEffect(() => {
        if (!playing) return;
        let frame = 0;
        const tick = (now: number) => {
            const next = playbackStart.current + (now - playbackStartedAt.current) / 1000;
            setPlayhead(Math.min(next, totalSeconds));
            if (next >= totalSeconds) { setPlaying(false); return; }
            frame = requestAnimationFrame(tick);
        };
        playbackStart.current = visiblePlayhead >= totalSeconds ? 0 : visiblePlayhead;
        playbackStartedAt.current = performance.now();
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [playing, totalSeconds]);

    // 音频按 clip 的绝对起点播放；非命中时暂停。
    useEffect(() => {
        for (const item of audioClips) {
            const audio = audioRefs.current.get(item.clip.nodeId);
            if (!audio) continue;
            const elapsed = visiblePlayhead - item.startSeconds;
            const active = playing && elapsed >= 0 && elapsed < item.durationSeconds;
            if (!active) { audio.pause(); continue; }
            const target = item.sourceStartSeconds + elapsed;
            if (Number.isFinite(audio.duration) && Math.abs(audio.currentTime - target) > 0.3) audio.currentTime = target;
            if (audio.paused) void audio.play().catch(() => setPreviewError(t("canvas.timeline.previewAudioError")));
        }
    }, [audioClips, playing, visiblePlayhead, t]);

    const seekTrack = (clientX: number, track: HTMLDivElement) => {
        const seconds = Math.min(totalSeconds, pixelToSeconds(clientX, track.getBoundingClientRect(), track.scrollLeft, pixelsPerSecond));
        setPlaying(false);
        setPlayhead(seconds);
    };

    // 拖动片段：把指针位移换算成秒，按帧吸附后写回 clip 的绝对起点。
    useEffect(() => {
        if (!drag) return;
        const handleMove = (event: PointerEvent) => {
            const deltaTicks = secondsToTicks((event.clientX - drag.originX) / pixelsPerSecond);
            const live = timelineRef.current;
            const track = trackOf(live, drag.trackId);
            // 候选点：同轨其它片段的起止 + 时间线 0 点；排除正在拖的片段自身。
            const edges = track.clips
                .filter((item) => item.id !== drag.clipId)
                .flatMap((item) => [item.startTick, item.startTick + item.durationTick]);
            const desired = snapToEdges(drag.originTick + deltaTicks, edges, secondsToTicks(0.25), fps);
            replaceTrack(drag.trackId, moveClip(track, drag.clipId, desired).clips);
        };
        const handleUp = () => setDrag(null);
        window.addEventListener("pointermove", handleMove);
        window.addEventListener("pointerup", handleUp, { once: true });
        return () => { window.removeEventListener("pointermove", handleMove); window.removeEventListener("pointerup", handleUp); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [drag, pixelsPerSecond, fps]);

    useEffect(() => {
        if (!trimDrag) return;
        const handleMove = (event: PointerEvent) => {
            const delta = secondsToTicks((event.clientX - trimDrag.pointerX) / pixelsPerSecond);
            const track = trackOf(timelineRef.current, trimDrag.kind);
            const { edge } = trimDrag;
            const tick = edge === "end" ? trimDrag.startTick + trimDrag.durationTick + delta : trimDrag.startTick + delta;
            // 视频段最短保证一帧，避免出现 1 tick 的画面；音频沿用原最小 1 tick。
            const min = trimDrag.kind === "video" ? ticksPerFrame(fps) : 1;
            replaceTrack(trimDrag.kind, trimClip(track, trimDrag.clipId, edge, Math.max(0, tick), min).clips);
        };
        const handleUp = () => setTrimDrag(null);
        window.addEventListener("pointermove", handleMove);
        window.addEventListener("pointerup", handleUp, { once: true });
        return () => { window.removeEventListener("pointermove", handleMove); window.removeEventListener("pointerup", handleUp); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [trimDrag, pixelsPerSecond]);

    const splitAtPlayhead = () => {
        if (!current) { message.info(t("canvas.timeline.splitNoShot")); return; }
        const next = splitClip(videoTrack, current.clip.id, secondsToTicks(visiblePlayhead), ticksPerFrame(fps));
        if (next === videoTrack) { message.info(t("canvas.timeline.splitNoShot")); return; }
        replaceTrack("video", next.clips);
    };

    const togglePlayback = () => {
        if (playing) { setPlaying(false); return; }
        if (visiblePlayhead >= totalSeconds) { setPlayhead(0); playbackStart.current = 0; }
        else playbackStart.current = visiblePlayhead;
        playbackStartedAt.current = performance.now();
        setPreviewError("");
        setPlaying(true);
    };

    const addAudio = async (file: File) => {
        const nodeId = await onImportAudio(file);
        if (!nodeId) return;
        const node = index.get(nodeId);
        const duration = node?.metadata?.durationMs ? secondsToTicks(node.metadata.durationMs / 1000) : secondsToTicks(4);
        replaceTrack("audio", addClip(trackOf(timeline, "audio"), {
            id: `clip-${nodeId}`, nodeId, startTick: 0, durationTick: duration, sourceStartTick: 0,
        }).clips);
    };

    const addText = (nodeId: string) => {
        if (textTrack.clips.some((clip) => clip.nodeId === nodeId)) return; // 同一文字不重复入轨
        onTimelineChange(addClipToTrack(timelineRef.current, "text", {
            id: `text-${nodeId}`, nodeId,
            startTick: secondsToTicks(visiblePlayhead), durationTick: secondsToTicks(4), sourceStartTick: 0,
        }));
    };

    const exportVideo = async () => {
        setPlaying(false);
        setExporting(true);
        setProgress(0);
        try {
            const [width, height] = resolution.split("x").map(Number);
            const { blob, container } = await encodeTimeline(nodes, timeline, { width: width!, height: height!, fps, onProgress: setProgress });
            const label = container === "mp4" ? "MP4" : "WebM";
            const outcome = await saveFile(blob, `${title || "INTX 时间线"}.${container}`);
            if (outcome.status === "saved") message.success(outcome.path ? `${label} 已保存：${outcome.path}` : `${label} 已导出`);
            else if (outcome.status === "failed") message.error(`${label} 保存失败：${String(outcome.error)}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "视频导出失败");
        } finally { setExporting(false); }
    };

    const timelineSeconds = Math.max(totalSeconds, 10);

    return <section aria-label={t("canvas.timeline.entry")} className="flex h-full min-h-0 flex-col overflow-hidden border-t" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
        <div className="flex shrink-0 items-center justify-between gap-4 px-4 py-2">
            <div className="flex items-center gap-2 text-sm font-medium"><Film className="size-4" />{t("canvas.timeline.entry")}</div>
            <div className="flex items-center gap-2">
                <Button size="small" onClick={onClose}>{t("canvas.timeline.close")}</Button>
                <Select size="small" value={resolution} onChange={setResolution} options={[{ value: "1280x720", label: "720p" }, { value: "1920x1080", label: "1080p" }]} />
                <Select size="small" value={fps} onChange={(value) => onTimelineChange({ ...timeline, fps: value })} options={[{ value: 24, label: "24 fps" }, { value: 30, label: "30 fps" }]} />
            </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-4 pb-3">
            <section className="flex shrink-0 items-center gap-4 rounded-xl border px-3 py-2" style={{ borderColor: theme.node.stroke }}>
                <div className="flex aspect-video h-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black">
                    {currentNode?.type === "video" ? <video
                        key={currentNode.id} ref={videoRef} src={currentNode.metadata?.content} muted playsInline preload="auto"
                        onError={() => setPreviewError(t("canvas.timeline.previewVideoError"))}
                        className="h-full w-full object-contain" style={{ filter: colorGradeFilter(currentNode.metadata?.colorGrade) }}
                    /> : currentNode?.type === "image" ? <img
                        src={currentNode.metadata?.content} alt={currentNode.title}
                        className="h-full w-full object-contain" style={{ filter: colorGradeFilter(currentNode.metadata?.colorGrade) }}
                    /> : <span className="text-sm text-white/60">{t("canvas.timeline.previewEmpty")}</span>}
                </div>
                <div className="flex shrink-0 flex-col items-center gap-2">
                    <div className="flex items-center gap-2">
                        <Button aria-label={playing ? t("canvas.timeline.pause") : t("canvas.timeline.play")} icon={playing ? <Pause className="size-4" /> : <Play className="size-4" />} onClick={togglePlayback} disabled={!videoClips.length || exporting} />
                        <Button aria-label={t("canvas.timeline.splitAtPlayhead")} title={t("canvas.timeline.splitHint")} icon={<Scissors className="size-4" />} onClick={splitAtPlayhead} disabled={!current || exporting} />
                    </div>
                    <span className="text-xs opacity-60">{currentNode?.title || "—"}</span>
                    {previewError && <span role="alert" className="max-w-44 text-center text-xs text-red-500">{previewError}</span>}
                </div>
            </section>

            <section className="min-w-0 shrink-0 rounded-xl border p-3" style={{ borderColor: theme.node.stroke }}>
                <div className="mb-2 flex items-center justify-between text-xs font-medium opacity-60"><span><Film className="mr-1 inline size-3.5" />{t("canvas.timeline.entry")} · {totalSeconds.toFixed(2)} 秒</span><span className="flex items-center gap-2"><button type="button" onClick={() => setPixelsPerSecond((v) => Math.max(18, v / 1.25))}>−</button><span>{Math.round(pixelsPerSecond)} px/s</span><button type="button" onClick={() => setPixelsPerSecond((v) => Math.min(160, v * 1.25))}>＋</button></span></div>
                <div className="overflow-x-auto pb-1">
                    <div className="relative" style={{ width: Math.max(640, timelineSeconds * pixelsPerSecond), minWidth: "100%" }}>
                        <div className="relative h-7 border-b" style={{ borderColor: theme.node.stroke }} onPointerDown={(event) => seekTrack(event.clientX, event.currentTarget)}>
                            {Array.from({ length: Math.ceil(timelineSeconds / Math.max(1, Math.ceil(80 / pixelsPerSecond))) + 1 }, (_, i) => i * Math.max(1, Math.ceil(80 / pixelsPerSecond))).filter((s) => s <= timelineSeconds).map((s) => <span key={s} className="absolute bottom-1 text-xs opacity-50" style={{ left: s * pixelsPerSecond }}>{s}s</span>)}
                        </div>
                        <div className="mt-1 text-xs opacity-60">视频 / 图片</div>
                        <div className="relative mt-1 h-12 rounded-md bg-black/5 dark:bg-white/5" onPointerDown={(event) => seekTrack(event.clientX, event.currentTarget)}>
                            {videoClips.map((item, i) => <div key={item.clip.id}
                                className={`absolute inset-y-1 flex items-center overflow-hidden rounded border text-white ${exporting ? "cursor-default opacity-60" : "cursor-grab active:cursor-grabbing"}`}
                                style={{ left: item.startSeconds * pixelsPerSecond, width: Math.max(28, item.durationSeconds * pixelsPerSecond), background: i % 2 ? "#665c8f" : "#4e7d72", borderColor: "transparent" }}
                                aria-label={t("canvas.timeline.dragShot", { name: label(item.node, String(i + 1)) })} title={t("canvas.timeline.dragShotHint")}
                                onPointerDown={(event) => { if (exporting) return; event.stopPropagation(); setDrag({ clipId: item.clip.id, originX: event.clientX, originTick: item.clip.startTick, trackId: "video" }); }}>
                                <button type="button" disabled={exporting} aria-label={t("canvas.timeline.trimStart", { name: label(item.node, String(i + 1)) })} className="h-full w-1.5 shrink-0 cursor-ew-resize bg-white/30" onPointerDown={(event) => { event.stopPropagation(); setTrimDrag({ clipId: item.clip.id, kind: "video", edge: "start", pointerX: event.clientX, startTick: item.clip.startTick, durationTick: item.clip.durationTick }); }} />
                                <GripVertical className="ml-0.5 size-3.5 shrink-0 opacity-70" />
                                {item.node?.type === "image" && item.node.metadata?.content ? <img src={item.node.metadata.content} alt="" className="h-full w-14 object-cover" draggable={false} /> : <Film className="size-4 shrink-0" />}
                                <span className="truncate text-xs">{label(item.node, "素材已删除")}</span>
                                <button type="button" aria-label="从时间线移除" className="ml-auto shrink-0 rounded p-0.5 hover:bg-white/20" onPointerDown={(e) => e.stopPropagation()} onClick={() => replaceTrack("video", removeClip(videoTrack, item.clip.id).clips)}><Trash2 className="size-3.5" /></button>
                                <button type="button" disabled={exporting} aria-label={t("canvas.timeline.trimEnd", { name: label(item.node, String(i + 1)) })} className="h-full w-1.5 shrink-0 cursor-ew-resize bg-white/30" onPointerDown={(event) => { event.stopPropagation(); setTrimDrag({ clipId: item.clip.id, kind: "video", edge: "end", pointerX: event.clientX, startTick: item.clip.startTick, durationTick: item.clip.durationTick }); }} />
                            </div>)}
                            <div className="pointer-events-none absolute inset-y-0 z-10 w-px" style={{ left: visiblePlayhead * pixelsPerSecond, background: theme.node.text }}><div className="absolute -left-1 top-0 size-2 rounded-full" style={{ background: theme.node.text }} /></div>
                        </div>
                        <div className="mt-1 text-xs opacity-60">音频</div>
                        <div className="relative mt-1 h-10 rounded-md bg-black/5 dark:bg-white/5" onPointerDown={(event) => seekTrack(event.clientX, event.currentTarget)}>
                            {audioClips.map((item) => <div key={item.clip.id}
                                className="absolute inset-y-1 flex cursor-grab items-center overflow-hidden rounded bg-emerald-700 text-white active:cursor-grabbing"
                                style={{ left: item.startSeconds * pixelsPerSecond, width: Math.max(28, item.durationSeconds * pixelsPerSecond) }}
                                onPointerDown={(event) => { event.stopPropagation(); setDrag({ clipId: item.clip.id, originX: event.clientX, originTick: item.clip.startTick, trackId: "audio" }); }}>
                                <button type="button" aria-label={`${label(item.node, "音频")} 入点`} className="h-full w-2 shrink-0 cursor-ew-resize bg-emerald-300/70" onPointerDown={(event) => { event.stopPropagation(); setTrimDrag({ clipId: item.clip.id, kind: "audio", edge: "start", pointerX: event.clientX, startTick: item.clip.startTick, durationTick: item.clip.durationTick }); }} />
                                <span className="min-w-0 flex-1 truncate px-1 text-xs">{label(item.node, "音频已删除")}</span>
                                <button type="button" aria-label={`${label(item.node, "音频")} 出点`} className="h-full w-2 shrink-0 cursor-ew-resize bg-emerald-300/70" onPointerDown={(event) => { event.stopPropagation(); setTrimDrag({ clipId: item.clip.id, kind: "audio", edge: "end", pointerX: event.clientX, startTick: item.clip.startTick, durationTick: item.clip.durationTick }); }} />
                            </div>)}
                            <div className="pointer-events-none absolute inset-y-0 z-10 w-px" style={{ left: visiblePlayhead * pixelsPerSecond, background: theme.node.text }} />
                        </div>
                        <div className="mt-1 flex items-center justify-between text-xs opacity-60"><span><Type className="mr-1 inline size-3.5" />{t("canvas.timeline.textTrack")}</span>
                            <Select size="small" aria-label={t("canvas.timeline.addText")} placeholder={t("canvas.timeline.addText")} options={textNodes.map((node) => ({ value: node.id, label: node.title }))} onChange={(value) => addText(value)} disabled={!textNodes.length} notFoundContent={t("canvas.timeline.addTextEmpty")} className="w-40" />
                        </div>
                        <div className="relative mt-1 h-9 rounded-md bg-black/5 dark:bg-white/5" onPointerDown={(event) => seekTrack(event.clientX, event.currentTarget)}>
                            {textClips.map((item) => <div key={item.clip.id}
                                className="absolute inset-y-1 flex cursor-grab items-center gap-1 overflow-hidden rounded bg-amber-700 text-white active:cursor-grabbing"
                                style={{ left: item.startSeconds * pixelsPerSecond, width: Math.max(28, item.durationSeconds * pixelsPerSecond) }}
                                onPointerDown={(event) => { event.stopPropagation(); setDrag({ clipId: item.clip.id, originX: event.clientX, originTick: item.clip.startTick, trackId: "text" }); }}>
                                <span className="min-w-0 flex-1 truncate px-1 text-xs">{label(item.node, "文字已删除")}</span>
                                <button type="button" aria-label={t("canvas.timeline.removeFromTimeline")} className="mr-0.5 shrink-0 rounded p-0.5 hover:bg-white/20" onPointerDown={(e) => e.stopPropagation()} onClick={() => replaceTrack("text", removeClip(textTrack, item.clip.id).clips)}><Trash2 className="size-3" /></button>
                            </div>)}
                            <div className="pointer-events-none absolute inset-y-0 z-10 w-px" style={{ left: visiblePlayhead * pixelsPerSecond, background: theme.node.text }} />
                        </div>
                    </div>
                    <div role="slider" tabIndex={totalSeconds > 0 ? 0 : -1} aria-label={t("canvas.timeline.playhead")} aria-valuemin={0} aria-valuemax={totalSeconds} aria-valuenow={visiblePlayhead} aria-valuetext={`${visiblePlayhead.toFixed(2)} 秒`} className="mt-1 flex h-5 items-center justify-between text-xs opacity-55" onPointerDown={(event) => seekTrack(event.clientX, event.currentTarget)} onKeyDown={(event) => { if (event.key === "ArrowLeft") { event.preventDefault(); setPlaying(false); setPlayhead((v) => Math.max(0, v - 1 / fps)); } if (event.key === "ArrowRight") { event.preventDefault(); setPlaying(false); setPlayhead((v) => Math.min(totalSeconds, v + 1 / fps)); } if (event.key === "Home") { setPlaying(false); setPlayhead(0); } if (event.key === "End") { setPlaying(false); setPlayhead(totalSeconds); } }}><span>{visiblePlayhead.toFixed(2)}s / {totalSeconds.toFixed(2)}s</span><span>{currentNode?.title}</span></div>
                </div>
                {!videoClips.length && <div className="px-2 py-5 text-center text-sm opacity-50">画布中没有可用的图片或视频节点加入时间线</div>}
                <div className="mt-3 grid grid-cols-2 gap-2">{videoClips.map((item) => <div key={item.clip.id} className="flex min-w-0 items-center gap-2 rounded px-2 py-1 hover:bg-black/5 dark:hover:bg-white/5"><span className="min-w-0 flex-1 truncate text-xs">{label(item.node, "素材已删除")}</span><label className="flex items-center gap-1 text-xs opacity-65">入<input aria-label={`${label(item.node, "素材")} 入点`} type="number" min="0" step="0.1" value={Number(item.sourceStartSeconds.toFixed(3))} onChange={(event) => replaceTrack("video", trimClip(videoTrack, item.clip.id, "start", secondsToTicks(Number(event.target.value))).clips)} className="w-14 rounded border bg-transparent px-1 py-0.5 text-right" /></label><label className="flex items-center gap-1 text-xs opacity-65">出<input aria-label={`${label(item.node, "素材")} 出点`} type="number" min="0.1" step="0.1" value={Number((item.sourceStartSeconds + item.durationSeconds).toFixed(3))} onChange={(event) => replaceTrack("video", trimClip(videoTrack, item.clip.id, "end", secondsToTicks(Number(event.target.value))).clips)} className="w-14 rounded border bg-transparent px-1 py-0.5 text-right" /></label>{item.node && <Select size="small" aria-label={t("canvas.timeline.colorGrade")} className="w-24" value={item.node.metadata?.colorGrade || "original"} onChange={(colorGrade) => onUpdateNode(item.node!.id, { colorGrade })} options={COLOR_GRADES.map((grade) => ({ value: grade, label: t(`canvas.timeline.grades.${grade}`) }))} />}</div>)}</div>
            </section>

            <section className="rounded-xl border p-3" style={{ borderColor: theme.node.stroke }}>
                <div className="mb-2 flex items-center justify-between"><div className="flex items-center gap-2 text-xs font-medium opacity-60"><Music2 className="size-3.5" />旁白 / 音频轨 · 与镜头独立混音</div><label className="flex cursor-pointer items-center gap-1 text-xs opacity-70 hover:opacity-100"><Plus className="size-3.5" />导入音频<input type="file" accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void addAudio(file); event.currentTarget.value = ""; }} /></label></div>
                <div className="space-y-2">{audioClips.map((item) => <div key={item.clip.id} className="grid grid-cols-[minmax(150px,1fr)_100px_100px_120px] items-center gap-3 rounded-lg px-2 py-2">
                    <div className="truncate text-sm">{label(item.node, "音频已删除")}</div>
                    {item.node && <audio ref={(element) => { if (element) audioRefs.current.set(item.node!.id, element); else audioRefs.current.delete(item.node!.id); }} src={item.node.metadata?.content} preload="auto" className="hidden" />}
                    <label className="flex items-center gap-1 text-xs opacity-60">入 <input aria-label={`${label(item.node, "音频")}入点`} type="number" min="0" step="0.1" value={Number(item.sourceStartSeconds.toFixed(3))} onChange={(event) => replaceTrack("audio", trimClip(audioTrack, item.clip.id, "start", secondsToTicks(Number(event.target.value))).clips)} className="w-16 rounded border bg-transparent px-1.5 py-1 text-right" style={{ borderColor: theme.node.stroke, color: theme.node.text }} /></label>
                    <label className="flex items-center gap-1 text-xs opacity-60">出 <input aria-label={`${label(item.node, "音频")}出点`} type="number" min="0.1" step="0.1" value={Number((item.sourceStartSeconds + item.durationSeconds).toFixed(3))} onChange={(event) => replaceTrack("audio", trimClip(audioTrack, item.clip.id, "end", secondsToTicks(Number(event.target.value))).clips)} className="w-16 rounded border bg-transparent px-1.5 py-1 text-right" style={{ borderColor: theme.node.stroke, color: theme.node.text }} /></label>
                    <label className="flex items-center gap-1 text-xs opacity-60">起始 <input aria-label={`${label(item.node, "音频")}起始时间`} type="number" min="0" step="0.1" value={Number(item.startSeconds.toFixed(3))} onChange={(event) => replaceTrack("audio", moveClip(audioTrack, item.clip.id, secondsToTicks(Number(event.target.value))).clips)} className="w-20 rounded border bg-transparent px-1.5 py-1 text-right" style={{ borderColor: theme.node.stroke, color: theme.node.text }} /></label>
                </div>)}{!audioClips.length && <div className="px-2 py-2 text-sm opacity-45">还没有音频。可导入旁白，或先把音频文件拖入画布。</div>}</div>
            </section>

            <div className="flex items-center justify-between"><div className="flex items-center gap-2 text-xs opacity-55"><Scissors className="size-3.5" />拖动片段改变位置，标签两侧改变入出点；片段之间可留空档。</div><Button type="primary" loading={exporting} disabled={!videoClips.length} onClick={() => void exportVideo()}>{exporting ? `导出中 ${progress}%` : "导出视频"}</Button></div>
        </div>
    </section>;
}
