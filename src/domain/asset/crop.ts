/**
 * 裁切几何的唯一真相。
 *
 * 这里只做纯数学：所有矩形都用**归一化坐标**（0–1，相对原图），
 * 因为编辑器里的图是按显示尺寸缩放过的，而导出必须按原图像素算。
 * 用归一化坐标，显示尺寸怎么变都不影响落盘结果。
 *
 * 容易搞错的一点：`16:9` 说的是**输出像素**的宽高比，不是归一化宽高比。
 * 一张 1600×900 的图上，1:1 的输出框在归一化空间里是 900:1600，
 * 不是 1:1。这个换算集中在 normalizedRatio() 里，别在 UI 里各算一遍。
 */

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 小于这个比例就当误触，避免导出一张 1px 的图。 */
export const MIN_CROP_SIZE = 0.02;

export const ASPECT_PRESETS = [
  { id: 'free', label: '自由' },
  { id: '1:1', label: '1:1' },
  { id: '16:9', label: '16:9' },
  { id: '9:16', label: '9:16' },
  { id: '4:3', label: '4:3' },
] as const;

export type AspectId = (typeof ASPECT_PRESETS)[number]['id'];

/** free 返回 null；其余返回「输出宽 / 输出高」。 */
export function aspectValue(id: AspectId): number | null {
  if (id === 'free') return null;
  const [w, h] = id.split(':').map(Number);
  if (!w || !h || !Number.isFinite(w) || !Number.isFinite(h)) return null;
  return w / h;
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

/**
 * 归一化空间里，某个输出比例对应的「宽 / 高」。
 * (w*imageW)/(h*imageH) = aspect  =>  w/h = aspect*imageH/imageW
 */
export function normalizedRatio(aspect: number, imageW: number, imageH: number): number {
  if (aspect <= 0 || imageW <= 0 || imageH <= 0) return 1;
  return (aspect * imageH) / imageW;
}

/** 把任意拖拽方向（负宽高）翻正，钳到图内，并保证最小尺寸。 */
export function normalizeCrop(rect: CropRect): CropRect {
  let x = clamp(rect.x, 0, 1);
  let y = clamp(rect.y, 0, 1);
  let x2 = clamp(rect.x + rect.width, 0, 1);
  let y2 = clamp(rect.y + rect.height, 0, 1);
  if (x2 < x) [x, x2] = [x2, x];
  if (y2 < y) [y, y2] = [y2, y];
  let width = x2 - x;
  let height = y2 - y;

  if (width < MIN_CROP_SIZE) {
    width = MIN_CROP_SIZE;
    x = Math.min(x, 1 - width);
  }
  if (height < MIN_CROP_SIZE) {
    height = MIN_CROP_SIZE;
    y = Math.min(y, 1 - height);
  }
  return { x, y, width: Math.min(width, 1 - x), height: Math.min(height, 1 - y) };
}

/**
 * 把矩形贴回图内。宽高同乘一个缩放因子 —— 分别 clamp 到 1 会把
 * 「宽图 + 竖比例」压成扁框，比例就不对了。
 */
function fitInImage(rect: CropRect): CropRect {
  const rawW = Math.max(0, rect.width);
  const rawH = Math.max(0, rect.height);
  const scale = Math.min(1, rawW > 1 ? 1 / rawW : 1, rawH > 1 ? 1 / rawH : 1);
  const width = rawW * scale;
  const height = rawH * scale;
  return {
    x: clamp(rect.x, 0, Math.max(0, 1 - width)),
    y: clamp(rect.y, 0, Math.max(0, 1 - height)),
    width,
    height,
  };
}

/**
 * 切换比例时重算矩形：以原矩形中心为锚，取能包住它的最小符合比例框，
 * 再整体缩到不越界。中心锚比"从左上角长"更接近用户对取景框的预期。
 */
export function fitAspect(rect: CropRect, aspect: number | null, imageW: number, imageH: number): CropRect {
  const base = normalizeCrop(rect);
  if (aspect === null || aspect <= 0) return base;
  const k = normalizedRatio(aspect, imageW, imageH);
  const cx = base.x + base.width / 2;
  const cy = base.y + base.height / 2;

  let width = Math.max(base.width, base.height * k);
  let height = width / k;
  // 以中心为锚时，可用空间是中心到最近边的两倍
  const maxW = 2 * Math.min(cx, 1 - cx);
  const maxH = 2 * Math.min(cy, 1 - cy);
  const scale = Math.min(1, maxW / width, maxH / height);
  width = Math.max(MIN_CROP_SIZE, width * scale);
  height = width / k;

  return fitInImage({
    x: cx - width / 2,
    y: cy - height / 2,
    width,
    height,
  });
}

/**
 * 拖拽画框：起点是锚，框朝鼠标方向长。
 *
 * 为什么不用 fitAspect：拖拽时用户盯着鼠标，框必须跟着走；
 * 中心锚会让框往反方向扩，手感是"往左拖框却往右长"。
 */
export function cropFromDrag(
  start: NormalizedPoint,
  end: NormalizedPoint,
  aspect: number | null,
  imageW: number,
  imageH: number,
): CropRect {
  const s = { x: clamp(start.x, 0, 1), y: clamp(start.y, 0, 1) };
  const e = { x: clamp(end.x, 0, 1), y: clamp(end.y, 0, 1) };
  const free = normalizeCrop({ x: s.x, y: s.y, width: e.x - s.x, height: e.y - s.y });
  if (aspect === null || aspect <= 0) return free;

  const k = normalizedRatio(aspect, imageW, imageH);
  let width = Math.max(free.width, free.height * k);
  let height = width / k;
  const dirX = e.x >= s.x ? 1 : -1;
  const dirY = e.y >= s.y ? 1 : -1;

  // 锚点到同侧图像边界的余量，越界就按比例缩，且始终贴着锚点
  const roomX = dirX > 0 ? 1 - s.x : s.x;
  const roomY = dirY > 0 ? 1 - s.y : s.y;
  const scale = Math.min(1, roomX / width, roomY / height);
  width = Math.max(MIN_CROP_SIZE, width * scale);
  height = width / k;

  const x = dirX > 0 ? s.x : s.x - width;
  const y = dirY > 0 ? s.y : s.y - height;
  return fitInImage({ x, y, width, height });
}

/** 归一化矩形 → 原图像素矩形。整数、至少 1px、绝不越界。 */
export function cropToPixels(rect: CropRect, imageW: number, imageH: number): PixelRect {
  const w = Math.max(1, Math.floor(imageW));
  const h = Math.max(1, Math.floor(imageH));
  const normalized = normalizeCrop(rect);
  const x = Math.min(w - 1, Math.max(0, Math.round(normalized.x * w)));
  const y = Math.min(h - 1, Math.max(0, Math.round(normalized.y * h)));
  const width = Math.max(1, Math.min(w - x, Math.round(normalized.width * w)));
  const height = Math.max(1, Math.min(h - y, Math.round(normalized.height * h)));
  return { x, y, width, height };
}
