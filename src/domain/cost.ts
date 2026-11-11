import type { CostRecord, TaskKind } from './task/model';
import type { ModelPricing } from './provider/model';

/**
 * 成本估算。
 *
 * 公司内部分摊成本靠的是「按节点/任务/厂商相对分摊」，趋势和量级对就行，
 * 不需要逐 token 精确到分。上游接口几乎不返回 cost，硬要拿反而引入脆弱依赖，
 * 所以这里走「本地单价 × 产出数量」的估算。
 *
 * 铁律：没有可估数据就返回 null，绝不编一个 0 假装免费。
 * 那样会让审计台账里「本次花费 ¥0.00」和「没配单价」混为一谈，反而误导。
 */

export interface EstimateCostInput {
  /** 模型单价；没有就是 undefined，直接返回 null */
  pricing?: ModelPricing;
  kind: TaskKind;
  /** 本次成功产出的数量（图/视频的张数；文本这里是估算用不到，见下） */
  outputCount: number;
  /** 模型标识，只用于 cost.basis 的回溯说明 */
  modelId: string;
  /** 文本生成时用于估算 token 的提示词字符数；图片/视频忽略 */
  promptChars?: number;
}

/** 中文字符约 1 token，英文约 4 字符 1 token，这里统一按 4 字符 ≈ 1 token 估算。 */
function estimateTokens(promptChars: number): number {
  return Math.max(1, Math.ceil(promptChars / 4));
}

/** 金额保留两位小数以内的有效数字，去掉浮点噪声（1.0000000002 → 1）。 */
function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * 估算一次生成的成本。返回 null 的情形：
 *  - pricing 没配
 *  - 是图片/视频但没有 perImage 单价
 *  - 是文本但没有 per1kTokens，或没给 promptChars 无法估 token
 */
export function estimateGenerationCost(input: EstimateCostInput): CostRecord | null {
  const { pricing, kind, outputCount, modelId } = input;
  if (!pricing) return null;

  if (kind === 'text') {
    if (pricing.per1kTokens === undefined) return null;
    if (input.promptChars === undefined) return null;
    const tokens = estimateTokens(input.promptChars);
    const amount = round((pricing.per1kTokens * tokens) / 1000);
    return {
      amount,
      currency: pricing.currency,
      basis: `text ≈ ${tokens} tokens @ ${modelId}`,
    };
  }

  // image / video
  if (pricing.perImage === undefined) return null;
  const amount = round(pricing.perImage * outputCount);
  return {
    amount,
    currency: pricing.currency,
    basis: `${kind} × ${outputCount} @ ${modelId}`,
  };
}
