import { describe, expect, it } from 'vitest';

import { MAX_IMAGE_SLOTS, imageSlotCount, runImageSlots } from './imageSlots';

describe('槽位数量归一', () => {
  it('字符串、数字都认，超出范围夹到 1..15', () => {
    expect(imageSlotCount('3')).toBe(3);
    expect(imageSlotCount(2.7)).toBe(2);
    expect(imageSlotCount(-4)).toBe(4);
    expect(imageSlotCount(0)).toBe(1);
    expect(imageSlotCount(99)).toBe(MAX_IMAGE_SLOTS);
  });

  it('空值、非法值退回一张，不会变成 0 张', () => {
    for (const value of [undefined, null, '', 'abc', NaN, {}]) expect(imageSlotCount(value)).toBe(1);
  });
});

describe('逐张提交', () => {
  it('按槽位数量逐张提交，结果保持槽位顺序', async () => {
    const submitted: number[] = [];
    const outcomes = await runImageSlots({
      count: 3,
      submit: async (index) => {
        submitted.push(index);
        await new Promise((resolve) => setTimeout(resolve, (3 - index) * 5));
        return `img-${index}`;
      },
    });
    expect(submitted).toEqual([0, 1, 2]);
    expect(outcomes).toEqual([
      { index: 0, ok: true, image: 'img-0' },
      { index: 1, ok: true, image: 'img-1' },
      { index: 2, ok: true, image: 'img-2' },
    ]);
  });

  it('一张失败不影响其他张，也不让整批抛出', async () => {
    const outcomes = await runImageSlots({
      count: 3,
      submit: async (index) => {
        if (index === 1) throw new Error('上游失败');
        return index;
      },
    });
    expect(outcomes.map((outcome) => outcome.ok)).toEqual([true, false, true]);
    const failed = outcomes[1]!;
    expect(failed.ok).toBe(false);
    expect(!failed.ok && (failed.error as Error).message).toBe('上游失败');
    expect((outcomes[2] as { image: number }).image).toBe(2);
  });

  it('每个槽位只回调一次 onSettled，成败都回调', async () => {
    const settled: number[] = [];
    await runImageSlots({
      count: 4,
      submit: async (index) => {
        if (index % 2) throw new Error('失败');
        return index;
      },
      onSettled: (outcome) => settled.push(outcome.index),
    });
    expect(settled.sort()).toEqual([0, 1, 2, 3]);
  });

  it('数量越界时只提交夹紧后的张数', async () => {
    const big = await runImageSlots({ count: 99, submit: async (index) => index });
    expect(big).toHaveLength(MAX_IMAGE_SLOTS);
    const zero = await runImageSlots({ count: 0, submit: async (index) => index });
    expect(zero).toHaveLength(1);
  });
});
