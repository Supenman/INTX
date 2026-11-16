/**
 * `services/api/image.ts` 的接线回归：三条失败路径必须按 M2 语义收敛。
 *
 * 为什么单独立这个文件（而不是继续加在 modelScope.test.ts）：
 * 现有测试都在 `generateModelScopeImages` 这一层直接塞假 transport，绕过了
 * image.ts 的真实分支——端点判定、proxyMode 取渠道、`withSystemPrompt`、
 * 提交/查单的取舍。上一轮加 `proxyMode` 就是这样：service 层测试全绿，
 * 但如果 image.ts 忘了把渠道开关传下去，谁都不会报错。
 *
 * 这里从 `requestSingleImage`（画布节点、槽位、重试真正调用的入口）打进去，
 * 一路断言到 `GenerationTaskError.outcome`——UI 拿到的就是这颗对象。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
    // 这批代码按浏览器写（i18n 读 localStorage，store 读写配置）。
    // 不为了它引 jsdom：只补上用得到的那几个 API，保持 node 环境跑得快。
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
    return {
        /** 每个用例替换成自己的假 transport。 */
        transport: null as unknown,
        /** 记录 image.ts 按什么出网方式构造传输层。 */
        proxyModes: [] as string[],
        /** 让 withTask 用内存台账，别碰 IndexedDB。 */
        log: null as unknown,
    };
});

vi.mock('./modelscope-transport', async () => {
    const actual = await vi.importActual<typeof import('./modelscope-transport')>('./modelscope-transport');
    return {
        ...actual,
        createModelScopeTransport: (proxyMode: string = 'system') => {
            h.proxyModes.push(proxyMode);
            if (!h.transport) throw new Error('用例没有注入假 transport');
            return h.transport;
        },
    };
});

vi.mock('@/services/generation/taskLog', async () => {
    const actual = await vi.importActual<typeof import('@/services/generation/taskLog')>('@/services/generation/taskLog');
    return {
        ...actual,
        get browserTaskLog() {
            return h.log;
        },
    };
});

import { createMemoryEvidenceStore, setEvidenceStore } from '@/services/generation/taskEvidence';
import { createMemoryTaskLog } from '@/services/generation/taskLog';
import { GenerationTaskError } from '@/services/generation/withTask';
import { readTaskOutcome } from '@/domain/task/outcome';
import { defaultConfig, type AiConfig, type ChannelProxyMode } from '@/stores/use-config-store';
import { requestSingleImage } from './image';

const MS_BASE = 'https://api-inference.modelscope.cn/v1';
const MS_MODEL = 'openmoss/MOSS-Image-SFT';

interface Call {
    method: string;
    url: string;
    body?: string;
    headers: Record<string, string>;
}

interface StubResponse {
    status: number;
    body: unknown;
}

/** 按队列回放响应；记录每个请求；sleep 立即返回，轮询瞬间跑完。 */
function fakeTransport(responses: StubResponse[], onRequest?: (call: Call) => void) {
    const calls: Call[] = [];
    let clock = 0;
    const transport = {
        async request(url: string, init: { method: string; headers: Record<string, string>; body?: string }) {
            const call: Call = { method: init.method, url, body: init.body, headers: init.headers };
            calls.push(call);
            onRequest?.(call);
            const next = responses.shift();
            if (!next) throw new Error('用例收到了预期之外的额外请求');
            return {
                ok: next.status >= 200 && next.status < 300,
                status: next.status,
                json: async () => next.body,
                text: async () => (typeof next.body === 'string' ? next.body : JSON.stringify(next.body)),
            };
        },
        async fetchImage(url: string) {
            return `data:image/png;base64,${Buffer.from(url).toString('base64')}`;
        },
        async sleep(ms: number) {
            clock += ms;
        },
        now: () => clock,
    };
    return { transport, calls };
}

/** 渠道协议故意写 openai：端点应该说了算，不该让协议下拉框把请求带回同步分支。 */
function configWith(proxyMode: ChannelProxyMode = 'system'): AiConfig {
    return {
        ...defaultConfig,
        channelMode: 'remote',
        baseUrl: MS_BASE,
        apiKey: 'test-token-not-real',
        apiFormat: 'openai',
        proxyMode,
        model: MS_MODEL,
        imageModel: MS_MODEL,
        channels: [
            {
                id: 'ch-test',
                name: 'test',
                baseUrl: MS_BASE,
                apiKey: 'test-token-not-real',
                apiFormat: 'openai',
                proxyMode,
                models: [{ name: MS_MODEL, capability: 'image' }],
            },
        ],
    };
}

const posts = (calls: Call[]) => calls.filter((call) => call.method === 'POST');

beforeEach(() => {
    h.proxyModes.length = 0;
    h.transport = null;
    h.log = createMemoryTaskLog();
    setEvidenceStore(createMemoryEvidenceStore());
});

describe('image.ts 接线：ModelScope 端点说了算', () => {
    it('渠道协议写 openai，地址是 ModelScope 官方域名，仍然走异步提交', async () => {
        const { transport, calls } = fakeTransport([
            { status: 200, body: { task_id: 'tk-async' } },
            { status: 200, body: { task_status: 'SUCCEED', output_images: ['https://cdn/a.png'] } },
        ]);
        h.transport = transport;

        const image = await requestSingleImage(configWith(), '一只猫');

        expect(image.dataUrl).toMatch(/^data:image\/png;base64,/);
        const [post] = posts(calls);
        expect(post.url).toBe(`${MS_BASE}/images/generations`);
        expect(post.headers['X-ModelScope-Async-Mode']).toBe('true');
        // 只买一张：POST 一次，其余全是查单
        expect(posts(calls)).toHaveLength(1);
    });

    it('出网方式按渠道走：直连渠道不套本地代理，默认渠道按 system 构造', async () => {
        h.transport = fakeTransport([
            { status: 200, body: { task_id: 'tk-direct' } },
            { status: 200, body: { task_status: 'SUCCEED', output_images: ['https://cdn/a.png'] } },
        ]).transport;
        await requestSingleImage(configWith('direct'), '一只猫');
        expect(h.proxyModes).toContain('direct');
        expect(h.proxyModes).not.toContain('system');

        h.proxyModes.length = 0;
        h.transport = fakeTransport([
            { status: 200, body: { task_id: 'tk-system' } },
            { status: 200, body: { task_status: 'SUCCEED', output_images: ['https://cdn/b.png'] } },
        ]).transport;
        await requestSingleImage(configWith('system'), '一只猫');
        expect(h.proxyModes).toEqual(['system']);
    });
});

describe('失败注入 · A：Key 错误，HTTP 401 且没有任务号', () => {
    it('401 → auth_failed / config_required / confirm，且绝不重发第二次请求', async () => {
        const { transport, calls } = fakeTransport([
            { status: 401, body: { message: 'Unauthorized: invalid api key' } },
        ]);
        h.transport = transport;

        const error = await requestSingleImage(configWith(), '一只猫').catch((e: unknown) => e);

        expect(error).toBeInstanceOf(GenerationTaskError);
        const taskError = error as GenerationTaskError;
        // 没拿到任务号：不是「已收单」，也不能被降级成「提交不确定」
        expect(taskError.errorCode).toBe('auth_failed');
        expect(taskError.upstreamRef).toBeNull();
        // 引导是「先去改 Key」，不是「再点一次重试」——confirm 而非 allowed
        expect(taskError.outcome?.reason).toBe('config_required');
        expect(taskError.outcome?.regenerate).toBe('confirm');
        // 付费请求一次都不许重试
        expect(calls).toHaveLength(1);
    });
});

describe('失败注入 · B：生成中取消，必须保留任务号并判「需先确认」', () => {
    it('拿到任务号后取消 → provider_result_pending / confirm，不引导重发', async () => {
        const controller = new AbortController();
        const { transport, calls } = fakeTransport(
            [
                { status: 200, body: { task_id: 'tk-running' } },
                // 第一次查单时用户点了取消；上游仍会跑完、仍会计费
                { status: 200, body: { task_status: 'RUNNING' } },
            ],
            (call) => {
                if (call.method === 'GET') controller.abort();
            },
        );
        h.transport = transport;

        const error = await requestSingleImage(configWith(), '一只猫', [], { signal: controller.signal }).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(GenerationTaskError);
        const taskError = error as GenerationTaskError;
        expect(taskError.errorCode).toBe('provider_result_pending');
        // 任务号必须留住，否则用户去后台也查不到这一单
        expect(taskError.upstreamRef).toBe('tk-running');
        expect(taskError.outcome?.regenerate).toBe('confirm');
        expect(taskError.outcome?.reason).toBe('provider_result_pending');
        // 取消只停本地轮询，绝不能再买一张
        expect(posts(calls)).toHaveLength(1);
    });

    it('提交前取消（还没发出请求）→ 台账 canceled，判可重发，因为没扣钱', async () => {
        const controller = new AbortController();
        controller.abort();
        const { transport, calls } = fakeTransport([
            { status: 200, body: { task_id: 'tk-never-sent' } },
        ]);
        h.transport = transport;

        const error = await requestSingleImage(configWith(), '一只猫', [], { signal: controller.signal }).catch((e: unknown) => e);

        // 还没提交就被叫停：抛出的是取消，不是失败
        expect((error as Error).name).toBe('AbortError');
        // 一次请求都没发出去
        expect(calls).toHaveLength(0);

        const tasks = await (h.log as ReturnType<typeof createMemoryTaskLog>).list();
        expect(tasks).toHaveLength(1);
        expect(tasks[0].status).toBe('canceled');
        expect(tasks[0].upstreamRef).toBeNull();
        // 没提交就没花钱，允许直接再来一次
        expect(readTaskOutcome(tasks[0])?.regenerate).toBe('allowed');
    });
});

describe('失败注入 · C：2xx 却没有任务号', () => {
    it('提交成功但响应没 task_id → 判「需先确认」，钱可能已经扣了', async () => {
        const { transport, calls } = fakeTransport([{ status: 200, body: {} }]);
        h.transport = transport;

        const error = await requestSingleImage(configWith(), '一只猫').catch((e: unknown) => e);

        expect(error).toBeInstanceOf(GenerationTaskError);
        const taskError = error as GenerationTaskError;
        expect(taskError.errorCode).toBe('provider_result_pending');
        expect(taskError.outcome?.regenerate).toBe('confirm');
        expect(posts(calls)).toHaveLength(1);
    });
});

describe('台账完整性', () => {
    it('任务台账里不出现 Token 与 baseUrl', async () => {
        h.transport = fakeTransport([
            { status: 200, body: { task_id: 'tk-ledger' } },
            { status: 200, body: { task_status: 'SUCCEED', output_images: ['https://cdn/a.png'] } },
        ]).transport;

        await requestSingleImage(configWith(), '一只猫');

        const tasks = await (h.log as ReturnType<typeof createMemoryTaskLog>).list();
        expect(tasks).toHaveLength(1);
        const serialized = JSON.stringify(tasks[0]);
        expect(serialized).not.toContain('test-token-not-real');
        expect(serialized).not.toContain(MS_BASE);
        expect(serialized).not.toContain('data:image');
    });
});
