import type { GeneratedItem, GenerationHandlers, ProviderConfig } from '@/domain';
import { failure, joinUrl, materialize } from './providerHttp';
import { ProviderResultPendingError } from './providerResultPending';

/**
 * ModelScope API-Inference 的「查单取图」部分，单独抽出来给两个适配器共用：
 *   - modelScopeAdapter：POST 提交后拿 task_id 来查；
 *   - openaiCompatibleAdapter：真机上用户配置还停留在「OpenAI 兼容」，
 *     POST 已经 2xx 并回了 task_id，这一单已经下了、钱已经算过了，
 *     不能重发，只能就地查这一单把图取回来。
 *
 * 官方协议（模型页 openmoss/MOSS-Image-SFT 的 API Inference 示例）：
 *   GET  {baseUrl}/tasks/{task_id}
 *        headers: X-ModelScope-Task-Type: image_generation
 *        → { task_status, output_images: [url, ...] }
 *        SUCCEED → 下载 output_images；FAILED → 失败；其余状态继续等
 *
 * 硬规则：拿到 task_id 之后，任何失败都只能抛 ProviderResultPendingError，
 * 绝不退化成 timeout / network / canceled 这类「可重试」或「未扣费」结论。
 */

const POLL_INTERVAL_MS = 5_000;
const MAX_WAIT_MS = 180_000;

interface TaskResponse {
  task_status?: string;
  output_images?: string[] | string;
  /** 有些实现把图片放在 images 里，兼容一下，不猜别的字段 */
  images?: string[] | string;
  error?: { message?: string } | string;
  message?: string;
}

function errorMessage(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') {
    const v = e as { message?: string };
    if (typeof v.message === 'string') return v.message;
  }
  return '无详情';
}

function imageUrls(task: TaskResponse): string[] {
  const raw = task.output_images ?? task.images;
  if (typeof raw === 'string') return raw ? [raw] : [];
  if (Array.isArray(raw)) return raw.filter((u): u is string => typeof u === 'string' && u.length > 0);
  return [];
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('aborted'));
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** 官方 API-Inference 域名。前缀必须是 api-inference，别把社区网页域名也算进来。 */
export function isModelScopeEndpoint(baseUrl: string): boolean {
  const host = (() => {
    try {
      return new URL(baseUrl).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();
  return /^api-inference\.modelscope\.(cn|ai)$/.test(host);
}

export interface PollOptions {
  signal: AbortSignal;
  handlers: GenerationHandlers;
  count: number;
}

/** 已收单、已有 task_id：只查这一单，不重新提交，避免再买一张。 */
export async function pollSubmittedTask(
  config: ProviderConfig,
  taskId: string,
  opts: PollOptions,
): Promise<GeneratedItem[]> {
  const { signal, handlers, count } = opts;
  const deadline = Date.now() + MAX_WAIT_MS;

  try {
    while (true) {
      if (signal.aborted) {
        // 用户取消只停本地轮询，上游那张图照样会跑完、照样计费
        throw new ProviderResultPendingError({
          taskId,
          detail: '本地已取消轮询，但上游任务仍在跑，可能会计费',
        });
      }
      if (Date.now() > deadline) {
        throw new ProviderResultPendingError({ taskId, detail: '轮询超时，任务可能仍在跑' });
      }

      const pollRes = await fetch(joinUrl(config.baseUrl, `tasks/${encodeURIComponent(taskId)}`), {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'X-ModelScope-Task-Type': 'image_generation',
        },
        signal,
      });
      if (!pollRes.ok) throw await failure(pollRes);
      const task = (await pollRes.json()) as TaskResponse;

      if (task.task_status === 'SUCCEED') {
        const urls = imageUrls(task);
        if (urls.length === 0) {
          throw new ProviderResultPendingError({
            taskId,
            rawResponse: JSON.stringify(task),
            detail: '上游说成功但没给图片地址',
          });
        }
        return Promise.all(
          urls.slice(0, Math.max(1, count)).map((url) => materialize({ url }, signal, handlers)),
        );
      }

      if (task.task_status === 'FAILED') {
        throw new ProviderResultPendingError({
          taskId,
          rawResponse: JSON.stringify(task),
          detail: `上游任务失败（${errorMessage(task.error ?? task.message)}）`,
        });
      }

      // PENDING / RUNNING / 其他未知状态：继续等，不编进度
      await sleep(POLL_INTERVAL_MS, signal);
    }
  } catch (e) {
    if (e instanceof ProviderResultPendingError) throw e;
    throw new ProviderResultPendingError({
      taskId,
      detail: `轮询中断（${errorMessage(e)}）`,
    });
  }
}
