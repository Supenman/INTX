import { useEffect, useState } from "react";
import { ArrowUp, AudioLines, FileText, Film, Image as ImageIcon, LoaderCircle, Maximize2, RefreshCw, Square } from "lucide-react";
import { App, Button, Modal, Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { ModelPicker } from "@/components/model-picker";
import { modelWorkflowOf, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { missingWorkflowFields } from "@/lib/canvas/canvas-workflow";
import { CanvasWorkflowSettings } from "./canvas-workflow-settings";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasAudioSettingsPopover, type CanvasAudioSettingKey } from "./canvas-audio-settings-popover";
import { CanvasPromptChipInput } from "./canvas-prompt-chip-input";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasTextSettingsPopover } from "./canvas-text-settings-popover";
import { CanvasPromptFontControl, CanvasPromptResizeHandle } from "./canvas-prompt-controls";
import { CanvasNodeType, type CanvasConnection, type CanvasGenerationMode, type CanvasNodeData } from "@/types/canvas";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { buildNodeGenerationContext, nodeGenerationMode } from "./canvas-node-generation";
import { CanvasNodeReferenceBar } from "./canvas-node-reference-bar";
import { buildGenerationConfig, hasResumableImageTask, hasResumableVideoTask } from "@/lib/canvas/canvas-generation-helpers";

export type CanvasNodeGenerationMode = CanvasGenerationMode;

type CanvasNodePromptPanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    onPromptChange: (nodeId: string, prompt: string) => void;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => void;
    onGenerate: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => void;
    onStop: (nodeId: string) => void;
    onQueryTask: (node: CanvasNodeData) => void;
    mentionReferences?: CanvasResourceReference[];
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    selectingReferences?: boolean;
    referencePromptUpdateId?: string;
    onFinishReferenceSelection?: () => void;
    connectedNodes?: CanvasNodeData[];
    onDisconnectReference?: (fromNodeId: string, toNodeId: string) => void;
    onMoveReference?: (sourceId: string, targetId: string, delta: -1 | 1) => void;
    onReplaceReference?: (sourceId: string, targetId: string, replacementId: string) => void;
    onStartReferenceSelection?: (nodeId: string) => void;
    onSettingsOpenChange?: (open: boolean) => void;
    modeOverride?: CanvasNodeGenerationMode; // Plugin nodes set their generation type through useBuiltinPanel.mode.
};

const COMPOSER_MODE_META: Record<CanvasGenerationMode, { labelKey: string; icon: typeof ImageIcon }> = {
    image: { labelKey: "canvas.nodeTypes.image", icon: ImageIcon },
    video: { labelKey: "canvas.nodeTypes.video", icon: Film },
    audio: { labelKey: "canvas.nodeTypes.audio", icon: AudioLines },
    text: { labelKey: "canvas.nodeTypes.text", icon: FileText },
};

export function CanvasNodePromptPanel({ node, nodes, connections, selectingReferences = false, referencePromptUpdateId, onFinishReferenceSelection, isRunning, onPromptChange, onConfigChange, onGenerate, onStop, onQueryTask, mentionReferences = [], connectedNodes = [], onDisconnectReference, onMoveReference, onReplaceReference, onStartReferenceSelection, onSettingsOpenChange, modeOverride }: CanvasNodePromptPanelProps) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const globalConfig = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const mode = modeOverride ?? nodeGenerationMode(node.type);
    const config = buildGenerationConfig(globalConfig, node, mode);
    const hasTextContent = node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim());
    const hasImageContent = node.type === CanvasNodeType.Image && Boolean(node.metadata?.content);
    const canQueryImage = hasResumableImageTask(node);
    const canQuery = canQueryImage || hasResumableVideoTask(node);
    const retryBlocked = Boolean(node.metadata?.retryBlocked && !canQuery);
    const waiting = isRunning || node.metadata?.status === "loading";
    const isEditingExistingContent = hasTextContent || hasImageContent;
    const [prompt, setPrompt] = useState(node.metadata?.composerContent ?? node.metadata?.prompt ?? "");
    const [expanded, setExpanded] = useState(false);
    const [promptHeight, setPromptHeight] = useState(124);
    const [expandedPromptHeight, setExpandedPromptHeight] = useState(420);
    const [promptFontSize, setPromptFontSize] = useState(() => {
        const stored = typeof window === "undefined" ? Number.NaN : Number(window.localStorage.getItem("intx-canvas-prompt-font-size"));
        return Number.isFinite(stored) && stored >= 12 && stored <= 28 ? stored : 14;
    });

    // Restore the stored draft when switching nodes or inserting a reference from the canvas.
    useEffect(() => {
        setPrompt(node.metadata?.composerContent ?? node.metadata?.prompt ?? "");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [node.id, referencePromptUpdateId]);

    const updatePrompt = (value: string) => {
        setPrompt(value);
        if (isEditingExistingContent) onConfigChange(node.id, { composerContent: value });
        else onPromptChange(node.id, value);
    };

    const hasUpstreamText = connectedNodes.some((item) => item.type === CanvasNodeType.Text && Boolean(item.metadata?.content?.trim()));
    const workflow = modelWorkflowOf(config, config.model);
    const frameRoles = new Map<number, "firstFrame" | "lastFrame">();
    if (mode === "video") for (const field of workflow?.fields ?? []) {
        if (field.frameRole && field.media === "image") frameRoles.set(field.imageIndex ?? 0, field.frameRole);
    }
    const requiredMedia = workflow?.fields.filter((field) => field.media && (field.required || (field.array && (field.min ?? 0) > 0))) ?? [];
    const context = requiredMedia.length ? buildNodeGenerationContext(node.id, nodes, connections, "") : undefined;
    const imageIds = new Set(context?.referenceImages.map((image) => image.id));
    if (mode === "image" && hasImageContent && globalConfig.nodeRegenerateBehavior !== "overwrite" && (!workflow || !imageIds.size)) imageIds.add(node.id);
    const inputStatus = requiredMedia.map((field) => {
        const actual = field.media === "image" ? imageIds.size : field.media === "video" ? context?.videoCount ?? 0 : field.media === "audio" ? context?.audioCount ?? 0 : 0;
        const needed = field.array ? Math.max(field.min ?? 0, field.required ? 1 : 0) : (field.media === "video" ? field.videoIndex ?? 0 : field.imageIndex ?? 0) + 1;
        const kind = field.media === "video" || field.media === "audio" ? field.media : "image";
        return { actual, needed, kind, id: field.key };
    });
    const missingMedia = inputStatus.some(({ actual, needed }) => actual < needed);
    const missingFields = missingWorkflowFields(workflow, config.workflowValues?.[config.model]);
    const canSubmit = !selectingReferences && !retryBlocked && !canQuery && !waiting && !missingMedia && (Boolean(prompt.trim()) || (mode === "image" || mode === "video" ? connectedNodes.length > 0 || (Boolean(workflow) && imageIds.size > 0) : hasUpstreamText));
    const actionLabel = t(isRunning ? "canvas.promptPanel.stopGeneration" : waiting ? "canvas.node.generating" : canQuery ? "canvas.nodeToolbar.queryVideoTask" : "canvas.promptPanel.generate");
    const submitDisabled = !isRunning && (waiting || (canQuery ? selectingReferences : !canSubmit));
    const submit = () => {
        if (!canSubmit) return;
        if (missingFields.length) return void message.warning(t("settingsPanels.workflow.requiredField", { field: missingFields.map((key) => t(`settingsPanels.workflow.fieldLabels.${key}`, { defaultValue: key })).join("、") }));
        onGenerate(node.id, mode, prompt.trim());
    };

    const ModeIcon = COMPOSER_MODE_META[mode].icon;

    return (
        <div
            data-canvas-no-zoom
            data-canvas-prompt-panel
            className="rounded-[var(--r-xl)] border p-3 shadow-[var(--shadow-lg)] backdrop-blur-xl"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            {/* 顶部模式头栏：对齐 BeefTV 的 composer 层次，明确当前生成模式并把字号/放大收在右侧 */}
            <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                    <span
                        className="grid size-6 shrink-0 place-items-center rounded-[var(--r-sm)]"
                        style={{ background: theme.toolbar.itemHover, color: theme.node.text }}
                        aria-hidden
                    >
                        <ModeIcon className="size-3.5" />
                    </span>
                    <span className="truncate text-[length:var(--fs-caption)] font-semibold" style={{ color: theme.node.text }}>
                        {t(COMPOSER_MODE_META[mode].labelKey)}
                    </span>
                    {connectedNodes.length > 0 ? (
                        <span
                            className="inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[length:var(--fs-label)] tabular-nums"
                            style={{ background: theme.toolbar.itemHover, color: theme.node.muted }}
                        >
                            @{connectedNodes.length}
                        </span>
                    ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                    <CanvasPromptFontControl value={promptFontSize} onChange={setPromptFontSize} />
                    <Tooltip title={t("canvas.promptPanel.expandEditor")}>
                        <Button
                            type="text"
                            className="!h-7 !w-7 !min-w-7 !p-0"
                            style={{ color: theme.node.muted }}
                            icon={<Maximize2 className="size-3.5" />}
                            onClick={() => setExpanded(true)}
                            aria-label={t("canvas.promptPanel.expandEditor")}
                        />
                    </Tooltip>
                </div>
            </div>

            <CanvasNodeReferenceBar
                nodeId={node.id}
                nodes={nodes}
                connectedNodes={connectedNodes}
                selecting={selectingReferences}
                onFinishSelection={onFinishReferenceSelection}
                onDisconnect={onDisconnectReference}
                onMove={onMoveReference}
                onReplace={onReplaceReference}
                videoFrames={mode === "video" && !workflow && config.videoMode !== "reference"}
                frameRoles={frameRoles}
                onStartSelection={onStartReferenceSelection}
            />

            {(inputStatus.length > 0 || missingFields.length > 0) && (
                <div className="mb-2 space-y-1" role="status">
                    <div className="flex flex-wrap gap-1.5">
                        {inputStatus.map(({ id, kind, actual, needed }, index) => {
                            const short = actual < needed;
                            return (
                                <span key={`${id}:${index}`} className="inline-flex h-6 items-center gap-1 rounded-[var(--r-sm)] px-2 tabular-nums text-[length:var(--fs-label)]" style={{ background: theme.toolbar.activeBg, color: short ? "var(--destructive)" : theme.node.muted }}>
                                    {t(`canvas.promptPanel.requiredMedia.${kind}`, { actual: Math.min(actual, needed), needed })}
                                </span>
                            );
                        })}
                    </div>
                    {missingMedia && !canQuery && <p className="text-[length:var(--fs-caption)]" style={{ color: theme.node.muted }}>{t("canvas.promptPanel.missingMedia")}</p>}
                    {missingFields.length > 0 && <p className="text-[length:var(--fs-caption)]" style={{ color: theme.node.muted }}>{t("settingsPanels.workflow.requiredField", { field: missingFields.map((key) => t(`settingsPanels.workflow.fieldLabels.${key}`, { defaultValue: key })).join("、") })}</p>}
                </div>
            )}

            {/* 输入表面采用轻描边 + 节点表面色，摆脱厚重不透明底块，输入区更通透 */}
            <div
                className="relative overflow-hidden rounded-[var(--r-lg)] border transition-colors focus-within:border-[var(--workspace-accent)]"
                style={{ height: promptHeight, background: theme.node.fill, borderColor: theme.toolbar.border }}
            >
                <CanvasPromptChipInput
                    value={prompt}
                    references={mentionReferences}
                    onChange={updatePrompt}
                    onSubmit={submit}
                    className="thin-scrollbar h-full w-full cursor-text resize-none rounded-[var(--r-lg)] px-3 py-2.5 pb-6 leading-6 outline-none"
                    style={{ background: "transparent", color: theme.node.text, fontSize: promptFontSize }}
                    placeholder={t(`canvas.promptPanel.${mode === "image" && hasImageContent ? "editImage" : mode === "text" && hasTextContent ? "editText" : mode}`)}
                />
                <CanvasPromptResizeHandle height={promptHeight} min={84} max={360} onResize={setPromptHeight} />
            </div>

            {/* 底部操作栏：左侧模型选择器，右侧统一参数胶囊 + 高对比圆角提交按钮 */}
            <div className="mt-2.5 flex min-w-0 flex-wrap items-center gap-2">
                <ModelPicker
                    config={config}
                    value={config.model}
                    onChange={(model) => onConfigChange(node.id, { model })}
                    capability={mode}
                    onMissingConfig={() => openConfigDialog(true)}
                    className="min-w-0 max-w-[230px] grow basis-28"
                />
                <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5">
                    <div className="min-w-0">
                        {workflow ? (
                            <CanvasWorkflowSettings config={config} onChange={(workflowValues) => onConfigChange(node.id, { workflowValues })} onOpenChange={onSettingsOpenChange} />
                        ) : mode === "image" ? (
                            <CanvasImageSettingsPopover
                                config={config}
                                placement="topLeft"
                                onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })}
                                onMissingConfig={() => openConfigDialog(true)}
                                onOpenChange={onSettingsOpenChange}
                            />
                        ) : mode === "video" ? (
                            <CanvasVideoSettingsPopover
                                config={config}
                                onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))}
                                onOpenChange={onSettingsOpenChange}
                            />
                        ) : mode === "audio" ? (
                            <CanvasAudioSettingsPopover
                                config={config}
                                onConfigChange={(key, value) => onConfigChange(node.id, audioConfigPatch(key, value))}
                                onOpenChange={onSettingsOpenChange}
                            />
                        ) : (
                            <CanvasTextSettingsPopover
                                config={config}
                                count={node.metadata?.textCount || 1}
                                onConfigChange={(_, value) => onConfigChange(node.id, { reasoningEffort: value })}
                                onCountChange={(textCount) => onConfigChange(node.id, { textCount })}
                                onOpenChange={onSettingsOpenChange}
                            />
                        )}
                    </div>
                    <Tooltip title={actionLabel}>
                        <button
                            type="button"
                            disabled={submitDisabled}
                            onClick={() => (isRunning ? onStop(node.id) : canQuery ? onQueryTask(node) : submit())}
                            aria-label={actionLabel}
                            className="focus-ring inline-flex h-[var(--control-h-sm)] shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full px-3 text-[length:var(--fs-caption)] font-medium transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-45"
                            style={
                                isRunning
                                    ? { background: "var(--destructive)", color: "var(--destructive-foreground)" }
                                    : submitDisabled
                                        ? { background: theme.toolbar.itemHover, color: theme.node.muted }
                                        : { background: theme.node.text, color: theme.node.panel }
                            }
                        >
                            {isRunning ? (
                                <>
                                    <LoaderCircle aria-hidden className="size-3.5 motion-safe:animate-spin" />
                                    <Square className="size-3 fill-current" />
                                    <span>{t("canvas.promptPanel.stop")}</span>
                                </>
                            ) : waiting ? (
                                <>
                                    <LoaderCircle aria-hidden className="size-3.5 motion-safe:animate-spin" />
                                    <span>{t("canvas.node.generating")}</span>
                                </>
                            ) : canQuery ? (
                                <>
                                    <RefreshCw className="size-3.5" />
                                    <span>{actionLabel}</span>
                                </>
                            ) : (
                                <>
                                    <ArrowUp className="size-3.5" strokeWidth={2.4} />
                                    <span>{actionLabel}</span>
                                </>
                            )}
                        </button>
                    </Tooltip>
                </div>
            </div>

            {(waiting || canQuery || retryBlocked || node.metadata?.status === "error") && (
                <div role="status" className="mt-2 space-y-1 rounded-[var(--r-md)] border border-border bg-[var(--surface-sunken)] px-2.5 py-2 text-[length:var(--fs-caption)]" style={{ color: theme.node.muted }}>
                    <p className="font-medium">{t(isRunning ? "canvas.node.generating" : canQueryImage ? "canvas.generationHistory.imageTaskPending" : canQuery ? "canvas.promptPanel.resumeVideo" : waiting ? "canvas.node.generating" : retryBlocked ? "canvas.node.retryBlockedHint" : "canvas.node.failed")}</p>
                    {!waiting && node.metadata?.errorDetails && <p className="max-h-14 overflow-y-auto wrap-break-word text-destructive" title={node.metadata.errorDetails}>{node.metadata.errorDetails}</p>}
                </div>
            )}

            <Modal title={t("canvas.promptPanel.editorTitle")} open={expanded} centered width={760} footer={null} onCancel={() => setExpanded(false)} destroyOnHidden>
                <div data-canvas-no-zoom className="pt-2" onWheelCapture={(event) => event.stopPropagation()}>
                    <CanvasNodeReferenceBar nodeId={node.id} nodes={nodes} connectedNodes={connectedNodes} actions={<CanvasPromptFontControl value={promptFontSize} onChange={setPromptFontSize} />} onDisconnect={onDisconnectReference} onMove={onMoveReference} onReplace={onReplaceReference} videoFrames={mode === "video" && !workflow && config.videoMode !== "reference"} frameRoles={frameRoles} onStartSelection={(nodeId) => { setExpanded(false); onStartReferenceSelection?.(nodeId); }} />
                    <div className="relative overflow-hidden rounded-xl border" style={{ height: expandedPromptHeight, borderColor: theme.toolbar.border, background: theme.node.fill }}>
                        <CanvasPromptChipInput
                            value={prompt}
                            references={mentionReferences}
                            onChange={updatePrompt}
                            className="thin-scrollbar h-full w-full cursor-text overflow-y-auto rounded-xl p-4 pb-7 leading-6 outline-none"
                            style={{ background: "transparent", color: theme.node.text, fontSize: promptFontSize }}
                            placeholder={t(`canvas.promptPanel.${mode === "image" && hasImageContent ? "editImage" : mode === "text" && hasTextContent ? "editText" : mode}`)}
                        />
                        <CanvasPromptResizeHandle height={expandedPromptHeight} min={240} max={Math.max(320, Math.min(760, window.innerHeight - 220))} onResize={setExpandedPromptHeight} />
                    </div>
                </div>
            </Modal>
        </div>
    );
}

function videoConfigPatch(key: keyof AiConfig, value: string) {
    if (key === "videoSeconds") return { seconds: value };
    if (key === "videoGenerateAudio") return { generateAudio: value };
    if (key === "videoWatermark") return { watermark: value };
    if (key === "videoMode") return { videoMode: value };
    return { [key]: value };
}

function audioConfigPatch(key: CanvasAudioSettingKey, value: string) {
    if (key === "audioVoice") return { audioVoice: value };
    if (key === "audioFormat") return { audioFormat: value };
    if (key === "audioSpeed") return { audioSpeed: value };
    return { audioInstructions: value };
}
