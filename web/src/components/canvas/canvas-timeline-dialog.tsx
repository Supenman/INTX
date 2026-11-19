import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, Film, GripVertical, Music2, Plus, Scissors } from "lucide-react";
import { App, Button, Modal, Select } from "antd";
import type { CanvasNodeData } from "@/types/canvas";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { saveFile } from "@/lib/runtime/save-file";
import { encodeTimeline } from "@/lib/canvas/timeline-export";
import { COLOR_GRADES } from "@/lib/canvas/color-grade";

function clipDuration(node: CanvasNodeData) {
    const start = node.metadata?.timelineTrimStartSeconds ?? 0;
    const end = node.metadata?.timelineTrimEndSeconds ?? (node.metadata?.durationMs ? node.metadata.durationMs / 1000 : 4);
    return Math.max(0, end - start);
}

function time(value?: number, fallback = 0) {
    return value ?? fallback;
}

export function CanvasTimelineDialog({ open, onClose, nodes, onUpdateNode, onImportAudio, title }: {
    open: boolean;
    onClose: () => void;
    nodes: CanvasNodeData[];
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
    const [scrubbing, setScrubbing] = useState(false);
    const [draggedShotId, setDraggedShotId] = useState<string | null>(null);
    const [dropTargetId, setDropTargetId] = useState<string | null>(null);
    const shots = useMemo(() => nodes.filter((node) => (node.type === "video" || node.type === "image") && node.metadata?.content && node.metadata.status === "success")
        .sort((a, b) => (a.metadata?.timelineOrder ?? a.position.x) - (b.metadata?.timelineOrder ?? b.position.x)), [nodes]);
    const audios = nodes.filter((node) => node.type === "audio" && node.metadata?.content && node.metadata.status === "success");
    const totalSeconds = shots.reduce((sum, node) => sum + clipDuration(node), 0);
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
        if (open) setPlayhead(0);
    }, [open]);

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

    const seekAt = (clientX: number, track: HTMLDivElement) => {
        if (!totalSeconds) return;
        const bounds = track.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (clientX - bounds.left) / bounds.width));
        setPlayhead(ratio * totalSeconds);
    };

    const exportMp4 = async () => {
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

    return <Modal destroyOnHidden open={open} onCancel={onClose} title={<span className="flex items-center gap-2"><Film className="size-4" />{t("canvas.timeline.entry")}</span>} width="min(1120px, 92vw)" footer={null} centered>
        <div className="flex min-h-[480px] flex-col gap-4" style={{ color: theme.node.text }}>
            <div className="flex items-center justify-between gap-4">
                <div className="text-sm opacity-60">按镜头顺序排列，编辑入点/出点；音频可独立定位并混音。</div>
                <div className="flex items-center gap-2">
                    <Select size="small" value={resolution} onChange={setResolution} options={[{ value: "1280x720", label: "720p" }, { value: "1920x1080", label: "1080p" }]} />
                    <Select size="small" value={fps} onChange={setFps} options={[{ value: 24, label: "24 fps" }, { value: 30, label: "30 fps" }]} />
                </div>
            </div>

            <section className="min-h-0 flex-1 overflow-auto rounded-xl border p-3" style={{ borderColor: theme.node.stroke }}>
                <div className="mb-2 flex items-center gap-2 text-xs font-medium opacity-60"><Film className="size-3.5" />视频 / 图片轨 · {totalSeconds.toFixed(2)} 秒</div>
                <div className="space-y-2">
                    {shots.map((node, index) => <div
                        key={node.id}
                        onDragOver={(event) => { event.preventDefault(); setDropTargetId(node.id); }}
                        onDragLeave={() => setDropTargetId((current) => current === node.id ? null : current)}
                        onDrop={(event) => { event.preventDefault(); dropShot(node.id); setDraggedShotId(null); setDropTargetId(null); }}
                        className="flex flex-wrap items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                        style={dropTargetId === node.id && draggedShotId !== node.id ? { background: theme.toolbar.activeBg } : undefined}
                    >
                        <div className="flex min-w-[180px] flex-1 items-center gap-1.5">
                            <button
                                type="button"
                                draggable={!exporting}
                                aria-label={t("canvas.timeline.dragShot", { name: node.title || index + 1 })}
                                title={t("canvas.timeline.dragShotHint")}
                                className="cursor-grab touch-none rounded p-1 opacity-50 hover:opacity-100 active:cursor-grabbing"
                                onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", node.id); setDraggedShotId(node.id); }}
                                onDragEnd={() => { setDraggedShotId(null); setDropTargetId(null); }}
                            ><GripVertical className="size-4" /></button>
                            <span className="w-6 shrink-0 text-xs opacity-45">{index + 1}</span><span className="truncate text-sm">{node.title || (node.type === "video" ? "视频镜头" : "图片镜头")}</span><span className="text-[11px] opacity-45">{node.type === "video" ? "视频" : "图片"}</span>
                        </div>
                        <label className="flex items-center gap-1 text-xs opacity-60">入 <input aria-label={`${node.title} 入点`} type="number" min="0" step="0.1" value={time(node.metadata?.timelineTrimStartSeconds)} onChange={(event) => update(node, { timelineTrimStartSeconds: Number(event.target.value) })} className="w-16 rounded border bg-transparent px-1.5 py-1 text-right" style={{ borderColor: theme.node.stroke, color: theme.node.text }} /></label>
                        <label className="flex items-center gap-1 text-xs opacity-60">出 <input aria-label={`${node.title} 出点`} type="number" min="0.1" step="0.1" value={time(node.metadata?.timelineTrimEndSeconds, node.metadata?.durationMs ? node.metadata.durationMs / 1000 : 4)} onChange={(event) => update(node, { timelineTrimEndSeconds: Number(event.target.value) })} className="w-16 rounded border bg-transparent px-1.5 py-1 text-right" style={{ borderColor: theme.node.stroke, color: theme.node.text }} /></label>
                        <label className="flex items-center gap-1.5 text-xs"><span className="opacity-65">{t("canvas.timeline.colorGrade")}</span><Select size="small" aria-label={t("canvas.timeline.colorGrade")} className="w-28" value={node.metadata?.colorGrade || "original"} onChange={(colorGrade) => update(node, { colorGrade })} options={COLOR_GRADES.map((grade) => ({ value: grade, label: t(`canvas.timeline.grades.${grade}`) }))} /></label>
                        <span className="flex items-center gap-1"><Button type="text" size="small" aria-label="上移镜头" disabled={index === 0} icon={<ArrowUp className="size-4" />} onClick={() => moveShot(index, -1)} /><Button type="text" size="small" aria-label="下移镜头" disabled={index === shots.length - 1} icon={<ArrowDown className="size-4" />} onClick={() => moveShot(index, 1)} /></span>
                    </div>)}
                    {!shots.length && <div className="px-2 py-8 text-center text-sm opacity-50">画布中没有可用的图片或视频节点</div>}
                </div>
                {shots.length > 0 && <div className="mt-3">
                    <div className="mb-1 flex justify-between text-[11px] opacity-55"><span>{t("canvas.timeline.playhead")}: {visiblePlayhead.toFixed(2)}s / {totalSeconds.toFixed(2)}s</span><span>{shots[playheadShotIndex]?.title}</span></div>
                    <div
                        role="slider"
                        tabIndex={totalSeconds > 0 ? 0 : -1}
                        aria-disabled={totalSeconds <= 0}
                        aria-label={t("canvas.timeline.playhead")}
                        aria-valuemin={0}
                        aria-valuemax={totalSeconds}
                        aria-valuenow={visiblePlayhead}
                        aria-valuetext={`${visiblePlayhead.toFixed(2)} 秒`}
                        className="relative h-10 touch-none select-none overflow-hidden rounded-md outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                        style={{ touchAction: "none" }}
                        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setScrubbing(true); seekAt(event.clientX, event.currentTarget); }}
                        onPointerMove={(event) => { if (scrubbing) seekAt(event.clientX, event.currentTarget); }}
                        onPointerUp={() => setScrubbing(false)}
                        onPointerCancel={() => setScrubbing(false)}
                        onKeyDown={(event) => {
                            const frame = 1 / fps;
                            if (event.key === "ArrowLeft") { event.preventDefault(); setPlayhead((value) => Math.max(0, value - frame)); }
                            if (event.key === "ArrowRight") { event.preventDefault(); setPlayhead((value) => Math.min(totalSeconds, value + frame)); }
                            if (event.key === "Home") { event.preventDefault(); setPlayhead(0); }
                            if (event.key === "End") { event.preventDefault(); setPlayhead(totalSeconds); }
                        }}
                    >
                        {shots.map((node, index) => <div key={node.id} className="absolute inset-y-0 flex items-center justify-center overflow-hidden border-r border-black/20 text-[10px] text-white" style={{ left: `${totalSeconds ? shotStarts[index]! / totalSeconds * 100 : 0}%`, width: `${totalSeconds ? clipDuration(node) / totalSeconds * 100 : 0}%`, background: index % 2 ? "#665c8f" : "#4e7d72" }} title={`${index + 1}. ${node.title}`}>{index + 1}</div>)}
                        <div className="pointer-events-none absolute inset-y-0 z-10 w-0.5" style={{ left: `${totalSeconds ? visiblePlayhead / totalSeconds * 100 : 0}%`, background: theme.node.text }}><div className="absolute -left-1.5 top-0 size-3 rounded-sm" style={{ background: theme.node.text }} /></div>
                    </div>
                </div>}
            </section>

            <section className="rounded-xl border p-3" style={{ borderColor: theme.node.stroke }}>
                <div className="mb-2 flex items-center justify-between"><div className="flex items-center gap-2 text-xs font-medium opacity-60"><Music2 className="size-3.5" />旁白 / 音频轨 · 与镜头独立混音</div><label className="flex cursor-pointer items-center gap-1 text-xs opacity-70 hover:opacity-100"><Plus className="size-3.5" />导入音频<input type="file" accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void onImportAudio(file); event.currentTarget.value = ""; }} /></label></div>
                <div className="space-y-2">{audios.map((node) => <div key={node.id} className="grid grid-cols-[minmax(150px,1fr)_100px_100px_120px] items-center gap-3 rounded-lg px-2 py-2">
                    <div className="truncate text-sm">{node.title || "音频"}</div>
                    <label className="flex items-center gap-1 text-xs opacity-60">入 <input aria-label={`${node.title} 音频入点`} type="number" min="0" step="0.1" value={time(node.metadata?.timelineTrimStartSeconds)} onChange={(event) => update(node, { timelineTrimStartSeconds: Number(event.target.value) })} className="w-16 rounded border bg-transparent px-1.5 py-1 text-right" style={{ borderColor: theme.node.stroke, color: theme.node.text }} /></label>
                    <label className="flex items-center gap-1 text-xs opacity-60">出 <input aria-label={`${node.title} 音频出点`} type="number" min="0.1" step="0.1" value={time(node.metadata?.timelineTrimEndSeconds, node.metadata?.durationMs ? node.metadata.durationMs / 1000 : 0)} onChange={(event) => update(node, { timelineTrimEndSeconds: Number(event.target.value) })} className="w-16 rounded border bg-transparent px-1.5 py-1 text-right" style={{ borderColor: theme.node.stroke, color: theme.node.text }} /></label>
                    <label className="flex items-center gap-1 text-xs opacity-60">起始 <input aria-label={`${node.title} 音频起始时间`} type="number" min="0" step="0.1" value={time(node.metadata?.timelineStartSeconds)} onChange={(event) => update(node, { timelineStartSeconds: Number(event.target.value) })} className="w-20 rounded border bg-transparent px-1.5 py-1 text-right" style={{ borderColor: theme.node.stroke, color: theme.node.text }} /></label>
                </div>)}{!audios.length && <div className="px-2 py-2 text-sm opacity-45">还没有音频。可导入旁白，或先把音频文件拖入画布。</div>}</div>
            </section>

            <div className="flex items-center justify-between"><div className="flex items-center gap-2 text-xs opacity-55"><Scissors className="size-3.5" />导出期间可继续等待；进度按视频帧编码显示。</div><Button type="primary" loading={exporting} disabled={!shots.length} onClick={() => void exportMp4()}>{exporting ? `导出中 ${progress}%` : "导出 MP4"}</Button></div>
        </div>
    </Modal>;
}
