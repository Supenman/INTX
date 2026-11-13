/**
 * 图片生成能力合同：设置面板和请求构建读同一份事实。
 *
 * 只描述**当前适配器实际实现并会发送**的能力，不猜测厂商理论上限。
 * - `supported`：当前请求路径确实会带上这个参数/输入。
 * - `unimplemented`：协议或适配器还没接，界面应置灰并说明。
 * - `unsupported`：该协议没有这个概念。
 *
 * 这是纯函数：输入只有 apiFormat、baseUrl 和是否有自定义脚本，不读 store、
 * 不发请求，测试可以在 node 环境直接跑。
 */
import { isModelScopeEndpoint } from './endpoints';

export type CapabilityState = 'supported' | 'unimplemented' | 'unsupported';

export type ImageRequestKind = 'modelscope-async' | 'gemini-generate' | 'script' | 'openai-images';

export interface ImageCapabilities {
  kind: ImageRequestKind;
  quality: CapabilityState;
  /** 尺寸 / 分辨率 / 宽高比共用同一套参数，状态一致。 */
  size: CapabilityState;
  background: CapabilityState;
  referenceImages: CapabilityState;
  /** 单次请求最多要求几张。多张由上层拆成多次请求时为 1。 */
  perRequestMax: number;
  /** 应用层多张依赖逐张提交（每张单独计费），不是协议一次出 N 张。 */
  separateRequestsForCount: boolean;
  /** 提交后返回上游任务号，可凭号续查。 */
  asyncTask: boolean;
  /** 当前是否实现协议级上游取消。 */
  upstreamCancel: boolean;
}

export interface ImageCapabilityInput {
  apiFormat: 'openai' | 'gemini';
  baseUrl: string;
  /** 渠道模型配置了自定义脚本：参数原样交给脚本，由脚本决定。 */
  hasScript: boolean;
}

const supported = (base: Omit<ImageCapabilities, 'quality' | 'size' | 'background' | 'referenceImages'>): ImageCapabilities => ({
  ...base,
  quality: 'supported',
  size: 'supported',
  background: 'supported',
  referenceImages: 'supported',
});

export function resolveImageCapabilities(input: ImageCapabilityInput): ImageCapabilities {
  // 自定义脚本走 runModelPlugin，尺寸/质量/透明/参考图都由脚本消费。
  if (input.hasScript) {
    return supported({
      kind: 'script',
      perRequestMax: 15,
      separateRequestsForCount: false,
      asyncTask: false,
      upstreamCancel: false,
    });
  }

  // ModelScope API-Inference 异步出图：当前只发 model + prompt。
  // 参考图路径未实现（适配器会本地拒绝），不谎称已支持。
  if (isModelScopeEndpoint(input.baseUrl)) {
    return {
      kind: 'modelscope-async',
      quality: 'unimplemented',
      size: 'unimplemented',
      background: 'unimplemented',
      referenceImages: 'unimplemented',
      perRequestMax: 1,
      separateRequestsForCount: true,
      asyncTask: true,
      upstreamCancel: false,
    };
  }

  if (input.apiFormat === 'gemini') {
    return {
      kind: 'gemini-generate',
      // 尺寸/比例会转成 aspectRatio + imageSize；质量和透明背景没有对应字段。
      quality: 'unimplemented',
      size: 'supported',
      background: 'unimplemented',
      referenceImages: 'supported',
      perRequestMax: 1,
      separateRequestsForCount: true,
      asyncTask: false,
      upstreamCancel: false,
    };
  }

  return supported({
    kind: 'openai-images',
    perRequestMax: 15,
    separateRequestsForCount: false,
    asyncTask: false,
    upstreamCancel: false,
  });
}

/** 界面提示用：当前接入不会发送哪些设置。顺序稳定，便于快照与文案拼接。 */
export function unsupportedImageFields(capabilities: ImageCapabilities): Array<'quality' | 'size' | 'background'> {
  const fields: Array<'quality' | 'size' | 'background'> = [];
  if (capabilities.quality !== 'supported') fields.push('quality');
  if (capabilities.size !== 'supported') fields.push('size');
  if (capabilities.background !== 'supported') fields.push('background');
  return fields;
}
