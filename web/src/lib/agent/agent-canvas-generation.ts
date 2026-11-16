import { nanoid } from "nanoid";

import { imageMetadata, videoMetadata } from "@/lib/canvas/canvas-node-factory";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { CanvasNodeType, type CanvasNodeData, type Position } from "@/types/canvas";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { runImageSlots } from "@/services/generation";
import { requestSingleImage } from "@/services/api/image";
import { createVideoGenerationTask, storeGeneratedVideo, waitForVideoGenerationTask } from "@/services/api/video";
import { uploadImage } from "@/services/image-storage";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { useConfigStore } from "@/stores/use-config-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import i18n from "@/i18n";

/**
 * Agent 的画布生成：把「生成图片 / 生成视频」直接落到画布项目，而不是跳转独立工作台。
 *
 * 状态字符串沿用画布节点既有约定（loading / success / error，见 canvas/project.tsx）。
 * 生成本身走任务层（requestSingleImage / createVideoGenerationTask 都已落台账），
 * 这里只负责选项目、建节点、把产物写回节点。
 */

const NODE_STATUS_LOADING = "loading" as const;
const NODE_STATUS_SUCCESS = "success" as const;
const NODE_STATUS_ERROR = "error" as const;
const VIDEO_NODE_MAX_WIDTH = 420;
const VIDEO_NODE_MAX_HEIGHT = 420;
const IMAGE_NODE_MAX = 640;

export const AGENT_CANVAS_NODE_PREFIX = ["image", "video"] as const;

function siteText(key: string, options?: Record<string, unknown>) {
    return i18n.t(`agent.siteTools.${key}`, options);
}

export async function ensureCanvasReady(): Promise<void> {
    const store = useCanvasStore.getState();
    if (!store.hydrated) await store.load();
    if (!useAssetStore.getState().hydrated) await useAssetStore.getState().load();
}

/** 目标项目：最近更新的那个；没有就新建。 */
function targetProject(): CanvasProject {
    const { projects, createProject } = useCanvasStore.getState();
    if (projects.length === 0) {
        const id = createProject();
        const created = useCanvasStore.getState().projects.find((project) => project.id === id);
        if (!created) throw new Error(siteText("canvasLoading"));
        return created;
    }
    return [...projects].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))[0];
}

function placement(nodes: readonly CanvasNodeData[], width: number, height: number, index: number): Position {
    const maxRight = nodes.length ? Math.max(...nodes.map((node) => node.position.x + node.width)) : 0;
    const top = nodes.length ? Math.min(...nodes.map((node) => node.position.y)) : 0;
    return { x: maxRight + 120 + index * (width + 80), y: top };
}

/** 追加节点并按画布事务落盘；返回最新节点数。 */
async function appendNodes(projectId: string, nodes: CanvasNodeData[]): Promise<void> {
    if (nodes.length === 0) return;
    const current = useCanvasStore.getState().projects.find((project) => project.id === projectId);
    const existing = current?.nodes ?? [];
    useCanvasStore.getState().updateProject(projectId, { nodes: [...existing, ...nodes] });
    await useCanvasStore.getState().flush().catch(() => undefined);
}

function patchNode(projectId: string, nodeId: string, patch: (node: CanvasNodeData) => CanvasNodeData): void {
    const current = useCanvasStore.getState().projects.find((project) => project.id === projectId);
    if (!current) return;
    useCanvasStore.getState().updateProject(projectId, {
        nodes: current.nodes.map((node) => (node.id === nodeId ? patch(node) : node)),
    });
    void useCanvasStore.getState().flush().catch(() => undefined);
}

function requireImageConfig() {
    const state = useConfigStore.getState();
    const model = state.config.imageModel || state.config.model;
    if (!state.isAiConfigReady(state.config, model)) throw new Error(siteText("configNotReady"));
    return { config: state.config, model };
}

function requireVideoConfig() {
    const state = useConfigStore.getState();
    const model = state.config.videoModel || state.config.model;
    if (!state.isAiConfigReady(state.config, model)) throw new Error(siteText("configNotReady"));
    return { config: state.config, model };
}

export interface AgentCanvasLaunch {
    projectId: string;
    taskId: string;
}

/** 发起图片生成：每个槽位一张，独立成功/失败；结果直接建图片节点。 */
export async function launchAgentImageGeneration(input: { prompt: string; count?: number }): Promise<AgentCanvasLaunch> {
    await ensureCanvasReady();
    const { config, model } = requireImageConfig();
    const count = Math.max(1, Math.min(15, Math.floor(Number(input.count ?? config.count) || 1)));
    const project = targetProject();
    const trackerId = useWorkbenchAgentStore.getState().track("image", input.prompt);
    useWorkbenchAgentStore.getState().updateTask(trackerId, { status: "running", projectId: project.id });

    void (async () => {
        try {
            const outcomes = await runImageSlots({
                count,
                submit: () => requestSingleImage({ ...config, count: "1" }, input.prompt),
            });
            const images = outcomes.filter((item): item is Extract<typeof item, { ok: true }> => item.ok).map((item) => item.image);
            const firstError = outcomes.find((item) => !item.ok);
            if (images.length === 0) {
                throw firstError && !firstError.ok ? firstError.error : new Error(siteText("generationFailed"));
            }

            const assetState = useAssetStore.getState();
            const nodes: CanvasNodeData[] = [];
            const latest = useCanvasStore.getState().projects.find((item) => item.id === project.id)?.nodes ?? [];
            for (const [index, image] of images.entries()) {
                const stored = await uploadImage(image.dataUrl);
                const size = fitNodeSize(stored.width, stored.height, IMAGE_NODE_MAX, IMAGE_NODE_MAX);
                assetState.addAsset({
                    kind: "image",
                    title: input.prompt.slice(0, 32) || siteText("generatedImageTitle"),
                    coverUrl: stored.url,
                    tags: [],
                    source: "Agent",
                    data: { dataUrl: stored.storageKey ? "" : stored.url, storageKey: stored.storageKey, width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType },
                    metadata: { source: "agent-generation", model },
                });
                nodes.push({
                    id: `image-${nanoid(8)}`,
                    type: CanvasNodeType.Image,
                    title: input.prompt.slice(0, 32) || siteText("generatedImageTitle"),
                    position: placement(latest, size.width, size.height, index),
                    width: size.width,
                    height: size.height,
                    metadata: { ...imageMetadata(stored), prompt: input.prompt, model },
                });
            }
            await assetState.confirmSave();
            await appendNodes(project.id, nodes);
            useWorkbenchAgentStore.getState().updateTask(trackerId, {
                status: "succeeded",
                successCount: nodes.length,
                failCount: count - nodes.length,
                ...(firstError && !firstError.ok ? { error: firstError.error instanceof Error ? firstError.error.message : String(firstError.error) } : {}),
            });
        } catch (error) {
            useWorkbenchAgentStore.getState().updateTask(trackerId, { status: "failed", error: error instanceof Error ? error.message : String(error) });
        }
    })();

    return { projectId: project.id, taskId: trackerId };
}

/** 发起视频生成：先落一张 loading 节点，产物回来后写回同一节点。 */
export async function launchAgentVideoGeneration(input: { prompt: string }): Promise<AgentCanvasLaunch> {
    await ensureCanvasReady();
    const { config, model } = requireVideoConfig();
    const project = targetProject();
    const latest = useCanvasStore.getState().projects.find((item) => item.id === project.id)?.nodes ?? [];
    const size = fitNodeSize(VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
    const nodeId = `video-${nanoid(8)}`;
    const node: CanvasNodeData = {
        id: nodeId,
        type: CanvasNodeType.Video,
        title: input.prompt.slice(0, 32) || siteText("generatedVideoTitle"),
        position: placement(latest, size.width, size.height, 0),
        width: size.width,
        height: size.height,
        metadata: {
            status: NODE_STATUS_LOADING,
            prompt: input.prompt,
            model,
            size: config.size,
            seconds: config.videoSeconds,
            vquality: config.vquality,
            generateAudio: config.videoGenerateAudio,
            watermark: config.videoWatermark,
            videoMode: config.videoMode,
        },
    };
    await appendNodes(project.id, [node]);

    const trackerId = useWorkbenchAgentStore.getState().track("video", input.prompt);
    useWorkbenchAgentStore.getState().updateTask(trackerId, { status: "running", projectId: project.id, nodeId });

    void (async () => {
        try {
            const task = await createVideoGenerationTask(config, input.prompt, []);
            patchNode(project.id, nodeId, (item) => ({ ...item, metadata: { ...item.metadata, videoTaskId: task.id, videoTaskProvider: task.provider === "gemini" ? "gemini" : "openai" } }));
            const video = await storeGeneratedVideo(await waitForVideoGenerationTask(config, task));
            const assetState = useAssetStore.getState();
            assetState.addAsset({
                kind: "video",
                title: input.prompt.slice(0, 32) || siteText("generatedVideoTitle"),
                coverUrl: "",
                tags: [],
                source: "Agent",
                data: { url: video.url, storageKey: video.storageKey, width: video.width || 0, height: video.height || 0, bytes: video.bytes, mimeType: video.mimeType },
                metadata: { source: "agent-generation", model },
            });
            await assetState.confirmSave();
            patchNode(project.id, nodeId, (item) => {
                const nextSize = fitNodeSize(video.width || item.width, video.height || item.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                return {
                    ...item,
                    width: nextSize.width,
                    height: nextSize.height,
                    position: { x: item.position.x + item.width / 2 - nextSize.width / 2, y: item.position.y + item.height / 2 - nextSize.height / 2 },
                    metadata: { ...item.metadata, ...videoMetadata(video), status: NODE_STATUS_SUCCESS, prompt: input.prompt, model },
                };
            });
            useWorkbenchAgentStore.getState().updateTask(trackerId, { status: "succeeded", successCount: 1, failCount: 0 });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            patchNode(project.id, nodeId, (item) => ({ ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails: message } }));
            useWorkbenchAgentStore.getState().updateTask(trackerId, { status: "failed", error: message });
        }
    })();

    return { projectId: project.id, taskId: trackerId };
}
