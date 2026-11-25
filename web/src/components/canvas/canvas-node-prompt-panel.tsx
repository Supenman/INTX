import { useEffect, useState } from "react";
import { ArrowUp, LoaderCircle, Maximize2, RefreshCw, Square } from "lucide-react";
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

    // 有上游素材时可只凭输入生成，保留原生成配置节点「无需提示词」的能力；
    // 文本模式与音频模式必须有提示词或上游文本，和 handleGenerateNode 的校验保持一致。
    const hasUpstreamText = connectedNodes.some((item) => item.type === CanvasNodeType.Text && Boolean(item.metadata?.content?.trim()));
    const workflow = modelWorkflowOf(config, config.model); // 四类节点都可能挂工作流：只按模型判定，否则文本/音频节点永远拿不到必填与参考输入提示
    const frameRoles = new Map<number, "firstFrame" | "lastFrame">();
    if (mode === "video") for (const field of workflow?.fields ?? []) {
        if (field.frameRole && field.media === "image") frameRoles.set(field.imageIndex ?? 0, field.frameRole);
    }
    const requiredMedia = workflow?.fields.filter((field) => field.media && (field.required || (field.array && (field.min ?? 0) > 0))) ?? [];
    const context = requiredMedia.length ? buildNodeGenerationContext(node.id, nodes, connections, "") : undefined;
    const imageIds = new Set(context?.referenceImages.map((image) => image.id));
    if (mode === "image" && hasImageContent && globalConfig.nodeRegenerateBehavior !== "overwrite" && (!workflow || !imageIds.size)) imageIds.add(node.id);
    const inputStatus = requiredMedia.map((field) => {
        const actual = field.media === "image" ? imageIds.size : mode === "video" ? (field.media === "video" ? context?.videoCount : context?.audioCount) ?? 0 : 0;
        const needed = field.array ? Math.max(field.min ?? 0, field.required ? 1 : 0) : (field.media === "video" ? field.videoIndex ?? 0 : field.imageIndex ?? 0) + 1;
        const kind = field.media === "video" || field.media === "audio" ? field.media : "image";
        return { actual, needed, kind, id: field.key };
    });
    const missingMedia = inputStatus.some(({ actual, needed }) => actual < needed);
    const missingFields = missingWorkflowFields(workflow, config.workflowValues?.[config.model]); // 缺项不拦按钮，点了才提示，和「没填就提交只会得到网关报错」对上
    const canSubmit = !selectingReferences && !retryBlocked && !canQuery && !waiting && !missingMedia && (Boolean(prompt.trim()) || (mode === "image" || mode === "video" ? connectedNodes.length > 0 || (Boolean(workflow) && imageIds.size > 0) : hasUpstreamText));
    const actionLabel = t(isRunning ? "canvas.promptPanel.stopGeneration" : waiting ? "canvas.node.generating" : canQuery ? "canvas.nodeToolbar.queryVideoTask" : "canvas.promptPanel.generate");
    const submit = () => {
        if (!canSubmit) return;
        if (missingFields.length) return void message.warning(t("settingsPanels.workflow.requiredField", { field: missingFields.map((key) => t(`settingsPanels.workflow.fieldLabels.${key}`, { defaultValue: key })).join("、") }));
        onGenerate(node.id, mode, prompt.trim());
    };

    const openExpandedEditor = () => {
        setExpanded(true);
    };

    return (
        <div
            data-canvas-no-zoom
            data-canvas-prompt-panel
            className="rounded-[var(--r-lg)] border p-3.5 shadow-[var(--shadow-lg)] backdrop-blur"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <CanvasNodeReferenceBar
                nodeId={node.id}
                nodes={nodes}
                connectedNodes={connectedNodes}
                actions={(
                    <Tooltip title={t("canvas.promptPanel.expandEditor")}>
                        <Button type="text" className="!h-7 !w-7 !min-w-7 !p-0" style={{ color: theme.node.text }} icon={<Maximize2 className="size-3.5" />} onClick={openExpandedEditor} aria-label={t("canvas.promptPanel.expandEditor")} />
                    </Tooltip>
                )}
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
                        {/* 摘要 chip 用填充底而非描边：描边看起来像告警，而这里多数情况是"够用"的正常状态。 */}
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
            {/* 输入区独立成块：BeefTV 的 composer 用一块填充底把「写提示词」和「调参数」分开，
                这里沿用同样层次，让用户一眼看出哪块是输入、哪块是设置。 */}
            <div className="rounded-[var(--r-md)]" style={{ background: theme.toolbar.activeBg }}>
                <CanvasPromptChipInput
                    value={prompt}
                    references={mentionReferences}
                    onChange={updatePrompt}
                    onSubmit={submit}
                    className="thin-scrollbar h-[var(--intx-panel-composer,10rem)] w-full cursor-text resize-none rounded-[var(--r-md)] px-3 py-2.5 text-[length:var(--fs-body)] leading-6 outline-none"
                    style={{ background: "transparent", color: theme.node.text }}
                    placeholder={t(`canvas.promptPanel.${mode === "image" && hasImageContent ? "editImage" : mode === "text" && hasTextContent ? "editText" : mode}`)}
                />
            </div>

            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
                <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability={mode} onMissingConfig={() => openConfigDialog(true)} className="min-w-0 max-w-[240px] grow basis-32" />
                <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5">
                    <div className="min-w-0">
                        {mode === "image" ? (
                            modelWorkflowOf(config, config.model) ? <CanvasWorkflowSettings config={config} onChange={(workflowValues) => onConfigChange(node.id, { workflowValues })} onOpenChange={onSettingsOpenChange} /> : <CanvasImageSettingsPopover
                                config={config}
                                placement="topLeft"
                                buttonClassName="!h-[var(--control-h-sm)] !max-w-[170px] !justify-start !rounded-[var(--r-md)] !px-2.5"
                                onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })}
                                onMissingConfig={() => openConfigDialog(true)}
                                onOpenChange={onSettingsOpenChange}
                            />
                        ) : mode === "video" ? (
                            modelWorkflowOf(config, config.model) ? <CanvasWorkflowSettings config={config} onChange={(workflowValues) => onConfigChange(node.id, { workflowValues })} onOpenChange={onSettingsOpenChange} /> : <CanvasVideoSettingsPopover config={config} buttonClassName="!h-[var(--control-h-sm)] !max-w-[220px] !justify-start !rounded-[var(--r-md)] !px-2.5" onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))} onOpenChange={onSettingsOpenChange} />
                        ) : mode === "audio" ? (
                            <CanvasAudioSettingsPopover config={config} buttonClassName="!h-[var(--control-h-sm)] !max-w-[170px] !justify-start !rounded-[var(--r-md)] !px-2.5" onConfigChange={(key, value) => onConfigChange(node.id, audioConfigPatch(key, value))} onOpenChange={onSettingsOpenChange} />
                        ) : (
                            <CanvasTextSettingsPopover config={config} count={node.metadata?.textCount || 1} onConfigChange={(_, value) => onConfigChange(node.id, { reasoningEffort: value })} onCountChange={(textCount) => onConfigChange(node.id, { textCount })} onOpenChange={onSettingsOpenChange} />
                        )}
                    </div>
                    <Button
                        type="primary"
                        className="!h-[var(--control-h-sm)] !min-w-16 ml-auto shrink-0 !rounded-[var(--r-md)] !px-3"
                        danger={isRunning}
                        disabled={!isRunning && (waiting || (canQuery ? selectingReferences : !canSubmit))}
                        onClick={() => (isRunning ? onStop(node.id) : canQuery ? onQueryTask(node) : submit())}
                        aria-label={actionLabel}
                    >
                        <span className="flex items-center gap-1.5">
                            {isRunning ? (
                                <>
                                    <LoaderCircle aria-hidden className="size-4 motion-safe:animate-spin" />
                                    <Square className="size-3.5 fill-current" />
                                    <span className="text-[length:var(--fs-caption)] font-medium">{t("canvas.promptPanel.stop")}</span>
                                </>
                            ) : waiting ? (
                                <>
                                    <LoaderCircle aria-hidden className="size-4 motion-safe:animate-spin" />
                                    <span className="text-[length:var(--fs-caption)]">{t("canvas.node.generating")}</span>
                                </>
                            ) : (
                                <>
                                    {canQuery ? <RefreshCw className="size-4" /> : <ArrowUp className="size-4" />}
                                    <span className="text-[length:var(--fs-caption)]">{actionLabel}</span>
                                </>
                            )}
                        </span>
                    </Button>
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
                    <CanvasNodeReferenceBar nodeId={node.id} nodes={nodes} connectedNodes={connectedNodes} onDisconnect={onDisconnectReference} onMove={onMoveReference} onReplace={onReplaceReference} videoFrames={mode === "video" && !workflow && config.videoMode !== "reference"} frameRoles={frameRoles} onStartSelection={(nodeId) => { setExpanded(false); onStartReferenceSelection?.(nodeId); }} />
                    <CanvasPromptChipInput
                        value={prompt}
                        references={mentionReferences}
                        onChange={updatePrompt}
                        className="thin-scrollbar h-[52dvh] min-h-80 w-full cursor-text overflow-y-auto rounded-xl border p-4 text-[15px] leading-6 outline-none"
                        style={{ background: "transparent", borderColor: theme.toolbar.border, color: theme.node.text }}
                        placeholder={t(`canvas.promptPanel.${mode === "image" && hasImageContent ? "editImage" : mode === "text" && hasTextContent ? "editText" : mode}`)}
                    />
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
