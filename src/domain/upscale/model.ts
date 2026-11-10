import type { Result } from '../shared/result';

/**
 * 超分（Super Resolution）领域契约。
 *
 * 与「生成」不同：超分是本地图像处理，吃一张图的字节、吐一张更大的图的字节，
 * 不联网、不需要 API Key、也不编造进度。契约刻意做成这个形状，是为了让
 * Tauri 本地 ONNX / 浏览器 WASM / 服务端推理三种后端都实现同一个接口，
 * 上层只问「能不能用」和「放大几倍」，不关心模型在哪跑。
 *
 * 选定的正式路线是 **Tauri 本地 ONNX**（桌面优先，不引入服务端）。
 * 但模型文件与 Rust 侧推理属于桌面壳的最后一公里，本轮先把契约和可用性探测落地；
 * 浏览器 / 沙箱下自动回退到参考重采样实现，用来跑通完整闭环。
 * 参考实现如实标注 ai = false，绝不把插值放大冒充 AI 超分。
 */

export const UPSCALE_SCALES = [2, 4] as const;
export type UpscaleScale = (typeof UPSCALE_SCALES)[number];

export function isUpscaleScale(value: unknown): value is UpscaleScale {
  return value === 2 || value === 4;
}

/** 整张图按整数倍放大，输出尺寸必须可预期，不允许偷偷裁切或留黑边。 */
export function upscaledSize(
  width: number,
  height: number,
  scale: UpscaleScale,
): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export interface UpscaleRequest {
  bytes: ArrayBuffer;
  mime: string;
  scale: UpscaleScale;
  /**
   * 资产在项目目录里的相对路径。本地文件后端（Tauri ONNX）直接按路径读，
   * 不必把几十 MB 字节通过 IPC 传来传去；浏览器后端忽略它。
   */
  sourcePath?: string;
  signal?: AbortSignal;
}

/** 适配器产物：纯字节 + 尺寸。落盘与去重交给 app 层，适配器不碰资产库。 */
export interface UpscaleImage {
  bytes: ArrayBuffer;
  mime: string;
  width: number;
  height: number;
}

export type UpscaleUnavailableCode = 'no_runtime' | 'no_model' | 'aborted' | 'failed';

export interface UpscaleUnavailable {
  code: UpscaleUnavailableCode;
  message: string;
  /** 下一步动作，UI 直接显示。只说「不可用」是不够的。 */
  hint?: string;
}

/** 探测结果：缺什么要明确说出来，并且带上补齐方式。 */
export type UpscaleAvailability = { ok: true } | { ok: false; missing: UpscaleUnavailable };

export interface UpscaleAdapter {
  id: string;
  label: string;
  /** 是否 AI 超分。false = 参考 / 回退实现，UI 必须如实标注。 */
  ai: boolean;
  available(): Promise<UpscaleAvailability>;
  upscale(req: UpscaleRequest): Promise<Result<UpscaleImage, UpscaleUnavailable>>;
}
