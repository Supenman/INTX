import type { AssetKind } from '../asset/model';

/**
 * Provider —— 厂商适配器的领域契约。
 *
 * 旧代码在这件事上犯了两个错，都很致命：
 *
 * 1. **按模型名字符串猜类型**。`if 'kling' in model: video elif 'seedream' ...`，
 *    这段逻辑在后端写了两次、前端又抄了一遍，三处不同步。
 *    新做法：厂商自己声明能力，UI 只问 `capabilities.has('image')`。
 *
 * 2. **同步阻塞**。一个视频任务跑 5 分钟，请求就挂 5 分钟，
 *    前端只能挂着假进度条等。新做法：适配器把过程表达成事件流，
 *    上层负责渲染，谁也别猜谁的状态。
 *
 * 这个文件只有类型，没有实现 —— 实现分别在 infra/provider/ 下。
 * 因此在 node 环境里能直接对适配器做单测，不需要真网络。
 */

export type ProviderCapability = 'text' | 'image' | 'video';

/** 一个厂商 = 一个 baseURL + 一把 key + 若干模型。 */
export interface ProviderConfig {
  id: string;
  name: string;
  /** 适配器种类，决定怎么发请求。同一个协议可以配多家。 */
  adapter: 'openai-compatible' | 'mock';
  baseUrl: string;
  apiKey: string;
  models: ModelSpec[];
}

/** 模型的能力自述。UI 的模型下拉框只列出当前节点需要的模型。 */
export interface ModelSpec {
  id: string;
  label: string;
  /** 一行说明，显示在设置页里，避免用户靠猜 */
  note?: string;
  capabilities: readonly ProviderCapability[];
  /** 支持的宽高比；空表示厂商不管这个参数 */
  aspectRatios?: readonly string[];
  /** 是否接受参考图（图生图/参考） */
  acceptsImages?: boolean;
}

export interface GenerationRequest {
  capability: ProviderCapability;
  model: string;
  prompt: string;
  /** 参考图的原始字节。上层已经从资产里取出来了。 */
  referenceImages: readonly { mime: string; bytes: ArrayBuffer }[];
  aspectRatio?: string;
  /** 一次要几张。分镜节点靠它一次出 N 格。 */
  count: number;
  signal?: AbortSignal;
}

/** 产物：字节 + mime。落盘与去重由上层负责，适配器只负责拿到东西。 */
export interface GeneratedItem {
  mime: string;
  bytes: ArrayBuffer;
  /** 上游返回的原始 URL（若有），调试用。不要用它当长期地址。 */
  sourceUrl?: string;
}

/**
 * 适配器通过回调向上报告进度，而不是自己写 store。
 *
 * 这样 infra 层不依赖 app 层，适配器可以在任何宿主里跑（含未来的
 * 服务端、CLI、测试）。回调里只允许"事实"：
 * `onProgress` 的 null 表示"上游没给进度"，绝不允许编造。
 */
export interface GenerationHandlers {
  onProgress?: (value: number | null) => void;
  onPhase?: (phase: 'submitting' | 'generating' | 'downloading') => void;
}

export interface ProviderAdapter {
  readonly kind: ProviderConfig['adapter'];
  /** 连通性测试：设置页里点「测试」时用，必须便宜（不真的生成） */
  test(config: ProviderConfig): Promise<{ ok: true; models: string[] } | { ok: false; message: string }>;
  generate(
    config: ProviderConfig,
    request: GenerationRequest,
    handlers: GenerationHandlers,
  ): Promise<GeneratedItem[]>;
}

/**
 * 把上游连线送进来的文本包成真正的提示词。
 *
 * 直接拼裸文本有个后果：用户明明接了分镜文本，出图却和文本毫无关系，
 * 因为服务端只看到一句描述，没有"这是分镜"的语义。
 * 宫格任务必须显式说明「一格里画什么」，否则模型会把整个故事画进一张图。
 */
export function storyboardPrompt(script: string, grid: string, style: string, cell: number, total: number): string {
  const lines = script
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');

  // 用户按行写了分镜就按行分配；否则让模型自己均分
  const shot = lines.length > 0 ? lines[cell % lines.length] : `第 ${cell + 1} 格`;
  // 1x4 表示"一行四格"，其余按"行×列"读
  const [cols = '1', rows = '1'] = grid.split('x');
  const orientation = `${rows} 行 ${cols} 列`;

  return [
    `这是一组分镜图（${orientation}，共 ${total} 格）中的第 ${cell + 1} 格。`,
    `本格内容：${shot}`,
    style ? `画风：${style}` : '',
    '要求：与同组分镜保持角色、服装、场景、色调一致；单格构图完整，不要出现分格线。',
  ]
    .filter(Boolean)
    .join('\n');
}

export function modelsFor(config: ProviderConfig, capability: ProviderCapability): ModelSpec[] {
  return config.models.filter((m) => m.capabilities.includes(capability));
}

/** 该厂商能否承担这次生成。UI 用它决定「生成」按钮是否可用。 */
export function canGenerate(config: ProviderConfig, capability: ProviderCapability): boolean {
  return modelsFor(config, capability).length > 0;
}

/** Provider 能力 → 产出资产类型。分镜一次出多张，仍是 image。 */
export function capabilityAssetKind(c: ProviderCapability): AssetKind {
  return c;
}
