import { Button, Modal } from "antd";
import { useTranslation } from "react-i18next";

import { AgentConfirmDialog } from "@/components/canvas/agent-confirm-dialog";
import { AssetPickerModal, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { CanvasGenerationHistoryModal } from "@/components/canvas/canvas-generation-history-modal";
import { CanvasNodeAngleDialog, type CanvasImageAngleParams } from "@/components/canvas/canvas-node-angle-dialog";
import { CanvasNodeCropDialog, type CanvasImageCropRect } from "@/components/canvas/canvas-node-crop-dialog";
import { CanvasNodeInfoModal } from "@/components/canvas/canvas-node-hover-toolbar";
import { CanvasNodeMaskEditDialog, type CanvasImageMaskEditPayload } from "@/components/canvas/canvas-node-mask-edit-dialog";
import { CanvasNodePresetDialog } from "@/components/canvas/canvas-node-preset-dialog";
import { CanvasNodeSplitDialog, type CanvasImageSplitParams } from "@/components/canvas/canvas-node-split-dialog";
import { CanvasNodeUpscaleDialog, type CanvasImageUpscaleParams } from "@/components/canvas/canvas-node-upscale-dialog";
import { CanvasPluginManagerModal } from "@/components/canvas/canvas-plugin-manager-modal";
import { CanvasVersionCompareModal } from "@/components/canvas/canvas-version-compare-modal";
import { type AgentPlanVerdict } from "@/lib/canvas/agent-permissions";
import { focusNodeElement, restoreCanvasFocus } from "@/lib/canvas/canvas-node-focus";
import { type ImagePresetId } from "@/lib/canvas/image-presets";
import { modelOptionLabel, type AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export type CanvasProjectModalsProps = {
    nodes: CanvasNodeData[];
    infoNode: CanvasNodeData | null;
    onCloseInfo: () => void;
    pluginManagerOpen: boolean;
    onClosePluginManager: () => void;
    cropNode: CanvasNodeData | null;
    onCloseCrop: () => void;
    onConfirmCrop: (node: CanvasNodeData, crop: CanvasImageCropRect) => void;
    maskEditNode: CanvasNodeData | null;
    onCloseMaskEdit: () => void;
    onConfirmMaskEdit: (node: CanvasNodeData, payload: CanvasImageMaskEditPayload) => void;
    splitNode: CanvasNodeData | null;
    onCloseSplit: () => void;
    onConfirmSplit: (node: CanvasNodeData, params: CanvasImageSplitParams) => void;
    upscaleNode: CanvasNodeData | null;
    onCloseUpscale: () => void;
    onConfirmUpscale: (node: CanvasNodeData, params: CanvasImageUpscaleParams) => void;
    superResolveNode: CanvasNodeData | null;
    superResolveConfig: AiConfig | null;
    superResolveCost: { currency: string; amount: string | number } | null;
    onCloseSuperResolve: () => void;
    onConfirmSuperResolve: (node: CanvasNodeData) => void;
    angleNode: CanvasNodeData | null;
    onCloseAngle: () => void;
    onConfirmAngle: (node: CanvasNodeData, params: CanvasImageAngleParams) => void;
    pendingAgentPlan: { plan: AgentPlanVerdict; proceed: () => void } | null;
    pendingAgentCost: string | null;
    onCancelAgentPlan: () => void;
    onConfirmAgentPlan: () => void;
    presetNode: CanvasNodeData | null;
    onClosePreset: () => void;
    onConfirmPreset: (node: CanvasNodeData, id: ImagePresetId) => void;
    previewNode: CanvasNodeData | null;
    previewContent: string | undefined;
    onClosePreview: () => void;
    clearConfirmOpen: boolean;
    onCancelClear: () => void;
    onConfirmClear: () => void;
    assetPickerOpen: boolean;
    onInsertAssets: (payloads: InsertAssetPayload[]) => Promise<void>;
    onCloseAssetPicker: () => void;
    generationHistoryOpen: boolean;
    onCloseGenerationHistory: () => void;
    onFocusNode: (nodeId: string) => void;
    onViewNodeImage: (node: CanvasNodeData, imageId?: string) => void;
    onArchiveHistoryOutput: (node: CanvasNodeData, imageId?: string) => void;
    onInsertHistoryOutput: (node: CanvasNodeData, imageId?: string) => void;
    versionCompareRootId: string | null;
    versionCompareVersions: CanvasNodeData[];
    onCloseVersionCompare: () => void;
    onSetPrimaryMediaVersion: (nodeId: string) => void;
};

export function CanvasProjectModals(props: CanvasProjectModalsProps) {
    const { t } = useTranslation();
    const {
        nodes,
        infoNode,
        onCloseInfo,
        pluginManagerOpen,
        onClosePluginManager,
        cropNode,
        onCloseCrop,
        onConfirmCrop,
        maskEditNode,
        onCloseMaskEdit,
        onConfirmMaskEdit,
        splitNode,
        onCloseSplit,
        onConfirmSplit,
        upscaleNode,
        onCloseUpscale,
        onConfirmUpscale,
        superResolveNode,
        superResolveConfig,
        superResolveCost,
        onCloseSuperResolve,
        onConfirmSuperResolve,
        angleNode,
        onCloseAngle,
        onConfirmAngle,
        pendingAgentPlan,
        pendingAgentCost,
        onCancelAgentPlan,
        onConfirmAgentPlan,
        presetNode,
        onClosePreset,
        onConfirmPreset,
        previewNode,
        previewContent,
        onClosePreview,
        clearConfirmOpen,
        onCancelClear,
        onConfirmClear,
        assetPickerOpen,
        onInsertAssets,
        onCloseAssetPicker,
        generationHistoryOpen,
        onCloseGenerationHistory,
        onFocusNode,
        onViewNodeImage,
        onArchiveHistoryOutput,
        onInsertHistoryOutput,
        versionCompareRootId,
        versionCompareVersions,
        onCloseVersionCompare,
        onSetPrimaryMediaVersion,
    } = props;

    return (
        <>
            <CanvasNodeInfoModal node={infoNode} open={Boolean(infoNode)} onClose={onCloseInfo} />
            <CanvasPluginManagerModal open={pluginManagerOpen} onClose={onClosePluginManager} />

            {cropNode?.metadata?.content ? (
                <CanvasNodeCropDialog
                    dataUrl={cropNode.metadata.content}
                    open={Boolean(cropNode)}
                    onClose={() => {
                        onCloseCrop();
                        restoreCanvasFocus();
                    }}
                    onConfirm={(crop) => onConfirmCrop(cropNode, crop)}
                />
            ) : null}

            {maskEditNode?.metadata?.content ? (
                <CanvasNodeMaskEditDialog
                    dataUrl={maskEditNode.metadata.content}
                    open={Boolean(maskEditNode)}
                    onClose={() => {
                        onCloseMaskEdit();
                        restoreCanvasFocus();
                    }}
                    onConfirm={(payload) => onConfirmMaskEdit(maskEditNode, payload)}
                />
            ) : null}

            {splitNode?.metadata?.content ? (
                <CanvasNodeSplitDialog
                    dataUrl={splitNode.metadata.content}
                    open={Boolean(splitNode)}
                    onClose={() => {
                        onCloseSplit();
                        restoreCanvasFocus();
                    }}
                    onConfirm={(params) => onConfirmSplit(splitNode, params)}
                />
            ) : null}

            {upscaleNode?.metadata?.content ? (
                <CanvasNodeUpscaleDialog
                    dataUrl={upscaleNode.metadata.content}
                    open={Boolean(upscaleNode)}
                    onClose={() => {
                        onCloseUpscale();
                        restoreCanvasFocus();
                    }}
                    onConfirm={(params) => onConfirmUpscale(upscaleNode, params)}
                />
            ) : null}

            <Modal
                destroyOnHidden
                title={t("canvas.projectPage.superResolve")}
                open={Boolean(superResolveNode?.metadata?.content)}
                centered
                onCancel={onCloseSuperResolve}
                footer={
                    <div className="flex justify-end gap-2">
                        <Button onClick={onCloseSuperResolve}>{t("common.cancel")}</Button>
                        <Button
                            type="primary"
                            onClick={() => {
                                if (superResolveNode) onConfirmSuperResolve(superResolveNode);
                            }}
                        >
                            {t("canvas.projectPage.superResolveConfirmed")}
                        </Button>
                    </div>
                }
            >
                <div className="space-y-3 py-2">
                    <p>{t("canvas.projectPage.superResolveDescription")}</p>
                    <p className="text-sm opacity-65">
                        {t("canvas.projectPage.superResolveModel", {
                            model: superResolveConfig ? modelOptionLabel(superResolveConfig, superResolveConfig.model) : "",
                        })}
                    </p>
                    <p className="text-sm opacity-65">
                        {superResolveCost
                            ? t("canvas.projectPage.superResolveCost", { currency: superResolveCost.currency, amount: superResolveCost.amount })
                            : t("canvas.projectPage.superResolveCostUnknown")}
                    </p>
                </div>
            </Modal>

            {angleNode?.metadata?.content ? (
                <CanvasNodeAngleDialog
                    dataUrl={angleNode.metadata.content}
                    open={Boolean(angleNode)}
                    onClose={() => {
                        onCloseAngle();
                        restoreCanvasFocus();
                    }}
                    onConfirm={(params) => onConfirmAngle(angleNode, params)}
                />
            ) : null}

            <AgentConfirmDialog
                plan={pendingAgentPlan?.plan ?? null}
                open={Boolean(pendingAgentPlan)}
                costText={pendingAgentCost}
                onCancel={onCancelAgentPlan}
                onConfirm={onConfirmAgentPlan}
            />

            {presetNode?.metadata?.content ? (
                <CanvasNodePresetDialog
                    dataUrl={presetNode.metadata.content}
                    open={Boolean(presetNode)}
                    onClose={() => {
                        onClosePreset();
                        restoreCanvasFocus();
                    }}
                    onConfirm={(id) => onConfirmPreset(presetNode, id)}
                />
            ) : null}

            <Modal
                destroyOnHidden
                title={t("canvas.projectPage.imageDetails")}
                open={Boolean(previewContent)}
                centered
                onCancel={onClosePreview}
                footer={null}
                width="auto"
                styles={{ body: { padding: 0, display: "flex", justifyContent: "center", alignItems: "center", maxHeight: "80vh" } }}
            >
                {previewContent ? (
                    previewNode?.type === CanvasNodeType.Video ? (
                        <video src={previewContent} controls className="max-h-[80vh] max-w-full" />
                    ) : (
                        <img
                            src={previewContent}
                            alt={previewNode?.title || t("assets.kinds.image")}
                            style={{ maxWidth: "100%", maxHeight: "80vh", objectFit: "contain" }}
                        />
                    )
                ) : null}
            </Modal>

            <Modal
                destroyOnHidden
                title={t("canvas.projectPage.clearTitle")}
                open={clearConfirmOpen}
                centered
                onCancel={onCancelClear}
                footer={
                    <>
                        <Button onClick={onCancelClear}>{t("common.cancel")}</Button>
                        <Button danger type="primary" onClick={onConfirmClear}>
                            {t("canvas.projectPage.clear")}
                        </Button>
                    </>
                }
            >
                <p className="text-sm opacity-60">{t("canvas.projectPage.clearDescription")}</p>
            </Modal>

            <AssetPickerModal open={assetPickerOpen} onInsert={onInsertAssets} onClose={onCloseAssetPicker} />

            {/* 关闭即卸载：本环境 antd 离场动画会停在 ant-zoom-leave，视觉上关不掉 */}
            {generationHistoryOpen ? (
                <CanvasGenerationHistoryModal
                    nodes={nodes}
                    onClose={() => {
                        onCloseGenerationHistory();
                        restoreCanvasFocus();
                    }}
                    onLocate={(node) => {
                        onCloseGenerationHistory();
                        onFocusNode(node.id);
                        focusNodeElement(node.id);
                    }}
                    onPreview={(node, imageId) => {
                        onCloseGenerationHistory();
                        onViewNodeImage(node, imageId);
                    }}
                    onArchive={onArchiveHistoryOutput}
                    onInsert={onInsertHistoryOutput}
                />
            ) : null}

            {versionCompareRootId ? (
                <CanvasVersionCompareModal
                    open
                    versions={versionCompareVersions}
                    onClose={() => {
                        onCloseVersionCompare();
                        restoreCanvasFocus();
                    }}
                    onSetPrimary={onSetPrimaryMediaVersion}
                    onFocus={(nodeId) => {
                        onCloseVersionCompare();
                        onFocusNode(nodeId);
                        focusNodeElement(nodeId);
                    }}
                />
            ) : null}
        </>
    );
}
