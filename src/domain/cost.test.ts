import { describe, expect, it } from 'vitest';
import { estimateGenerationCost } from './cost';
import type { ModelPricing } from './provider/model';

describe('estimateGenerationCost', () => {
  const imagePricing: ModelPricing = { perImage: 0.04, currency: 'USD' };
  const textPricing: ModelPricing = { per1kTokens: 0.01, currency: 'CNY' };

  it('按单价 × 张数估算图片成本', () => {
    const cost = estimateGenerationCost({
      pricing: imagePricing,
      kind: 'image',
      outputCount: 4,
      modelId: 'demo/image',
    });
    expect(cost).toEqual({ amount: 0.16, currency: 'USD', basis: 'image × 4 @ demo/image' });
  });

  it('分镜多格按总张数累加', () => {
    const cost = estimateGenerationCost({
      pricing: imagePricing,
      kind: 'image',
      outputCount: 9,
      modelId: 'seedream',
    });
    expect(cost?.amount).toBe(0.36);
  });

  it('文本按字符数估算 token 成本', () => {
    const cost = estimateGenerationCost({
      pricing: textPricing,
      kind: 'text',
      outputCount: 1,
      modelId: 'gpt-4o-mini',
      promptChars: 400,
    });
    // 400 字符 ≈ 100 token，× 0.01/1k = 0.001
    expect(cost).toEqual({ amount: 0.001, currency: 'CNY', basis: 'text ≈ 100 tokens @ gpt-4o-mini' });
  });

  it('没有单价返回 null（不编造 0）', () => {
    expect(
      estimateGenerationCost({ kind: 'image', outputCount: 1, modelId: 'x' }),
    ).toBeNull();
  });

  it('有图片单价但缺 perImage 返回 null', () => {
    expect(
      estimateGenerationCost({
        pricing: { currency: 'USD' },
        kind: 'image',
        outputCount: 1,
        modelId: 'x',
      }),
    ).toBeNull();
  });

  it('文本缺 per1kTokens 返回 null', () => {
    expect(
      estimateGenerationCost({
        pricing: { perImage: 0.04, currency: 'USD' },
        kind: 'text',
        outputCount: 1,
        modelId: 'x',
        promptChars: 400,
      }),
    ).toBeNull();
  });

  it('文本缺 promptChars 无法估 token，返回 null', () => {
    expect(
      estimateGenerationCost({
        pricing: textPricing,
        kind: 'text',
        outputCount: 1,
        modelId: 'x',
      }),
    ).toBeNull();
  });

  it('视频复用 perImage 单价', () => {
    const cost = estimateGenerationCost({
      pricing: { perImage: 0.5, currency: 'USD' },
      kind: 'video',
      outputCount: 1,
      modelId: 'kling',
    });
    expect(cost?.basis).toBe('video × 1 @ kling');
    expect(cost?.amount).toBe(0.5);
  });
});
