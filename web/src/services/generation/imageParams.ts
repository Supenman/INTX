/**
 * 把基座 AiConfig 转成可落盘的 GenerationParams 快照。
 *
 * 红线：AiConfig 里有 `apiKey`、`baseUrl`（可能带 query token）、参考图 dataUrl，
 * 这些**一律不进台账**。这里用结构类型而不是直接 import AiConfig，
 * 免得任务层把整个 config store 拉进依赖图（测试也跑得更干净）。
 */
import type { GenerationParams } from '@/domain/task/model';

export interface ImageConfigView {
  model?: string;
  imageModel?: string;
  apiFormat?: string;
  size?: string;
  count?: string;
}

export interface ReferenceView {
  id?: string;
  name?: string;
}

export interface ImageTaskParamsOptions {
  isEdit?: boolean;
  /**
   * 提交走的端点族。ModelScope 异步单只回任务号，重启后只能凭号查单；
   * 记下来，「待核实任务」才不会对着 OpenAI 的失败单摆一个查不了的按钮。
   */
  endpoint?: 'modelscope';
}

export function imageTaskParams(
  config: ImageConfigView,
  prompt: string,
  references: readonly ReferenceView[] = [],
  options: ImageTaskParamsOptions = {},
): GenerationParams {
  const params: GenerationParams = {
    kind: 'image',
    prompt,
    model: config.model || config.imageModel || '',
    providerId: config.apiFormat || 'unknown',
    // 只存 id/name，且挡掉 dataUrl —— 绝不把 base64 图写进 localforage。
    // id 恰好是 dataUrl 时退回 name，别把整条参考图记录丢掉。
    inputAssetIds: references
      .map((ref) => {
        const id = ref.id || '';
        return id && !id.startsWith('data:') ? id : ref.name || '';
      })
      .filter((value) => value.length > 0 && !value.startsWith('data:')),
  };
  if (config.size) params.aspectRatio = config.size;
  const count = Number(config.count);
  if (Number.isFinite(count) && count > 0) params.count = Math.floor(count);
  const extras: Record<string, string | number | boolean> = {};
  if (options.isEdit) extras.mode = 'edit';
  if (options.endpoint) extras.endpoint = options.endpoint;
  if (Object.keys(extras).length) params.extras = extras;
  return params;
}
