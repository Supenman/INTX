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

export function imageTaskParams(
  config: ImageConfigView,
  prompt: string,
  references: readonly ReferenceView[] = [],
  isEdit = false,
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
  if (isEdit) params.extras = { mode: 'edit' };
  return params;
}
