import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Film, GripVertical, Music2, Pause, Play, Plus, Scissors } from "lucide-react";
import { App, Button, Select } from "antd";
import type { CanvasNodeData } from "@/types/canvas";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { saveFile } from "@/lib/runtime/save-file";
import { encodeTimeline } from "@/lib/canvas/timeline-export";
import { COLOR_GRADES, colorGradeFilter } from "@/lib/canvas/color-grade";

function clipDuration(node: CanvasNodeData) {
    const start = node.metadata?.timelineTrimStartSeconds ?? 0;
    const end = node.metadata?.timelineTrimEndSeconds ?? (node.metadata?.durationMs ? node.metadata.durationMs / 1000 : 4);
    return Math.max(0, end - start);
}

function time(value?: number, fallback = 0) {
    return value ?? fallback;
}

export function CanvasTimelineDialog({ open, onClose, nodes, selectedNodeIds, onUpdateNode, onImportAudio, title }: {
    open: boolean;
    onClose: () => void;
    nodes: CanvasNodeData[];
    selectedNodeIds: Set<string>;
    onUpdateNode: (id: string, patch: Partial<NonNullable<CanvasNodeData["metadata"]>>) => void;
    onImportAudio: (file: File) => Promise<void>;
    title: string;
}) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [resolution, setResolution] = useState("1280x720");
    const [fps, setFps] = useState(24);
    const [exporting, setExporting] = useState(false);
    const [progress, setProgress] = useState(0);
    const [playhead, setPlayhead] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [scrubbing, setScrubbing] = useState(false);
    const [draggedShotId, setDraggedShotId] = useState<string | null>(null);
    const [dropTargetId, setDropTargetId] = useState<string | null>(null);
    const [pixelsPerSecond, setPixelsPerSecond] = useState(48);
    const [audioTrimDrag, setAudioTrimDrag] = useState<{ nodeId: string; edge: "start" | "end"; pointerX: number; trimValue: number } | null>(null);
    const [previewError, setPreviewError] = useState("");
    const playbackStart = useRef(0);
    const playbackStartedAt = useRef(0);
    const videoRef = useRef<HTMLVideoElement>(null);
    const audioRefs = useRef(new Map<string, HTMLAudioElement>());
    const shots = useMemo(() => nodes.filter((node) => (node.type === "video" || node.type === "image") && node.metadata?.content && node.metadata.status === "success")
        .sort((a, b) => (a.metadata?.timelineOrder ?? a.position.x) - (b.metadata?.timelineOrder ?? b.position.x)), [nodes]);
    const selectedShots = useMemo(() => shots.filter((node) => selectedNodeIds.has(node.id)), [selectedNodeIds, shots]);
    const audios = useMemo(() => nodes.filter((node) => node.type === "audio" && node.metadata?.content && node.metadata.status === "success"), [nodes]);
    const shotDuration = shots.reduce((sum, node) => sum + clipDuration(node), 0);
    const totalSeconds = Math.max(shotDuration, ...audios.map((node) => (node.metadata?.timelineStartSeconds ?? 0) + Math.max(0, (node.metadata?.timelineTrimEndSeconds ?? (node.metadata?.durationMs ? node.metadata.durationMs / 1000 : 0)) - (node.metadata?.timelineTrimStartSeconds ?? 0))));
    const shotStarts = useMemo(() => {
        let elapsed = 0;
        return shots.map((node) => {
            const start = elapsed;
            elapsed += clipDuration(node);
            return start;
        });
    }, [shots]);
    const visiblePlayhead = Math.min(playhead, totalSeconds);
    const playheadShotIndex = Math.max(0, shots.findIndex((node, index) => visiblePlayhead < shotStarts[index]! + clipDuration(node) || index === shots.length - 1));
    const update = (node: CanvasNodeData, patch: Partial<NonNullable<CanvasNodeData["metadata"]>>) => onUpdateNode(node.id, patch);

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

    const currentShot = shots[playheadShotIndex];
    const currentShotStart = shotStarts[playheadShotIndex] ?? 0;
    const currentShotTime = (currentShot?.metadata?.timelineTrimStartSeconds ?? 0) + visiblePlayhead - currentShotStart;

    useEffect(() => {
        const video = videoRef.current;
        if (!video || currentShot?.type !== "video") return;
        const seek = () => {
            if (Number.isFinite(currentShotTime) && Math.abs(video.currentTime - currentShotTime) > 0.2) video.currentTime = currentShotTime;
            if (playing) void video.play().catch(() => setPreviewError(t("canvas.timeline.previewVideoError")));
            else video.pause();
        };
        if (video.readyState >= 1) seek();
        else video.addEventListener("loadedmetadata", seek, { once: true });
        return () => video.removeEventListener("loadedmetadata", seek);
    }, [currentShot?.id, currentShotTime, playing, t]);

    useEffect(() => {
        if (!playing) return;
        let frame = 0;
        const tick = (now: number) => {
            const next = playbackStart.current + (now - playbackStartedAt.current) / 1000;
            setPlayhead(Math.min(next, totalSeconds));
            if (next >= totalSeconds) {
                setPlaying(false);
                return;
            }
            frame = requestAnimationFrame(tick);
        };
        playbackStart.current = visiblePlayhead >= totalSeconds ? 0 : visiblePlayhead;
        playbackStartedAt.current = performance.now();
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [playing, totalSeconds]);

    useEffect(() => {
        const syncAudio = () => {
            for (const node of audios) {
                const audio = audioRefs.current.get(node.id);
                if (!audio) continue;
                const start = node.metadata?.timelineStartSeconds ?? 0;
                const trimStart = node.metadata?.timelineTrimStartSeconds ?? 0;
                const trimEnd = node.metadata?.timelineTrimEndSeconds ?? (node.metadata?.durationMs ? node.metadata.durationMs / 1000 : audio.duration);
                const elapsed = visiblePlayhead - start;
                const active = playing && elapsed >= 0 && elapsed < trimEnd - trimStart;
                if (!active) {
                    audio.pause();
                    continue;
                }
                const target = trimStart + elapsed;
                if (Math.abs(audio.currentTime - target) > 0.3) audio.currentTime = target;
                if (audio.paused) void audio.play().catch(() => setPreviewError(t("canvas.timeline.previewAudioError")));
            }
        };
        syncAudio();
    }, [audios, playing, visiblePlayhead, t]);

    const moveShot = (index: number, offset: number) => {
        const next = [...shots];
        const target = index + offset;
        if (target < 0 || target >= next.length) return;
        [next[index], next[target]] = [next[target]!, next[index]!];
        next.forEach((node, order) => update(node, { timelineOrder: order }));
    };

    const dropShot = (targetId: string) => {
        if (!draggedShotId || draggedShotId === targetId) return;
        const from = shots.findIndex((node) => node.id === draggedShotId);
        const to = shots.findIndex((node) => node.id === targetId);
        if (from < 0 || to < 0) return;
        const next = [...shots];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved!);
        next.forEach((node, order) => update(node, { timelineOrder: order }));
    };

    const seekTrack = (clientX: number, track: HTMLDivElement) => {
        const bounds = track.getBoundingClientRect();
        const seconds = Math.min(totalSeconds, Math.max(0, (clientX - bounds.left + track.scrollLeft) / pixelsPerSecond));
        setPlaying(false);
        setPlayhead(seconds);
    };

    useEffect(() => {
        if (!audioTrimDrag) return;
        const handlePointerMove = (event: PointerEvent) => {
            const delta = (event.clientX - audioTrimDrag.pointerX) / pixelsPerSecond;
            const node = audios.find((item) => item.id === audioTrimDrag.nodeId);
            if (!node) return;
            if (audioTrimDrag.edge === "start") {
                const next = Math.min(audioTrimDrag.trimValue + delta, (node.metadata?.timelineTrimEndSeconds ?? (node.metadata?.durationMs ? node.metadata.durationMs / 1000 : audioTrimDrag.trimValue + 1)) - 0.1);
                update(node, { timelineTrimStartSeconds: Math.max(0, next) });
            } else {
                const sourceDuration = node.metadata?.durationMs ? node.metadata.durationMs / 1000 : Number.POSITIVE_INFINITY;
                update(node, { timelineTrimEndSeconds: Math.min(sourceDuration, Math.max((node.metadata?.timelineTrimStartSeconds ?? 0) + 0.1, audioTrimDrag.trimValue + delta)) });
            }
        };
        const handlePointerUp = () => setAudioTrimDrag(null);
        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp, { once: true });
        return () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
        };
    }, [audioTrimDrag, audios, pixelsPerSecond]);

    const addSelectedShots = () => {
        const existingIds = new Set(shots.map((node) => node.id));
        const nextOrder = shots.length;
        selectedShots.filter((node) => !existingIds.has(node.id)).forEach((node, index) => update(node, { timelineOrder: nextOrder + index }));
    };

    const seekAt = (clientX: number, track: HTMLDivElement) => {
        if (!totalSeconds) return;
        const bounds = track.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (clientX - bounds.left) / bounds.width));
        setPlayhead(ratio * totalSeconds);
    };

    const togglePlayback = () => {
        if (playing) {
            setPlaying(false);
            return;
        }
        if (visiblePlayhead >= totalSeconds) {
            setPlayhead(0);
            playbackStart.current = 0;
        } else playbackStart.current = visiblePlayhead;
        playbackStartedAt.current = performance.now();
        setPreviewError("");
        setPlaying(true);
    };

    const exportMp4 = async () => {
        setPlaying(false);
        setExporting(true);
        setProgress(0);
        try {
            const [width, height] = resolution.split("x").map(Number);
            const blob = await encodeTimeline(nodes, { width: width!, height: height!, fps, onProgress: setProgress });
            const outcome = await saveFile(blob, `${title || "INTX 时间线"}.mp4`);
            if (outcome.status === "saved") message.success(outcome.path ? `MP4 已保存：${outcome.path}` : "MP4 已导出");
            else if (outcome.status === "failed") message.error(`MP4 保存失败：${String(outcome.error)}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "MP4 导出失败");
        } finally {
            setExporting(false);
        }
    };

    return <section aria-label={t("canvas.timeline.entry")} className="flex h-full min-h-0 flex-col overflow-hidden border-t" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
        <div className="flex shrink-0 items-center justify-between gap-4 px-4 py-2">
                <div className="flex items-center gap-2 text-sm font-medium"><Film className="size-4" />{t("canvas.timeline.entry")}</div>
                <div className="flex items-center gap-2">
                    <Button size="small" onClick={addSelectedShots} disabled={!selectedShots.some((node) => !shots.some((shot) => shot.id === node.id))}>{t("canvas.timeline.addSelection", { count: selectedShots.length })}</Button>
                    <Button size="small" onClick={onClose}>{t("canvas.timeline.close")}</Button>
                    <Select size="small" value={resolution} onChange={setResolution} options={[{ value: "1280x720", label: "720p" }, { value: "1920x1080", label: "1080p" }]} />
                    <Select size="small" value={fps} onChange={setFps} options={[{ value: 24, label: "24 fps" }, { value: 30, label: "30 fps" }]} />
                </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-4 pb-3">

            <section className="flex shrink-0 items-center gap-4 rounded-xl border px-3 py-2" style={{ borderColor: theme.node.stroke }}>
                <div className="flex aspect-video h-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black">
                    {currentShot?.type === "video" ? <video
                        key={currentShot.id}
                        ref={videoRef}
                        src={currentShot.metadata?.content}
                        muted
                        playsInline
                        preload="auto"
                        onError={() => setPreviewError(t("canvas.timeline.previewVideoError"))}
                        className="h-full w-full object-contain"
                        style={{ filter: colorGradeFilter(currentShot.metadata?.colorGrade) }}
                    /> : currentShot?.type === "image" ? <img
                        src={currentShot.metadata?.content}
                        alt={currentShot.title}
                        className="h-full w-full object-contain"
                        style={{ filter: colorGradeFilter(currentShot.metadata?.colorGrade) }}
                    /> : <span className="text-sm text-white/60">{t("canvas.timeline.previewEmpty")}</span>}
                </div>
                <div className="flex shrink-0 flex-col items-center gap-2">
                    <Button aria-label={playing ? t("canvas.timeline.pause") : t("canvas.timeline.play")} icon={playing ? <Pause className="size-4" /> : <Play className="size-4" />} onClick={togglePlayback} disabled={!shots.length || exporting} />
                    <span className="text-xs opacity-60">{currentShot?.title || "—"}</span>
                    {previewError && <span role="alert" className="max-w-44 text-center text-xs text-red-500">{previewError}</span>}
                </div>
            </section>

            <section className="min-w-0 shrink-0 rounded-xl border p-3" style={{ borderColor: theme.node.stroke }}>
                <div className="mb-2 flex items-center justify-between text-xs font-medium opacity-60"><span><Film className="mr-1 inline size-3.5" />时间线总长 · {totalSeconds.toFixed(2)} 秒</span><span className="flex items-center gap-2"><button type="button" onClick={() => setPixelsPerSecond((value) => Math.max(18, value / 1.25))}>−</button><span>{Math.round(pixelsPerSecond)} px/s</span><button type="button" onClick={() => setPixelsPerSecond((value) => Math.min(160, value * 1.25))}>＋</button></span></div>
                <div className="overflow-x-auto pb-1">
                    <div className="relative" style={{ width: Math.max(640, totalSeconds * pixelsPerSecond), minWidth: "100%" }}>
                        <div className="relative h-7 border-b" style={{ borderColor: theme.node.stroke }} onPointerDown={(event) => seekTrack(event.clientX, event.currentTarget)}>
                            {Array.from({ length: Math.ceil(totalSeconds / Math.max(1, Math.ceil(80 / pixelsPerSecond))) + 1 }, (_, index) => index * Math.max(1, Math.ceil(80 / pixelsPerSecond))).filter((second) => second <= totalSeconds).map((second) => <span key={second} className="absolute bottom-1 text-[10px] opacity-50" style={{ left: second * pixelsPerSecond }}>{second}s</span>)}
                        </div>
                        <div className="mt-1 text-xs opacity-60">视频 / 图片</div>
                        <div className="relative mt-1 h-12 rounded-md bg-black/5 dark:bg-white/5" onPointerDown={(event) => seekTrack(event.clientX, event.currentTarget)}>
                            {shots.map((node, index) => <div key={node.id} onDragOver={(event) => { event.preventDefault(); setDropTargetId(node.id); }} onDrop={(event) => { event.preventDefault(); dropShot(node.id); setDraggedShotId(null); setDropTargetId(null); }} className="absolute inset-y-1 flex items-center overflow-hidden rounded border text-white transition-opacity" style={{ left: shotStarts[index]! * pixelsPerSecond, width: Math.max(28, clipDuration(node) * pixelsPerSecond), background: index % 2 ? "#665c8f" : "#4e7d72", borderColor: dropTargetId === node.id ? "white" : "transparent", opacity: draggedShotId === node.id ? 0.5 : 1 }}>
                                <button type="button" draggable={!exporting} aria-label={t("canvas.timeline.dragShot", { name: node.title || index + 1 })} title={t("canvas.timeline.dragShotHint")} className="flex size-full cursor-grab items-center gap-2 px-2 text-left active:cursor-grabbing" onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", node.id); setDraggedShotId(node.id); }} onDragEnd={() => { setDraggedShotId(null); setDropTargetId(null); }}>
                                    {node.type === "image" && node.metadata?.content ? <img src={node.metadata.content} alt="" className="h-full w-14 object-cover" draggable={false} /> : <Film className="ml-1 size-4 shrink-0" />}
                                    <span className="truncate text-xs">{index + 1}. {node.title || (node.type === "video" ? "视频镜头" : "图片镜头")}</span>
                                </button>
                            </div>)}
                            <div className="pointer-events-none absolute inset-y-0 z-10 w-px" style={{ left: visiblePlayhead * pixelsPerSecond, background: theme.node.text }}><div className="absolute -left-1 top-0 size-2 rounded-full" style={{ background: theme.node.text }} /></div>
                        </div>
                        {audios.length > 0 && <div className="mt-1 text-xs opacity-60">音频</div>}
                        <div hidden={!audios.length} className="relative mt-1 h-10 rounded-md bg-black/5 dark:bg-white/5" onPointerDown={(event) => seekTrack(event.clientX, event.currentTarget)}>
                            {audios.map((node) => {
                                const start = node.metadata?.timelineStartSeconds ?? 0;
                                const trimStart = node.metadata?.timelineTrimStartSeconds ?? 0;
                                const trimEnd = node.metadata?.timelineTrimEndSeconds ?? (node.metadata?.durationMs ? node.metadata.durationMs / 1000 : 0);
                                const duration = Math.max(0, trimEnd - trimStart);
                                return <div key={node.id} draggable={!exporting} onDragStart={(event) => { event.dataTransfer.setData("text/plain", node.id); setDraggedShotId(node.id); }} onDragEnd={(event) => { const track = event.currentTarget.parentElement?.parentElement; const bounds = track?.getBoundingClientRect(); if (bounds) update(node, { timelineStartSeconds: Math.max(0, (event.clientX - bounds.left + (track?.scrollLeft ?? 0)) / pixelsPerSecond) }); setDraggedShotId(null); }} className="absolute inset-y-1 flex cursor-grab items-center overflow-hidden rounded bg-emerald-700 text-white active:cursor-grabbing" style={{ left: start * pixelsPerSecond, width: Math.max(28, duration * pixelsPerSecond), opacity: draggedShotId === node.id ? 0.55 : 1 }} title={node.title}>
                                    <button type="button" aria-label={`${node.title} 音频入点`} className="h-full w-2 shrink-0 cursor-ew-resize bg-emerald-300/70" onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setAudioTrimDrag({ nodeId: node.id, edge: "start", pointerX: event.clientX, trimValue: trimStart }); }} />
                                    <span className="min-w-0 flex-1 truncate px-1 text-xs">{node.title || "音频"}</span>
                                    <button type="button" aria-label={`${node.title} 音频出点`} className="h-full w-2 shrink-0 cursor-ew-resize bg-emerald-300/70" onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setAudioTrimDrag({ nodeId: node.id, edge: "end", pointerX: event.clientX, trimValue: trimEnd }); }} />
                                </div>;
                            })}
                            <div className="pointer-events-none absolute inset-y-0 z-10 w-px" style={{ left: visiblePlayhead * pixelsPerSecond, background: theme.node.text }} />
                        </div>
                    </div>
                    <div role="slider" tabIndex={totalSeconds > 0 ? 0 : -1} aria-label={t("canvas.timeline.playhead")} aria-valuemin={0} aria-valuemax={totalSeconds} aria-valuenow={visiblePlayhead} aria-valuetext={`${visiblePlayhead.toFixed(2)} 秒`} className="mt-1 flex h-5 items-center justify-between text-[10px] opacity-55" onPointerDown={(event) => seekTrack(event.clientX, event.currentTarget)} onKeyDown={(event) => { if (event.key === "ArrowLeft") { event.preventDefault(); setPlaying(false); setPlayhead((value) => Math.max(0, value - 1 / fps)); } if (event.key === "ArrowRight") { event.preventDefault(); setPlaying(false); setPlayhead((value) => Math.min(totalSeconds, value + 1 / fps)); } if (event.key === "Home") { setPlaying(false); setPlayhead(0); } if (event.key === "End") { setPlaying(false); setPlayhead(totalSeconds); } }}><span>{visiblePlayhead.toFixed(2)}s / {totalSeconds.toFixed(2)}s</span><span>{shots[playheadShotIndex]?.title}</span></div>
                </div>
                {!shots.length && <div className="px-2 py-5 text-center text-sm opacity-50">画布中没有可用的图片或视频节点</div>}
                <div className="mt-3 grid grid-cols-2 gap-2">{shots.map((node) => <div key={node.id} className="flex min-w-0 items-center gap-2 rounded px-2 py-1 hover:bg-black/5 dark:hover:bg-white/5"><span className="min-w-0 flex-1 truncate text-xs">{node.title}</span><label className="flex items-center gap-1 text-[10px] opacity-65">入<input aria-label={`${node.title} 入点`} type="number" min="0" step="0.1" value={time(node.metadata?.timelineTrimStartSeconds)} onChange={(event) => update(node, { timelineTrimStartSeconds: Number(event.target.value) })} className="w-14 rounded border bg-transparent px-1 py-0.5 text-right" /></label><label className="flex items-center gap-1 text-[10px] opacity-65">出<input aria-label={`${node.title} 出点`} type="number" min="0.1" step="0.1" value={time(node.metadata?.timelineTrimEndSeconds, node.metadata?.durationMs ? node.metadata.durationMs / 1000 : 4)} onChange={(event) => update(node, { timelineTrimEndSeconds: Number(event.target.value) })} className="w-14 rounded border bg-transparent px-1 py-0.5 text-right" /></label><Select size="small" aria-label={t("canvas.timeline.colorGrade")} className="w-24" value={node.metadata?.colorGrade || "original"} onChange={(colorGrade) => update(node, { colorGrade })} options={COLOR_GRADES.map((grade) => ({ value: grade, label: t(`canvas.timeline.grades.${grade}`) }))} /></div>)}</div>
            </section>

            <section className="rounded-xl border p-3" style={{ borderColor: theme.node.stroke }}>
                <div className="mb-2 flex items-center justify-between"><div className="flex items-center gap-2 text-xs font-medium opacity-60"><Music2 className="size-3.5" />旁白 / 音频轨 · 与镜头独立混音</div><label className="flex cursor-pointer items-center gap-1 text-xs opacity-70 hover:opacity-100"><Plus className="size-3.5" />导入音频<input type="file" accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void onImportAudio(file); event.currentTarget.value = ""; }} /></label></div>
                <div className="space-y-2">{audios.map((node) => <div key={node.id} className="grid grid-cols-[minmax(150px,1fr)_100px_100px_120px] items-center gap-3 rounded-lg px-2 py-2">
                    <div className="truncate text-sm">{node.title || "音频"}</div>
                    <audio ref={(element) => { if (element) audioRefs.current.set(node.id, element); else audioRefs.current.delete(node.id); }} src={node.metadata?.content} preload="auto" className="hidden" />
                    <label className="flex items-center gap-1 text-xs opacity-60">入 <input aria-label={`${node.title} 音频入点`} type="number" min="0" step="0.1" value={time(node.metadata?.timelineTrimStartSeconds)} onChange={(event) => update(node, { timelineTrimStartSeconds: Number(event.target.value) })} className="w-16 rounded border bg-transparent px-1.5 py-1 text-right" style={{ borderColor: theme.node.stroke, color: theme.node.text }} /></label>
                    <label className="flex items-center gap-1 text-xs opacity-60">出 <input aria-label={`${node.title} 音频出点`} type="number" min="0.1" step="0.1" value={time(node.metadata?.timelineTrimEndSeconds, node.metadata?.durationMs ? node.metadata.durationMs / 1000 : 0)} onChange={(event) => update(node, { timelineTrimEndSeconds: Number(event.target.value) })} className="w-16 rounded border bg-transparent px-1.5 py-1 text-right" style={{ borderColor: theme.node.stroke, color: theme.node.text }} /></label>
                    <label className="flex items-center gap-1 text-xs opacity-60">起始 <input aria-label={`${node.title} 音频起始时间`} type="number" min="0" step="0.1" value={time(node.metadata?.timelineStartSeconds)} onChange={(event) => update(node, { timelineStartSeconds: Number(event.target.value) })} className="w-20 rounded border bg-transparent px-1.5 py-1 text-right" style={{ borderColor: theme.node.stroke, color: theme.node.text }} /></label>
                </div>)}{!audios.length && <div className="px-2 py-2 text-sm opacity-45">还没有音频。可导入旁白，或先把音频文件拖入画布。</div>}</div>
            </section>

            <div className="flex items-center justify-between"><div className="flex items-center gap-2 text-xs opacity-55"><Scissors className="size-3.5" />导出期间可继续等待；进度按视频帧编码显示。</div><Button type="primary" loading={exporting} disabled={!shots.length} onClick={() => void exportMp4()}>{exporting ? `导出中 ${progress}%` : "导出 MP4"}</Button></div>
        </div>
    </section>;
}
