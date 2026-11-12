import type { ProviderAdapter } from '@/domain';
import { failure, joinUrl } from './providerHttp';
import { pollSubmittedTask } from './modelScopeTask';
import { ProviderResultPendingError } from './providerResultPending';

/**
 * ModelScope API-Inference 异步出图适配器。
 *
 * 协议（官方 API Inference 示例，模型页 openmoss/MOSS-Image-SFT 同款）：
 *   POST {baseUrl}/images/generations
 *        headers: X-ModelScope-Async-Mode: true
 *        body:    { model, prompt }
 *        → 不回图片，只回 { task_id }
 *   GET  {baseUrl}/tasks/{task_id}  → 见 modelScopeTask.ts
 *
 * 真机踩过的坑：这个 POST 是 2xx、单已经下了、钱已经扣了，但响应里没有
 * `data` 数组。旧 openaiCompatible 把它当成「上游返回了空结果」→ unknown →
 * 三态 allowed → 卡片写「重置状态，原样重试是合理的」，点一下就再买一张。
 * 第二次真机踩的坑：只在「读配置」时把旧配置升级成 modelscope 适配器不够，
 * 设置页新建/编辑厂商会绕过那次升级，请求照样落回同步适配器。所以现在
 * 分发层（provider/index.ts）也按 baseUrl 兜底，同步适配器收到 task_id
 * 也会就地查单，不再依赖用户去改「协议」下拉框。
 */

interface SubmitResponse {
  task_id?: string;
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

    handlers.onPhase?.('generating');
    handlers.onProgress?.(null); // 这个接口不报进度，如实说不知道
    return pollSubmittedTask(config, submitted.task_id, {
      signal,
      handlers,
      count: request.count,
    });
  },
};
