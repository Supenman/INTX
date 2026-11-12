import type { ProviderAdapter, ProviderConfig } from '@/domain';
import { mockAdapter } from './mockAdapter';
import { openAiCompatibleAdapter } from './openaiCompatible';
import { modelScopeAdapter } from './modelScope';

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
  return adapters[config.adapter];
}

export function registerAdapter(kind: ProviderConfig['adapter'], adapter: ProviderAdapter): void {
  adapters[kind] = adapter;
}

export { mockAdapter, openAiCompatibleAdapter, modelScopeAdapter };
export { ProviderResultPendingError, isProviderResultPending } from './providerResultPending';
