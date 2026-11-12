import type { ProviderAdapter, ProviderConfig } from '@/domain';
import { mockAdapter } from './mockAdapter';
import { openAiCompatibleAdapter } from './openaiCompatible';
import { modelScopeAdapter } from './modelScope';
import { isModelScopeEndpoint } from './modelScopeTask';

/**
 * 适配器注册表。
 *
 * 与节点注册表同一个思路：加一家厂商 = 加一条 adapter 记录，
 * 不改任何 if/else 分支。旧代码里 `if provider == 'modelscope'` 这种
 * 字符串判断散落在三个文件里，漏一处就静默走错分支。
 */
const adapters: Record<ProviderConfig['adapter'], ProviderAdapter> = {
  'openai-compatible': openAiCompatibleAdapter,
  modelscope: modelScopeAdapter,
  mock: mockAdapter,
};

export function adapterFor(config: ProviderConfig): ProviderAdapter {
  /**
   * 端点说了算，下拉框说了不算。
   *
   * 真机第二次反馈：设置页新建厂商时「协议」默认是 OpenAI 兼容，用户填完
   * ModelScope 的 baseUrl 直接生成，normalizeProviders 那次「读配置时迁移」
   * 根本没机会跑（upsert 绕过了它）。请求于是落到同步适配器，POST 2xx 只回
   * task_id，卡片就停在「已收单但没拿到图」。
   *
   * 这里在唯一的分发点做最后兜底：只要 baseUrl 是官方 API-Inference 域名，
   * 无论配置字段写的是什么，都走异步适配器。用户不用改协议、不用重启、不用
   * 重新装配置。mock 是本地演示，保持原样不受影响。
   */
  if (config.adapter !== 'mock' && isModelScopeEndpoint(config.baseUrl)) {
    return adapters.modelscope;
  }
  return adapters[config.adapter] ?? adapters['openai-compatible'];
}

export function registerAdapter(kind: ProviderConfig['adapter'], adapter: ProviderAdapter): void {
  adapters[kind] = adapter;
}

export { mockAdapter, openAiCompatibleAdapter, modelScopeAdapter };
export { ProviderResultPendingError, isProviderResultPending } from './providerResultPending';
export { isModelScopeEndpoint } from './modelScopeTask';
