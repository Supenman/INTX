/**
 * `services/api/video.ts` / `audio.ts` 迁移到 ProviderTransport 后的接线回归。
 *
 * 这里不测重试（重试语义在 provider-transport.test.ts 里钉住了），
 * 只测这两条真机扣费链路的接线有没有接错：提交是不是走 /v1/videos 或 /v1/audio/speech、
 * FormData 有没有被自己补上 Content-Type、成品下载失败会不会误报成任务失败、
 * 以及 proxyMode 有没有真的传到传输层。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, String(value)),
        removeItem: (key: string) => void store.delete(key),
        clear: () => store.clear(),
        key: (index: number) => [...store.keys()][index] ?? null,
        get length() {
            return store.size;
        },
    };
    return { store };
});

// 任务层（台账、落盘、续查）自己有一整套用例；这里只借它的提交壳，别写 IndexedDB。
vi.mock('@/services/generation', async () => {
    const actual = await vi.importActual<typeof import('@/services/generation')>('@/services/generation');
    return {
        ...actual,
        submitVideoTask: async ({ transport }: { transport: { submit: () => Promise<unknown> } }) => ({ handle: await transport.submit(), task: {} }),
    };
});

import { createModelChannel, defaultConfig, type AiConfig } from '@/stores/use-config-store';
import { requestAudioGeneration } from './audio';
import { createVideoGenerationTask, pollVideoGenerationTask } from './video';

const BASE = 'https://api.example.com';
const RH_BASE = 'https://www.runninghub.cn';
const RH_MODEL = 'vidu/image-to-video-q2-pro-fast';
const reference = { id: 'ref', name: 'ref.png', type: 'image/png', dataUrl: 'data:image/png;base64,AA==' };

function config(overrides: Partial<AiConfig> = {}): AiConfig {
    const models = [
        { name: 'vd', capability: 'video' as const },
        { name: 'ad', capability: 'audio' as const },
    ];
    return {
        ...defaultConfig,
        baseUrl: BASE,
        apiKey: 'k',
        apiFormat: 'openai',
        proxyMode: 'direct',
        channels: [{ ...defaultConfig.channels[0], baseUrl: BASE, apiKey: 'k', apiFormat: 'openai', proxyMode: 'direct', models }],
        model: 'vd',
        videoModel: 'vd',
        audioModel: 'ad',
        ...overrides,
    };
}

function json(status: number, body: unknown) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function runningHubConfig() {
    return config({
        model: RH_MODEL,
        videoModel: RH_MODEL,
        videoSeconds: '5',
        vquality: '720',
        channels: [createModelChannel({ apiFormat: 'runninghub', apiKey: 'mock-key' })],
    });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    h.store.clear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('视频提交/查单接线', () => {
    it('RunningHub 上传首帧、保留原任务号，并通过 V2 查单下载视频', async () => {
        const baseUrl = RH_BASE;
        const model = RH_MODEL;
        const taskId = '2013508786110730241';
        const imageUrl = 'https://cdn.example.com/input.png';
        const videoUrl = 'https://cdn.example.com/video.mp4';
        const runningHub = runningHubConfig();
        fetchMock
            .mockResolvedValueOnce(json(200, { data: { download_url: imageUrl } }))
            .mockResolvedValueOnce(json(200, { taskId, status: 'RUNNING' }))
            .mockResolvedValueOnce(json(200, { taskId, status: 'RUNNING' }))
            .mockResolvedValueOnce(json(200, { taskId, status: 'SUCCESS', results: [{ url: 'https://cdn.example.com/preview.jpg', outputType: 'jpg' }, { url: videoUrl, outputType: 'mp4' }] }))
            .mockResolvedValueOnce(new Response(new Blob(['mp4'], { type: 'video/mp4' })));

        const task = await createVideoGenerationTask(runningHub, '镜头缓慢推进', [reference]);
        expect(task).toEqual({ id: taskId, model, provider: 'runninghub' });
        expect((fetchMock.mock.calls[0][1].body as FormData).get('file')).toBeInstanceOf(File);
        expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
            prompt: '镜头缓慢推进', imageUrl, duration: '5', resolution: '720p', movementAmplitude: 'auto', bgm: false,
        });
        expect(await pollVideoGenerationTask(runningHub, task)).toEqual({ status: 'pending' });
        expect(await pollVideoGenerationTask(runningHub, task)).toMatchObject({ status: 'completed', result: { blob: { type: 'video/mp4' } } });
        expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ taskId });
        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
            `${baseUrl}/openapi/v2/media/upload/binary`, `${baseUrl}/openapi/v2/${model}`,
            `${baseUrl}/openapi/v2/query`, `${baseUrl}/openapi/v2/query`, videoUrl,
        ]);
    });

    it('RunningHub 上传被拒绝时保留厂商错误，不提交生成', async () => {
        fetchMock.mockResolvedValueOnce(json(200, { code: 811, msg: 'CORPAPIKEY_INVALID' }));
        await expect(createVideoGenerationTask(runningHubConfig(), '镜头缓慢推进', [reference])).rejects.toThrow('CORPAPIKEY_INVALID');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('此前按 OpenAI 配置的 RunningHub 渠道仍能识别，保留模型 API 的错误码', async () => {
        const runningHub = runningHubConfig();
        runningHub.channels[0] = { ...runningHub.channels[0], apiFormat: 'openai', baseUrl: 'https://runninghub.cn/openapi/v2/' };
        fetchMock
            .mockResolvedValueOnce(json(200, { data: { download_url: 'https://cdn.example.com/input.png' } }))
            .mockResolvedValueOnce(json(200, { errorCode: '1014', errorMessage: 'Access Denied' }));
        await expect(createVideoGenerationTask(runningHub, '镜头缓慢推进', [reference])).rejects.toThrow('RunningHub 1014: Access Denied');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('OpenAI 视频提交走 POST /v1/videos，FormData 不自己写 Content-Type', async () => {
        fetchMock.mockResolvedValue(json(200, { id: 'v-1' }));
        const task = await createVideoGenerationTask(config(), '海边日落');
        expect(task).toMatchObject({ id: 'v-1', provider: 'openai' });
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('https://api.example.com/v1/videos');
        expect(init.method).toBe('POST');
        expect(init.body).toBeInstanceOf(FormData);
        expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k');
    });

    it('OpenAI 视频提交失败只发一次（可能已收单，不能重发）', async () => {
        fetchMock.mockResolvedValue(json(502, { error: { message: '上游繁忙' } }));
        await expect(createVideoGenerationTask(config(), '海边日落')).rejects.toThrow('上游繁忙');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('查单 completed 时按 content 端点下载成品', async () => {
        fetchMock
            .mockResolvedValueOnce(json(200, { status: 'completed' }))
            .mockResolvedValueOnce(new Response(new Blob(['mp4'], { type: 'video/mp4' }), { status: 200 }));
        const state = await pollVideoGenerationTask(config(), { id: 'v-1', provider: 'openai', model: 'vd' });
        expect(state.status).toBe('completed');
        expect(state.status === 'completed' && state.result.blob?.type).toBe('video/mp4');
        expect((fetchMock.mock.calls[1] as [string])[0]).toBe('https://api.example.com/v1/videos/v-1/content');
    });

    it('成品下载失败回退成 URL，不把任务标成失败', async () => {
        fetchMock
            .mockResolvedValueOnce(json(200, { status: 'completed', video_url: 'https://cdn.example.com/v.mp4' }))
            .mockResolvedValueOnce(json(500, { error: { message: '下载失败' } }));
        const state = await pollVideoGenerationTask(config(), { id: 'v-1', provider: 'openai', model: 'vd' });
        expect(state).toEqual({ status: 'completed', result: { url: 'https://cdn.example.com/v.mp4', mimeType: 'video/mp4' } });
    });

    it('Gemini 视频提交走 /v1beta/models/{model}:predictLongRunning', async () => {
        fetchMock.mockResolvedValue(json(200, { name: 'operations/abc' }));
        const gemini = config({ apiFormat: 'gemini' });
        gemini.channels = gemini.channels.map((channel) => ({ ...channel, apiFormat: 'gemini' }));
        const task = await createVideoGenerationTask(gemini, '海边日落');
        expect(task).toMatchObject({ id: 'operations/abc', provider: 'gemini' });
        expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://api.example.com/v1beta/models/vd:predictLongRunning');
    });
});

describe('音频接线', () => {
    it('走 POST /v1/audio/speech，JSON body 与返回 Blob', async () => {
        fetchMock.mockImplementation(async () => new Response(new Blob(['mp3'], { type: 'audio/mpeg' }), { status: 200 }));
        const blob = await requestAudioGeneration(config({ model: 'ad' }), '你好');
        expect(blob.type).toBe('audio/mpeg');
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('https://api.example.com/v1/audio/speech');
        expect(init.method).toBe('POST');
        expect(JSON.parse(String(init.body))).toMatchObject({ model: 'ad', input: '你好', response_format: 'mp3' });
    });

    it('厂商 JSON 错误体被翻译成可读文案', async () => {
        fetchMock.mockResolvedValue(json(400, { error: { message: '音色不存在' } }));
        await expect(requestAudioGeneration(config({ model: 'ad' }), '你好')).rejects.toThrow('音色不存在');
    });

    it('proxyMode 传到传输层：direct 直连，system 走本地代理', async () => {
        fetchMock.mockImplementation(async () => new Response(new Blob(['mp3'], { type: 'audio/mpeg' }), { status: 200 }));
        await requestAudioGeneration(config({ model: 'ad' }), '你好');
        expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://api.example.com/v1/audio/speech');

        const { useConfigStore } = await import('@/stores/use-config-store');
        useConfigStore.setState((state) => ({ config: { ...state.config, proxyEnabled: true, proxyUrl: 'http://127.0.0.1:23210' } }));
        const viaProxy = config({ model: 'ad', proxyMode: 'system' });
        viaProxy.channels = viaProxy.channels.map((channel) => ({ ...channel, proxyMode: 'system' }));
        await requestAudioGeneration(viaProxy, '你好');
        expect((fetchMock.mock.calls[1] as [string])[0]).toBe('http://127.0.0.1:23210/https://api.example.com/v1/audio/speech');
    });
});
