import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { comfyWorkflowRequest } from "@/lib/comfy-workflow";
import { isLocalGatewayUrl, readLocalBlob } from "@/lib/media-blob";
import { dataUrlToFile, readFileAsDataUrl } from "@/lib/image-utils";
import { clampVideoSeconds, computeVideoSize, inferVideoRatio } from "@/lib/media-size";
import { getMediaBlob, resolveMediaUrl, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { imageToDataUrl } from "@/services/image-storage";
import { isRunningHubEndpoint, RUNNINGHUB_ORIGIN, RUNNINGHUB_VIDU_MODEL } from "@/domain/provider/endpoints";
import { boolConfig, buildApiUrl, modelOptionName, resolveModelRequestConfig, resolveModelScript, type AiConfig } from "@/stores/use-config-store";
import { runModelPlugin } from "./model-plugin";
import { readApiErrorMessage } from "./provider-errors";
import { assertProviderOk, createProviderTransport, ProviderHttpError, ProviderTransportError, type ProviderResponse } from "./provider-transport";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import {
    browserTaskLog,
    noteVideoPoll,
    resumableVideoTasks,
    submitVideoTask,
    type VideoTaskHandle,
    type VideoPollState,
} from "@/services/generation";

type VideoResponse = { id: string; status?: string; error?: { message?: string }; url?: string; result_url?: string; video_url?: string; content?: { video_url?: string; url?: string } | null };
type ApiVideoResponse = VideoResponse | { code?: number | string; data?: VideoResponse | null; msg?: string; message?: string; error?: { message?: string } };
type ApiEnvelope<T> = T | { code?: number | string; data?: T | null; msg?: string; message?: string; error?: { message?: string } };
type RequestOptions = { signal?: AbortSignal };
type VideoMediaOptions = RequestOptions & { videos?: ReferenceVideo[]; audios?: ReferenceAudio[] };
const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);

export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string };
export type VideoGenerationTask = VideoTaskHandle;
type RunningHubVideo = { taskId?: string; status?: string; errorCode?: string; errorMessage?: string; failedReason?: string; results?: { url?: string; outputType?: string }[] | null };
type GeminiInlineData = { bytesBase64Encoded: string; mimeType: string };
type GeminiVideoOperation = {
    name?: string;
    done?: boolean;
    error?: { message?: string };
    response?: { generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: string } }> } };
};
export type VideoGenerationTaskState = { status: "pending" } | { status: "completed"; result: VideoGenerationResult } | { status: "failed"; error: string };

/** Results for scripted (plugin) video models, which run their own create+poll in one shot at task creation. */
const pluginVideoResults = new Map<string, VideoGenerationResult>();

/** 完整厂商地址；本地代理前缀由 ProviderTransport 按出网方式加，这里不加。 */
function aiApiUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, path, "direct");
}

/** 非 2xx 直接抛；正文里的厂商错误优先，和原来 axios 抛错的语义一致。 */
async function readPayload<T>(response: ProviderResponse, fallback: string): Promise<T> {
    await assertProviderOk(response, (text) => readApiErrorMessage(text) || statusMessage(response.status, fallback));
    return (await response.json()) as T;
}

function aiHeaders(config: AiConfig, contentType?: string) {
    return {
        Authorization: `Bearer ${config.apiKey}`,
        ...(contentType ? { "Content-Type": contentType } : {}),
    };
}

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], options?: VideoMediaOptions): Promise<VideoGenerationResult> {
    return waitForVideoGenerationTask(config, await createVideoGenerationTask(config, prompt, references, options), options);
}

export async function waitForVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationResult> {
    // 按 upstreamRef 找回提交时落的那条任务；查单结论同步写回台账。
    // 轮询被中断/超时时任务保持 running + upstreamRef，绝不标 canceled
    // （上游可能还在跑、钱已付，标 canceled 会诱导用户再提交一张）。
    let tracked = await browserTaskLog.findByUpstreamRef(task.id);
    for (let attempt = 0; attempt < 120; attempt += 1) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const state = await pollVideoGenerationTask(config, task, options);
        if (tracked) {
            const poll: VideoPollState = state.status === "completed"
                ? { status: "completed" }
                : state.status === "failed"
                    ? { status: "failed", error: state.error }
                    : { status: "pending" };
            tracked = await browserTaskLog.get(tracked.id);
            if (tracked) tracked = await noteVideoPoll(poll, tracked, browserTaskLog);
        }
        if (state.status === "completed") return state.result;
        if (state.status === "failed") throw videoTaskFailed(state.error);
        if (attempt === 119) break;
        await delay(2500, options?.signal);
    }
    throw new Error(apiText("videoTimeout"));
}

/** 重启后可恢复的已收单视频任务（含可重建的查单句柄与三态结论）。 */
export function recoverableVideoTasks() {
    return resumableVideoTasks(browserTaskLog);
}

export function isVideoTaskFailed(error: unknown) {
    return error instanceof Error && error.name === "VideoTaskFailed";
}

function videoTaskFailed(message: string) {
    const error = new Error(message);
    error.name = "VideoTaskFailed";
    return error;
}

/**
 * 任务层薄壳：POST 一收单就把 upstreamRef 落台账，刷新页面后可凭任务号续查，
 * 不再像原来那样只靠内存里的 120×2.5s 循环、重启即丢（上游还在跑、钱已付）。
 */
export async function createVideoGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const model = (config.model || config.videoModel).trim();
    const requestConfig = resolveModelRequestConfig(config, model);
    const runningHub = requestConfig.apiFormat === "runninghub"
        || (modelOptionName(model) === RUNNINGHUB_VIDU_MODEL && isRunningHubEndpoint(requestConfig.baseUrl));
    if (runningHub && modelOptionName(model) !== RUNNINGHUB_VIDU_MODEL) throw new Error(apiText("runningHubVideoModel"));
    const imageUrl = runningHub ? await prepareRunningHubImage(requestConfig, references, options) : undefined;
    const { handle } = await submitVideoTask({
        config,
        prompt,
        signal: options?.signal,
        transport: {
            submit: () => imageUrl
                ? createRunningHubVideoTask(requestConfig, model, prompt, imageUrl, options)
                : createVideoGenerationTaskRaw(config, prompt, references, options),
        },
    });
    return handle;
}

async function createVideoGenerationTaskRaw(config: AiConfig, prompt: string, references: ReferenceImage[] = [], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const selectedModel = (config.model || config.videoModel).trim();
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    const script = resolveModelScript(config, selectedModel);
    if (script) return createPluginVideoTask(requestConfig, selectedModel, script, prompt, references, options);
    assertVideoConfig(requestConfig, requestConfig.model);
    if (requestConfig.apiFormat === "gemini") return createGeminiVideoTask(requestConfig, selectedModel, prompt, references, options);
    return createOpenAIVideoTask(requestConfig, selectedModel, prompt, references, options);
}

export async function pollVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    if (task.provider === "plugin") {
        const result = pluginVideoResults.get(task.id);
        return result ? { status: "completed", result } : { status: "failed", error: apiText("pluginVideoExpired") };
    }
    const requestConfig = resolveModelRequestConfig(config, task.model);
    assertVideoConfig(requestConfig, requestConfig.model);
    if (task.provider === "runninghub") return pollRunningHubVideoTask(requestConfig, task.id, options);
    if (task.provider === "gemini") return pollGeminiVideoTask(requestConfig, task, options);
    return pollOpenAIVideoTask(requestConfig, task, options);
}

async function prepareRunningHubImage(config: AiConfig, references: ReferenceImage[], options?: VideoMediaOptions): Promise<string> {
    assertVideoConfig(config, config.model);
    if (!isRunningHubEndpoint(config.baseUrl)) throw new Error(apiText("runningHubChannel"));
    if (references.length !== 1 || options?.videos?.length || options?.audios?.length) {
        throw new Error(apiText("runningHubSingleImage"));
    }
    const image = references[0];
    const file = dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image, options) });
    const body = new FormData();
    body.append("file", file);
    const response = await createProviderTransport(config.proxyMode).request({
        method: "POST",
        url: `${RUNNINGHUB_ORIGIN}/openapi/v2/media/upload/binary`,
        headers: aiHeaders(config),
        body,
        signal: options?.signal,
    });
    const upload = await readPayload<{ code?: number | string; data?: { download_url?: string }; message?: string; msg?: string }>(response, apiText("runningHubUpload"));
    const url = upload.data?.download_url;
    if ((upload.code != null && String(upload.code) !== "0") || !url || !/^https?:\/\//i.test(url)) {
        throw new Error(`${apiText("runningHubUpload")}: ${readApiErrorMessage(upload) || apiText("referenceImageReadFailed")}`);
    }
    return url;
}

async function runningHubVideoRequest(config: AiConfig, endpoint: string, body: object, fallback: string, options?: RequestOptions) {
    if (!isRunningHubEndpoint(config.baseUrl)) throw new Error(apiText("runningHubChannel"));
    const response = await createProviderTransport(config.proxyMode).request({
        method: "POST",
        url: `${RUNNINGHUB_ORIGIN}/openapi/v2/${endpoint}`,
        headers: aiHeaders(config, "application/json"),
        body: JSON.stringify(body),
        signal: options?.signal,
    });
    return readPayload<RunningHubVideo>(response, fallback);
}

async function createRunningHubVideoTask(config: AiConfig, model: string, prompt: string, imageUrl: string, options?: RequestOptions): Promise<VideoGenerationTask> {
    const result = await runningHubVideoRequest(config, RUNNINGHUB_VIDU_MODEL, {
        prompt,
        imageUrl,
        duration: normalizeVideoSeconds(config.videoSeconds),
        resolution: normalizeVideoResolution(config.vquality),
        movementAmplitude: "auto",
        bgm: false,
    }, apiText("videoTaskCreateFailed"), options);
    if (typeof result.taskId !== "string" || !result.taskId.trim()) throw new Error(runningHubError(result, apiText("noVideoTaskId")));
    return { id: result.taskId, provider: "runninghub", model };
}

async function pollRunningHubVideoTask(config: AiConfig, taskId: string, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    const result = await runningHubVideoRequest(config, "query", { taskId }, apiText("videoTaskQueryFailed"), options);
    if (result.status === "FAILED") return { status: "failed", error: runningHubError(result, apiText("videoGenerationFailed")) };
    if (result.status === "RUNNING" || result.status === "QUEUED") return { status: "pending" };
    if (result.status !== "SUCCESS") throw new Error(runningHubError(result, apiText("videoTaskQueryFailed")));
    const url = result.results?.find((item) => (!item.outputType || /^(?:mp4|mov|webm|video(?:\/.*)?)$/i.test(item.outputType))
        && /^https?:\/\//i.test(item.url ?? ""))?.url;
    if (!url) throw new Error(apiText("noPlayableVideo"));
    return { status: "completed", result: await videoResultFromUrl(url, config, options) };
}

function runningHubError(result: RunningHubVideo, fallback: string) {
    const message = result.errorMessage || result.failedReason || fallback;
    return result.errorCode ? `RunningHub ${result.errorCode}: ${message}` : message;
}

async function createPluginVideoTask(config: AiConfig, model: string, script: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    if (!config.baseUrl.trim()) throw new Error(apiText("baseUrlRequired"));
    if (!config.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
    const refs = await Promise.all(references.map((image) => imageToDataUrl(image)));
    const videos = await Promise.all((options?.videos || []).map((video) => referenceMediaToFile(video, "ref.mp4", "invalidReferenceVideo", options)));
    const audios = await Promise.all((options?.audios || []).map((audio) => referenceMediaToFile(audio, "ref.mp3", "invalidReferenceAudio", options)));
    const result = videoPluginResult(
        await runModelPlugin({
            capability: "video",
            script,
            config,
            prompt,
            images: refs,
            videos,
            audios,
            params: {
                seconds: normalizeVideoSeconds(config.videoSeconds),
                size: normalizeVideoSize(config.size, config.vquality),
                resolution: normalizeVideoResolution(config.vquality),
                ratio: videoAspectRatio(config.size),
                generateAudio: boolConfig(config.videoGenerateAudio, true),
                watermark: boolConfig(config.videoWatermark, false),
                mode: resolveVideoMode(config.videoMode, refs.length),
            },
            signal: options?.signal,
        }),
    );
    const id = nanoid();
    pluginVideoResults.set(id, result);
    return { id, provider: "plugin", model };
}

function videoPluginResult(result: unknown): VideoGenerationResult {
    if (result instanceof Blob) return { blob: result };
    if (typeof result === "string") return { url: result, mimeType: "video/mp4" };
    if (result && typeof result === "object") {
        const record = result as Record<string, unknown>;
        if (record.blob instanceof Blob) return { blob: record.blob };
        const url = [record.url, record.video_url, record.result_url].find((value) => typeof value === "string" && value) as string | undefined;
        if (url) return { url, mimeType: "video/mp4" };
    }
    throw new Error(apiText("scriptNoVideo"));
}

export async function storeGeneratedVideo(result: VideoGenerationResult): Promise<UploadedFile> {
    if (result.blob) {
        try {
            return await uploadMediaFile(result.blob, "video");
        } catch (error) {
            const reason = readRequestError(error, apiText("requestFailed"));
            throw new Error(`${apiText("videoSaveFailed")}（${reason}）`, { cause: error });
        }
    }
    if (result.url) {
        try {
            return await uploadMediaFile(result.url, "video");
        } catch (error) {
            // 第三方渠道允许退回直链（媒体元素直连不需要 CORS）；本地网关直链失败必须报错，
            // 否则会把一个 404 的地址写进节点，表现为黑屏且无法重试。
            if (isLocalGatewayUrl(result.url)) {
                throw new Error(`${apiText("videoDownloadFailed")}（${readRequestError(error, apiText("requestFailed"))}）`);
            }
            return { url: result.url, storageKey: "", bytes: 0, mimeType: result.mimeType || "video/mp4" };
        }
    }
    throw new Error(apiText("noPlayableVideo"));
}

async function createOpenAIVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const images = await Promise.all(references.map(async (image) => dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) })));
    const videos = await Promise.all((options?.videos || []).map((video) => referenceMediaToFile(video, "ref.mp4", "invalidReferenceVideo", options)));
    const audios = await Promise.all((options?.audios || []).map((audio) => referenceMediaToFile(audio, "ref.mp3", "invalidReferenceAudio", options)));
    const mode = resolveVideoMode(config.videoMode, images.length);
    const ratio = inferVideoRatio(config.size || "16:9");
    const body = new FormData();
    body.append("model", modelOptionName(model));
    body.append("prompt", prompt);
    body.append("seconds", normalizeVideoSeconds(config.videoSeconds));
    body.append("size", normalizeVideoSize(config.size, config.vquality) || "1280x720");
    if (ratio && ratio !== "auto") {
        body.append("ratio", ratio);
    }
    body.append("resolution_name", normalizeVideoResolution(config.vquality));
    body.append("generate_audio", String(boolConfig(config.videoGenerateAudio, true)));
    body.append("watermark", String(boolConfig(config.videoWatermark, false)));
    body.append("mode", mode);
    if (mode === "frames") {
        if (images[0]) {
            body.append("first_frame", images[0], "first.png");
            body.append("images", images[0], "first.png");
        }
        if (images[1]) {
            body.append("last_frame", images[1], "last.png");
            body.append("images", images[1], "last.png");
        }
    } else {
        images.forEach((file, idx) => {
            body.append("image[]", file, `ref_${idx + 1}.png`);
            body.append("images", file, `ref_${idx + 1}.png`);
        });
    }
    videos.forEach((file) => body.append("video[]", file));
    audios.forEach((file) => body.append("audio[]", file));
    const workflow = comfyWorkflowRequest(config, model);
    if (workflow) {
        for (const key of ["seconds", "size", "ratio", "resolution_name", "generate_audio", "watermark", "mode", "first_frame", "last_frame", "images", "image[]"]) body.delete(key);
        images.forEach((file, index) => body.append("image[]", file, `ref_${index + 1}.png`));
        body.set("workflow_values", JSON.stringify(workflow.workflow_values));
    }
    try {
        const response = await createProviderTransport(config.proxyMode).request({
            method: "POST",
            url: aiApiUrl(config, "/videos"),
            headers: aiHeaders(config),
            body,
            signal: options?.signal,
        });
        const created = unwrapVideoResponse(await readPayload<ApiVideoResponse>(response, apiText("videoTaskCreateFailed")));
        if (!created.id) throw new Error(apiText("noVideoTaskId"));
        return { id: created.id, provider: "openai", model };
    } catch (error) {
        throw new Error(readRequestError(error, apiText("videoTaskCreateFailed")));
    }
}

async function pollOpenAIVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const transport = createProviderTransport(config.proxyMode);
        const response = await transport.request({ method: "GET", url: aiApiUrl(config, `/videos/${task.id}`), headers: aiHeaders(config), signal: options?.signal });
        const video = unwrapVideoResponse(await readPayload<ApiVideoResponse>(response, apiText("videoTaskQueryFailed")));
        const url = videoResultUrl(video);
        if (url) return { status: "completed", result: await videoResultFromUrl(url, config, options) };
        if (video.status === "completed") {
            const blob = await transport.blob({ method: "GET", url: aiApiUrl(config, `/videos/${task.id}/content`), headers: aiHeaders(config), signal: options?.signal });
            await assertVideoBlob(blob);
            return { status: "completed", result: { blob } };
        }
        if (video.status === "failed" || video.status === "cancelled") return { status: "failed", error: readApiErrorMessage(video.error?.message) || apiText("videoGenerationFailed") };
        return { status: "pending" };
    } catch (error) {
        throw new Error(readRequestError(error, apiText("videoTaskQueryFailed")));
    }
}

async function videoResultFromUrl(url: string, config: Pick<AiConfig, "proxyMode">, options?: RequestOptions): Promise<VideoGenerationResult> {
    try {
        const blob = await createProviderTransport(config.proxyMode).blob({ method: "GET", url, signal: options?.signal });
        await assertVideoBlob(blob);
        // 404/错误页常以 HTML 返回；这类响应即使状态码 200 也不能当视频写进节点。
        if (/text\/html/i.test(blob.type)) throw new Error(apiText("videoDownloadFailed"));
        return { blob };
    } catch (error) {
        if ((error instanceof ProviderTransportError && error.kind === "aborted") || options?.signal?.aborted) throw error;
        // 本地网关的视频地址下载失败就是真失败：吞掉会把坏 URL 写进节点，变成黑屏且无从恢复。
        // 只有第三方渠道那种不能直接 GET 的结果 URL 才保留回退。
        if (isLocalGatewayUrl(url)) {
            throw new Error(`${apiText("videoDownloadFailed")}（${readRequestError(error, apiText("requestFailed"))}）`);
        }
        return { url, mimeType: "video/mp4" };
    }
}

async function createGeminiVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const images = await Promise.all(references.map((image) => imageToDataUrl(image)));
    const videos = await Promise.all((options?.videos || []).map((video) => referenceMediaToFile(video, "ref.mp4", "invalidReferenceVideo", options)));
    const audios = await Promise.all((options?.audios || []).map((audio) => referenceMediaToFile(audio, "ref.mp3", "invalidReferenceAudio", options)));
    const mode = resolveVideoMode(config.videoMode, images.length);
    const instance: Record<string, unknown> = { prompt };
    if (mode === "frames") {
        if (images[0]) instance.image = parseDataUrlInline(images[0]);
        if (images[1]) instance.lastFrame = parseDataUrlInline(images[1]);
    } else {
        instance.referenceImages = images.map((dataUrl) => ({ image: parseDataUrlInline(dataUrl), referenceType: "asset" }));
    }
    if (videos[0]) instance.video = await fileToGeminiInline(videos[0]);
    if (audios[0]) instance.audio = await fileToGeminiInline(audios[0]);
    try {
        const response = await createProviderTransport(config.proxyMode).request({
            method: "POST",
            url: geminiVideoUrl(config, model, "predictLongRunning"),
            headers: geminiVideoHeaders(config),
            body: JSON.stringify({
                instances: [instance],
                parameters: {
                    aspectRatio: videoAspectRatio(config.size),
                    durationSeconds: Number(normalizeVideoSeconds(config.videoSeconds)) || 8,
                    resolution: normalizeVideoResolution(config.vquality),
                    generateAudio: boolConfig(config.videoGenerateAudio, true),
                    addWatermark: boolConfig(config.videoWatermark, false),
                },
            }),
            signal: options?.signal,
        });
        const created = unwrapEnvelope(await readPayload<ApiEnvelope<GeminiVideoOperation>>(response, apiText("videoTaskCreateFailed")), apiText("noVideoTask"));
        if (!created.name) throw new Error(apiText("noVideoTaskId"));
        return { id: created.name, provider: "gemini", model };
    } catch (error) {
        throw new Error(readRequestError(error, apiText("videoTaskCreateFailed")));
    }
}

async function pollGeminiVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const response = await createProviderTransport(config.proxyMode).request({ method: "GET", url: geminiOperationUrl(config, task.id), headers: geminiVideoHeaders(config), signal: options?.signal });
        const state = unwrapEnvelope(await readPayload<ApiEnvelope<GeminiVideoOperation>>(response, apiText("videoTaskQueryFailed")), apiText("videoTaskQueryFailed"));
        if (state.error) return { status: "failed", error: readApiErrorMessage(state.error.message) || apiText("videoGenerationFailed") };
        if (!state.done) return { status: "pending" };
        const uri = state.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
        if (!uri) return { status: "failed", error: apiText("noPlayableVideo") };
        const url = uri.includes("key=") ? uri : `${uri}${uri.includes("?") ? "&" : "?"}key=${config.apiKey}`;
        return { status: "completed", result: await videoResultFromUrl(url, config, options) };
    } catch (error) {
        throw new Error(readRequestError(error, apiText("videoTaskQueryFailed")));
    }
}

function assertVideoConfig(config: AiConfig, model: string) {
    if (!model) throw new Error(apiText("videoModelRequired"));
    if (!config.baseUrl.trim()) throw new Error(apiText("baseUrlRequired"));
    if (!config.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
}

function geminiVideoBaseUrl(config: Pick<AiConfig, "baseUrl">) {
    const normalizedBaseUrl = config.baseUrl.trim().replace(/\/+$/, "");
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    return lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/v1beta") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1beta`;
}

function geminiVideoUrl(config: Pick<AiConfig, "baseUrl">, model: string, action: string) {
    return `${geminiVideoBaseUrl(config)}/models/${encodeURIComponent(modelOptionName(model).replace(/^models\//, ""))}:${action}`;
}

function geminiOperationUrl(config: Pick<AiConfig, "baseUrl">, name: string) {
    return `${geminiVideoBaseUrl(config)}/${name.replace(/^\//, "")}`;
}

function geminiVideoHeaders(config: Pick<AiConfig, "apiKey">) {
    return { "x-goog-api-key": config.apiKey, "Content-Type": "application/json" };
}

function videoAspectRatio(size: string) {
    const ratio = inferVideoRatio(size);
    return ratio === "auto" ? "16:9" : ratio;
}

function parseDataUrlInline(dataUrl: string, fallbackType = "image/png"): GeminiInlineData {
    const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
    return { bytesBase64Encoded: match?.[2] || "", mimeType: match?.[1] || fallbackType };
}

async function fileToGeminiInline(file: File): Promise<GeminiInlineData> {
    return parseDataUrlInline(await readFileAsDataUrl(file), file.type || "application/octet-stream");
}

async function referenceMediaToFile(item: { name: string; type?: string; url?: string; storageKey?: string }, fallbackName: string, errorKey: "invalidReferenceVideo" | "invalidReferenceAudio", options?: RequestOptions) {
    let blob = item.storageKey ? await getMediaBlob(item.storageKey) : null;
    if (!blob) {
        const url = item.storageKey ? await resolveMediaUrl(item.storageKey, item.url || "") : item.url || "";
        if (!url) throw new Error(apiText(errorKey));
        try {
            blob = await readLocalBlob(url, options?.signal);
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") throw error;
            throw new Error(apiText(errorKey));
        }
    }
    if (!blob.size) throw new Error(apiText(errorKey));
    return new File([blob], item.name || fallbackName, { type: item.type || blob.type || "application/octet-stream" });
}

function normalizeVideoSeconds(value: string) {
    return clampVideoSeconds(value);
}

function resolveVideoMode(mode: string | undefined, imageCount: number) {
    if (mode === "reference" || imageCount > 2) return "reference";
    return "frames";
}

function normalizeVideoSize(value: string, resolution?: string) {
    if (value === "auto") return null;
    if (/^\d+x\d+$/.test(value || "")) return value;
    const ratio = inferVideoRatio(value || "16:9");
    if (ratio === "auto") return null;
    return computeVideoSize(resolution || "720", ratio);
}

function normalizeVideoResolution(value: string) {
    if (value === "low") return "480p";
    if (value === "auto" || value === "high" || value === "medium") return "720p";
    const resolution = value.replace(/p$/i, "") || "720";
    return `${resolution}p`;
}

function unwrapVideoResponse(payload: ApiVideoResponse) {
    return unwrapEnvelope(payload, apiText("noVideoTask"));
}

function unwrapEnvelope<T>(payload: ApiEnvelope<T>, emptyMessage: string): T {
    if (!payload) throw new Error(emptyMessage);
    if (typeof payload === "object" && "code" in payload && payload.code !== undefined) {
        if (payload.code !== 0 && payload.code !== "0") throw new Error(readApiErrorMessage(payload) || apiText("requestFailed"));
        if (!payload.data) throw new Error(emptyMessage);
        return payload.data;
    }
    return payload as T;
}

function videoResultUrl(payload: VideoResponse) {
    return [payload.video_url, payload.result_url, payload.url, payload.content?.video_url, payload.content?.url].find((url) => typeof url === "string" && (isPublicMediaUrl(url) || /\.mp4(\?|#|$)/i.test(url)));
}


function readRequestError(error: unknown, fallback: string) {
    // 有状态码的走 ProviderHttpError；没拿到响应的走 ProviderTransportError。
    if (error instanceof ProviderHttpError) return error.message;
    if (error instanceof ProviderTransportError) {
        if (error.kind === "aborted") return apiText("requestCanceled");
        if (error.kind === "http") return readApiErrorMessage(error.message) || statusMessage(error.status, fallback);
        return apiText("requestFailed");
    }
    if (error instanceof DOMException && error.name === "AbortError") return apiText("requestCanceled");
    return error instanceof Error ? readApiErrorMessage(error.message) || error.message : fallback;
}

function statusMessage(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return apiText("authenticationFailed");
    if (status === 429) return apiText("rateLimited");
    return status ? `${fallback}（${status}）` : fallback;
}

async function assertVideoBlob(blob: Blob) {
    if (!blob.type.includes("json") && !/text\/html/i.test(blob.type)) return;
    if (/text\/html/i.test(blob.type)) throw new Error(apiText("videoDownloadFailed"));
    let payload: { code?: number; msg?: string; error?: { message?: string } };
    try {
        payload = JSON.parse(await blob.text()) as { code?: number; msg?: string; error?: { message?: string } };
    } catch {
        return;
    }
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(readApiErrorMessage(payload) || apiText("videoDownloadFailed"));
    if (payload.error?.message) throw new Error(readApiErrorMessage(payload.error.message) || payload.error.message);
}

function isPublicMediaUrl(value: string) {
    return /^https?:\/\//i.test(value || "");
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}
