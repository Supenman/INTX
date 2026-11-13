/**
 * 图片分槽执行：画布和工作台都用它跑「一次要 N 张」。
 *
 * 现状（必须保持不变）：每个槽位是**独立的一次请求**，一张失败不影响其他张。
 * 因此这里只负责计数收敛、并发提交和逐槽结果收集，不在这里发请求、不碰 UI、
 * 也不知道厂商协议——提交函数由调用方注入，测试用假实现即可。
 */

export const MAX_IMAGE_SLOTS = 15;

export function imageSlotCount(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(MAX_IMAGE_SLOTS, Math.floor(Math.abs(n))));
}

export type ImageSlotOutcome<T> =
  | { index: number; ok: true; image: T }
  | { index: number; ok: false; error: unknown };

export interface RunImageSlotsInput<T> {
  count: number;
  submit: (index: number) => Promise<T>;
  /** 每个槽位结束时调用一次，用于逐槽更新界面。 */
  onSettled?: (outcome: ImageSlotOutcome<T>) => void;
}

/**
 * 并发跑完所有槽位，按 index 升序返回结果。
 * 任何槽位失败都只记录在该槽位，不会让整批 Promise 提前 reject。
 */
export async function runImageSlots<T>(input: RunImageSlotsInput<T>): Promise<Array<ImageSlotOutcome<T>>> {
  const count = imageSlotCount(input.count);
  const outcomes = await Promise.all(
    Array.from({ length: count }, async (_, index): Promise<ImageSlotOutcome<T>> => {
      let outcome: ImageSlotOutcome<T>;
      try {
        outcome = { index, ok: true, image: await input.submit(index) };
      } catch (error) {
        outcome = { index, ok: false, error };
      }
      input.onSettled?.(outcome);
      return outcome;
    }),
  );
  return outcomes;
}
