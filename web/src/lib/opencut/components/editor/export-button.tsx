"use client";

import { useRef, useState } from "react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/lib/opencut/components/ui/popover";
import { Button } from "@/lib/opencut/components/ui/button";
import { Label } from "@/lib/opencut/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/lib/opencut/components/ui/radio-group";
import { Progress } from "@/lib/opencut/components/ui/progress";
import { Checkbox } from "@/lib/opencut/components/ui/checkbox";
import {
	getExportMimeType,
	getExportFileExtension,
} from "@/lib/opencut/export";
import { Check, Copy, Download, RotateCcw } from "lucide-react";
import {
	EXPORT_FORMAT_VALUES,
	EXPORT_QUALITY_VALUES,
	type ExportFormat,
	type ExportQuality,
} from "@/lib/opencut/export";
import {
	Section,
	SectionContent,
	SectionHeader,
	SectionTitle,
} from "@/lib/opencut/components/section";
import { useEditor } from "@/lib/opencut/editor/use-editor";
import { DEFAULT_EXPORT_OPTIONS } from "@/lib/opencut/export/defaults";
import { App } from "antd";
import { uploadMediaFile } from "@/services/file-storage";
import { useAssetStore } from "@/stores/use-asset-store";
import { saveFile } from "@/lib/runtime/save-file";

function isExportFormat(value: string): value is ExportFormat {
	return EXPORT_FORMAT_VALUES.some((formatValue) => formatValue === value);
}

function isExportQuality(value: string): value is ExportQuality {
	return EXPORT_QUALITY_VALUES.some((qualityValue) => qualityValue === value);
}

export function ExportButton() {
	const [isExportPopoverOpen, setIsExportPopoverOpen] = useState(false);
	const [saving, setSaving] = useState(false);
	const editor = useEditor();
	const activeProject = useEditor((e) => e.project.getActiveOrNull());
	const hasProject = !!activeProject;

	const handlePopoverOpenChange = ({ open }: { open: boolean }) => {
		if (!open) {
			if (saving || editor.project.getExportState().isExporting) return;
			editor.project.clearExportState();
		}
		setIsExportPopoverOpen(open);
	};

	return (
		<Popover
			open={isExportPopoverOpen}
			onOpenChange={(open) => handlePopoverOpenChange({ open })}
		>
			<PopoverTrigger asChild>
				<Button type="button" className="h-8 gap-2 px-3" disabled={!hasProject} aria-label="导出项目">
					<Download className="size-4" />
					导出
				</Button>
			</PopoverTrigger>
			{hasProject && isExportPopoverOpen && <ExportPopover saving={saving} setSaving={setSaving} onOpenChange={setIsExportPopoverOpen} />}
		</Popover>
	);
}

function ExportPopover({
	saving,
	setSaving,
	onOpenChange,
}: {
	saving: boolean;
	setSaving: (saving: boolean) => void;
	onOpenChange: (open: boolean) => void;
}) {
	const { message } = App.useApp();
	const editor = useEditor();
	const activeProject = useEditor((e) => e.project.getActive());
	const exportState = useEditor((e) => e.project.getExportState());
	const { isExporting, progress, result: exportResult } = exportState;
	const [format, setFormat] = useState<ExportFormat>(
		DEFAULT_EXPORT_OPTIONS.format,
	);
	const [quality, setQuality] = useState<ExportQuality>(
		DEFAULT_EXPORT_OPTIONS.quality,
	);
	const [shouldIncludeAudio, setShouldIncludeAudio] = useState<boolean>(
		DEFAULT_EXPORT_OPTIONS.includeAudio ?? true,
	);
	const [rendered, setRendered] = useState<{ blob: Blob; filename: string; width: number; height: number } | null>(null);
	const [saveError, setSaveError] = useState("");
	const saveInFlight = useRef(false);

	const saveRenderedVideo = async ({ blob, filename, width, height }: NonNullable<typeof rendered>) => {
		if (saveInFlight.current) return;
		saveInFlight.current = true;
		setSaving(true);
		setSaveError("");
		try {
			const outcome = await saveFile(blob, filename);
			if (outcome.status === "canceled") return;
			if (outcome.status === "failed") throw new Error("文件保存失败，请重新选择保存位置。");
			try {
				const assets = useAssetStore.getState();
				if (!assets.hydrated) await assets.load();
				const media = await uploadMediaFile(blob);
				assets.addAsset({
					kind: "video",
					title: filename,
					coverUrl: "",
					tags: [],
					source: "OpenCut 剪辑台",
					data: { url: media.url, storageKey: media.storageKey, width, height, bytes: media.bytes, mimeType: media.mimeType },
				});
				await assets.confirmSave();
				message.success(`导出完成\n文件：${outcome.path || filename}\n已加入「我的资产」：${filename}`, 12);
			} catch (error) {
				message.error(`文件已保存到：${outcome.path || filename}\n但未能加入「我的资产」：${error instanceof Error ? error.message : "请重试"}`, 12);
			}

			onOpenChange(false);
		} catch (error) {
			setSaveError(error instanceof Error ? error.message : "文件保存失败，请重试。");
		} finally {
			saveInFlight.current = false;
			setSaving(false);
		}
	};

	const handleExport = async () => {
		if (!activeProject || editor.project.getExportState().isExporting || saveInFlight.current) return;
		try {
			const result = await editor.project.export({
				options: { format, quality, fps: activeProject.settings.fps, includeAudio: shouldIncludeAudio },
			});
			if (result.cancelled) {
				editor.project.clearExportState();
				return;
			}
			if (!result.success) return;
			if (!result.buffer) throw new Error("没有生成可保存的视频。");
			const video = {
				blob: new Blob([result.buffer], { type: getExportMimeType({ format }) }),
				filename: `${activeProject.metadata.name}${getExportFileExtension({ format })}`,
				...activeProject.settings.canvasSize,
			};
			setRendered(video);
			editor.project.clearExportState();
			await saveRenderedVideo(video);
		} catch (error) {
			editor.project.clearExportState();
			message.error(error instanceof Error ? error.message : "导出失败，请重试。");
		}
	};

	const handleCancel = () => {
		editor.project.cancelExport();
	};

	return (
		<PopoverContent align="end" className="bg-background mr-4 flex w-80 max-w-[calc(100vw-2rem)] flex-col p-0">
			{rendered ? (
				<div className="space-y-3 p-3">
					<p role="status" className="text-sm font-medium">{saving ? "正在保存文件…" : "视频已生成，可以保存"}</p>
					<p className="truncate text-xs text-muted-foreground" title={rendered.filename}>{rendered.filename}</p>
					{saveError && <p role="alert" className="text-xs text-destructive">{saveError}</p>}
					<Button className="w-full" disabled={saving} onClick={() => void saveRenderedVideo(rendered)}>保存视频</Button>
				</div>
			) : exportResult && !exportResult.success ? (
				<ExportError
					error={exportResult.error || "Unknown error occurred"}
					onRetry={handleExport}
				/>
			) : (
				<>
					<div className="flex items-center justify-between p-3 border-b">
						<h3 className="font-medium text-sm">
							{isExporting ? "正在导出项目" : "导出项目"}
						</h3>
					</div>

					<div className="flex flex-col gap-4">
						{!isExporting && (
							<>
								<div className="flex flex-col">
									<Section
										collapsible
										defaultOpen={false}
										showTopBorder={false}
									>
										<SectionHeader>
											<SectionTitle>格式</SectionTitle>
										</SectionHeader>
										<SectionContent>
											<RadioGroup
												value={format}
												onValueChange={(value) => {
													if (isExportFormat(value)) {
														setFormat(value);
													}
												}}
											>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="mp4" id="mp4" />
													<Label htmlFor="mp4">
														MP4（H.264）- 兼容性更好
													</Label>
												</div>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="webm" id="webm" />
													<Label htmlFor="webm">
														WebM（VP9）- 文件更小
													</Label>
												</div>
											</RadioGroup>
										</SectionContent>
									</Section>

									<Section collapsible defaultOpen={false}>
										<SectionHeader>
											<SectionTitle>画质</SectionTitle>
										</SectionHeader>
										<SectionContent>
											<RadioGroup
												value={quality}
												onValueChange={(value) => {
													if (isExportQuality(value)) {
														setQuality(value);
													}
												}}
											>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="low" id="low" />
													<Label htmlFor="low">低 - 文件最小</Label>
												</div>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="medium" id="medium" />
													<Label htmlFor="medium">中 - 均衡</Label>
												</div>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="high" id="high" />
													<Label htmlFor="high">高 - 推荐</Label>
												</div>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="very_high" id="very_high" />
													<Label htmlFor="very_high">
														极高 - 文件最大
													</Label>
												</div>
											</RadioGroup>
										</SectionContent>
									</Section>

									<Section collapsible defaultOpen={false}>
										<SectionHeader>
											<SectionTitle>音频</SectionTitle>
										</SectionHeader>
										<SectionContent>
											<div className="flex items-center space-x-2">
												<Checkbox
													id="include-audio"
													checked={shouldIncludeAudio}
													onCheckedChange={(checked) =>
														setShouldIncludeAudio(!!checked)
													}
												/>
												<Label htmlFor="include-audio">
													导出时包含音频
												</Label>
											</div>
										</SectionContent>
									</Section>
								</div>

								<div className="p-3 pt-0">
									<Button onClick={handleExport} className="w-full gap-2">
										<Download className="size-4" />
										导出
									</Button>
								</div>
							</>
						)}

						{isExporting && (
							<div className="space-y-4 p-3">
								<div className="flex flex-col gap-2">
									<div className="flex items-center justify-between text-center">
										<p className="text-muted-foreground text-sm">
											{Math.round(progress * 100)}%
										</p>
										<p className="text-muted-foreground text-sm">100%</p>
									</div>
									<Progress value={progress * 100} className="w-full" />
								</div>

								<Button
									variant="outline"
									className="w-full rounded-md"
									onClick={handleCancel}
								>
								取消
								</Button>
							</div>
						)}
					</div>
				</>
			)}
		</PopoverContent>
	);
}

function ExportError({
	error,
	onRetry,
}: {
	error: string;
	onRetry: () => void;
}) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		await navigator.clipboard.writeText(error);
		setCopied(true);
		setTimeout(() => setCopied(false), 1000);
	};

	return (
		<div className="space-y-4 p-3">
			<div className="flex flex-col gap-1.5">
				<p className="text-destructive text-sm font-medium">导出失败</p>
				<p className="text-muted-foreground text-xs">{error}</p>
			</div>

			<div className="flex gap-2">
				<Button
					variant="outline"
					size="sm"
					className="h-8 flex-1 text-xs"
					onClick={handleCopy}
				>
					{copied ? <Check className="text-constructive" /> : <Copy />}
					复制错误信息
				</Button>
				<Button
					variant="outline"
					size="sm"
					className="h-8 flex-1 text-xs"
					onClick={onRetry}
				>
					<RotateCcw />
					重试
				</Button>
			</div>
		</div>
	);
}
