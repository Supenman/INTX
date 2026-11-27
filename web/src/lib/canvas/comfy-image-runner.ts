import { nanoid } from "nanoid";

import { isLocalComfyImageWorkflow, requestSingleImage, submitComfyImageTask, waitForComfyImageTask } from "@/services/api/image";
import { uploadImage, type UploadedImage } from "@/services/image-storage";
import type { AiConfig } from "@/stores/use-config-store";
import type { CanvasNodeImage, CanvasNodeMetadata } from "@/types/canvas";
import type { ReferenceImage } from "@/types/image";

const NODE_STATUS_SUCCESS = "success";

export type NodeImageGenerationResult = {
    first: UploadedImage;
    images?: CanvasNodeImage[];
    metadataPatch: Partial<CanvasNodeMetadata>;
};

/**
 * 统一单图与本地 ComfyUI 异步多图生成入口：
 * - 本地 ComfyUI 工作流：走异步提交 + 轮询 + 收集全部输出图，并支持通过 onTaskId 持久化以便重启恢复；
 * - 云端渠道：保持原有单图请求与落盘行为。
 */
export async function generateNodeImages(
    config: AiConfig,
    prompt: string,
    references: ReferenceImage[],
    signal: AbortSignal,
    onTaskId?: (taskId: string) => Promise<void> | void,
): Promise<NodeImageGenerationResult> {
    if (isLocalComfyImageWorkflow(config)) {
        const taskId = nanoid();
        await onTaskId?.(taskId);
        signal.throwIfAborted();
        await submitComfyImageTask(config, taskId, prompt, references, signal);
        const outputs = await waitForComfyImageTask(config, taskId, signal);
        const images: CanvasNodeImage[] = [];
        let firstUploaded: UploadedImage | null = null;
        for (const output of outputs) {
            const uploaded = await uploadImage(output.blob, { signal });
            if (!firstUploaded) firstUploaded = uploaded;
            images.push({
                id: nanoid(),
                outputNodeId: output.nodeId,
                status: NODE_STATUS_SUCCESS,
                content: uploaded.url,
                storageKey: uploaded.storageKey,
                naturalWidth: uploaded.width,
                naturalHeight: uploaded.height,
                bytes: uploaded.bytes,
                mimeType: uploaded.mimeType,
            });
        }
        signal.throwIfAborted();
        if (!firstUploaded || !images.length) throw new Error("ComfyUI 未返回可用图片");
        const [firstItem] = images;
        return {
            first: firstUploaded,
            images,
            metadataPatch: {
                imageTaskId: undefined,
                retryBlocked: undefined,
                errorDetails: undefined,
                status: NODE_STATUS_SUCCESS,
                content: firstItem.content,
                storageKey: firstItem.storageKey,
                naturalWidth: firstItem.naturalWidth,
                naturalHeight: firstItem.naturalHeight,
                bytes: firstItem.bytes,
                mimeType: firstItem.mimeType,
                count: images.length,
                images,
                primaryImageId: firstItem.id,
            },
        };
    }

    const image = await requestSingleImage(config, prompt, references, { signal });
    const uploaded = await uploadImage(image.dataUrl, { signal });
    return {
        first: uploaded,
        metadataPatch: {
            status: NODE_STATUS_SUCCESS,
            errorDetails: undefined,
            content: uploaded.url,
            storageKey: uploaded.storageKey,
            naturalWidth: uploaded.width,
            naturalHeight: uploaded.height,
            bytes: uploaded.bytes,
            mimeType: uploaded.mimeType,
        },
    };
}
