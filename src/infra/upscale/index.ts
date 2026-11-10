import type { UpscaleAdapter, UpscaleAvailability } from '@/domain';
import { referenceResampleAdapter } from './referenceAdapter';
import { tauriOnnxAdapter } from './tauriOnnxAdapter';

/**
 * 超分后端注册表。与厂商适配器 / 节点注册表同一个思路：
 * 加一种实现 = 注册一条记录，不改 if/else。
 *
 * 顺序即优先级：本地 ONNX 在前，参考重采样兜底。
 * 浏览器 / CI 里 ONNX 探测不通过，自动落回参考实现并如实告知上层。
 */

const BUILTINS: readonly UpscaleAdapter[] = [tauriOnnxAdapter, referenceResampleAdapter];
let registry: UpscaleAdapter[] = [...BUILTINS];

export interface UpscaleProbe {
  adapter: UpscaleAdapter;
  availability: UpscaleAvailability;
}

export function listUpscalers(): readonly UpscaleAdapter[] {
  return registry;
}

export function registerUpscaler(adapter: UpscaleAdapter, position: 'first' | 'last' = 'last'): void {
  const rest = registry.filter((a) => a.id !== adapter.id);
  registry = position === 'first' ? [adapter, ...rest] : [...rest, adapter];
}

/** 测试用：恢复内置顺序，避免跨用例污染全局状态。 */
export function resetUpscalers(): void {
  registry = [...BUILTINS];
}

export async function probeUpscalers(): Promise<UpscaleProbe[]> {
  return Promise.all(
    registry.map(async (adapter) => ({ adapter, availability: await adapter.available() })),
  );
}

export interface UpscaleSelection {
  /** 当前真正会执行的后端；没有任何可用实现时为 null */
  adapter: UpscaleAdapter | null;
  /** 是否退到了非首选实现 */
  fallback: boolean;
  probes: UpscaleProbe[];
}

export async function selectUpscaler(): Promise<UpscaleSelection> {
  const probes = await probeUpscalers();
  const index = probes.findIndex((p) => p.availability.ok);
  if (index < 0) return { adapter: null, fallback: false, probes };
  return { adapter: probes[index]!.adapter, fallback: index > 0, probes };
}

export { referenceResampleAdapter, tauriOnnxAdapter };
