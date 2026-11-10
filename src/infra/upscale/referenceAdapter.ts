import { err, ok, upscaledSize, type Result, type UpscaleAdapter, type UpscaleImage, type UpscaleRequest, type UpscaleUnavailable } from '@/domain';
import { decodeImage, makeCanvas, toPng } from '@/infra/imaging/canvas';

/**
 * 参考重采样实现 —— 用途是**跑通闭环**，不是交付 AI 超分。
 *
 * 正式路线是 Tauri 本地 ONNX，但它需要桌面壳和一个模型文件。
 * 在没有这些条件的环境（浏览器、CI、沙箱）里，这个实现顶上：
 * 同样吃字节、同样走 AbortSignal、同样报真实尺寸，让上层的任务状态机、
 * 资产落盘、刷新恢复、导出都能被验证。
 *
 * ai = false 是硬约束：UI 必须写清「演示级 / 非 AI」，不许把插值放大
 * 包装成超分糊弄用户。旧代码最擅长编进度和假结果，这里不重蹈覆辙。
 */
export const referenceResampleAdapter: UpscaleAdapter = {
  id: 'reference-resample',
  label: '参考重采样（演示级，非 AI 超分）',
  ai: false,

  async available() {
    return { ok: true } as const;
  },

  async upscale(req: UpscaleRequest): Promise<Result<UpscaleImage, UpscaleUnavailable>> {
    if (req.signal?.aborted) return err({ code: 'aborted', message: '已取消放大' });
    try {
      const img = await decodeImage(req.bytes, req.mime);
      if (req.signal?.aborted) return err({ code: 'aborted', message: '已取消放大' });

      const { width, height } = upscaledSize(img.naturalWidth, img.naturalHeight, req.scale);
      const { canvas, ctx } = makeCanvas(width, height);
      // 高质量插值，至少不是 nearest 的马赛克
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);

      const blob = await toPng(canvas);
      if (req.signal?.aborted) return err({ code: 'aborted', message: '已取消放大' });
      return ok({ bytes: await blob.arrayBuffer(), mime: 'image/png', width, height });
    } catch (e) {
      return err({ code: 'failed', message: e instanceof Error ? e.message : '放大失败' });
    }
  },
};
