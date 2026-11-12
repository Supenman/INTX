import type { ProviderAdapter } from '@/domain';
import { failure, joinUrl, materialize } from './openaiCompatible';
import { ProviderResultPendingError } from './providerResultPending';

/**
 * ModelScope API-Inference 异步出图适配器。
 *
 * 协议（官方 API Inference 示例，模型页 openmoss/MOSS-Image-SFT 同款）：
 *   POST {baseUrl}/images/generations
 *        headers: X-ModelScope-Async-Mode: true
 *        body:    { model, prompt }
 *        → 不回图片，只回 { task_id }
 *   GET  {baseUrl}/tasks/{task_id}
 *        headers: X-ModelScope-Task-Type: image_generation
 *        → { task_status, output_images: [url, ...] }
 *        task_status: SUCCEED → 从 output_images 下载；FAILED → 失败
 *
 * 真机踩过的坑：这个 POST 是 2xx、单已经下了、钱已经扣了，但响应里没有
 * `data` 数组。旧 openaiCompatible 把它当成「上游返回了空结果」→ unknown →
 * 三态 allowed → 卡片写「重置状态，原样重试是合理的」，点一下就再买一张。
 *
 * 所以这里有一条硬规则：**一旦拿到 task_id，后续任何失败（轮询超时、
 * 网络断、上游 FAILED、用户取消）都只能抛 ProviderResultPendingError**，
 * 绝不退化成 timeout / network / canceled 这类「可重试」或「未扣费」结论。
 */

const POLL_INTERVAL_MS = 5_000;
const MAX_WAIT_MS = 180_000;

interface SubmitResponse {
  task_id?: string;
  error?: { message?: string } | string;
  message?: string;
}

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

export const modelScopeAdapter: ProviderAdapter = {
  kind: 'modelscope',

  /**
   * 连通性探测。ModelScope 不提供 /v1/models，所以这里只验证「端点可达且
   * 没有返回 401」，**不宣称 Key 有效**——有效性只能靠一次真实生成证明，
   * 而那会花钱，不该由设置页的「测试」按钮悄悄花掉。
   */
  async test(config) {
    if (!config.apiKey.trim()) {
      return { ok: false, message: '还没填 ModelScope Token（ms- 开头）' };
    }
    try {
      const res = await fetch(joinUrl(config.baseUrl, 'tasks/intx-connectivity-probe'), {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'X-ModelScope-Task-Type': 'image_generation',
        },
      });
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: 'Token 被拒绝（401/403），请检查 ModelScope Token' };
      }
      return {
        ok: true,
        models: [], // 异步服务没有模型列表；Model-Id 在设置页手动填
      };
    } catch (e) {
      return { ok: false, message: `连不上 ${config.baseUrl}：${errorMessage(e)}` };
    }
  },

  async generate(config, request, handlers) {
    if (!config.apiKey.trim()) throw new Error('401 未配置 ModelScope Token');

    const signal = request.signal ?? new AbortController().signal;
    handlers.onPhase?.('submitting');
    handlers.onProgress?.(null);

    // 官方示例只发 model + prompt。n / size / response_format 是 OpenAI 的字段，
    // 这里不塞，免得上游参数校验直接 400（那又会变成一次白扣费的提交）。
    const body: Record<string, unknown> = {
      model: request.model,
      prompt: request.prompt,
    };
    if (request.referenceImages.length > 0) {
      // 协议未声明参考图字段，宁可显式不带，也不能猜一个名字让上游误收单。
      throw new Error('invalid_params：ModelScope 异步出图暂不支持参考图，请去掉参考图再生成');
    }

    const submitRes = await fetch(joinUrl(config.baseUrl, 'images/generations'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
        'X-ModelScope-Async-Mode': 'true',
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!submitRes.ok) throw await failure(submitRes);

    const submitted = (await submitRes.json()) as SubmitResponse;
    const submitError = submitted.error ?? submitted.message;
    if (submitError) throw new Error(errorMessage(submitError));

    /**
     * POST 已经 2xx = 上游收单。没有 task_id 也别说「空结果」：
     * 钱可能已经扣了，只是我们没拿到查单凭据。
     */
    if (!submitted.task_id) {
      throw new ProviderResultPendingError({
        rawResponse: JSON.stringify(submitted),
        detail: '提交成功但响应里没有 task_id，无法查单',
      });
    }

    const taskId = submitted.task_id;
    handlers.onPhase?.('generating');
    handlers.onProgress?.(null); // 这个接口不报进度，如实说不知道

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
          // 阶段与进度由 materialize 统一报，别在这里重复回调一次
          return Promise.all(urls.slice(0, Math.max(1, request.count)).map((url) => materialize({ url }, signal, handlers)));
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
      // 硬规则：拿到 task_id 之后，任何错误都得留着任务号，不许退化成可重试
      if (e instanceof ProviderResultPendingError) throw e;
      throw new ProviderResultPendingError({
        taskId,
        detail: `轮询中断（${errorMessage(e)}）`,
      });
    }
  },
};
