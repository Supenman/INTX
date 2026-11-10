/**
 * 图片解码 / Canvas 绘制的公共薄封装。
 *
 * 分镜拼图、素材编辑、超分参考实现都要「读字节 → 解码 → 画到 canvas → 编码 PNG」。
 * 上一轮拼图里各写了一份 loadImage/toPng，抽出共用：同一份语义只有一个来源，
 * 别让多处对 ObjectURL 的释放时机各写各的。
 *
 * 放在 infra 而不是 app：这几个函数用的是浏览器 DOM API（Image / Canvas / URL），
 * 属于宿主能力。infra 的适配器要用它时不会造成 infra → app 的反向依赖。
 */

/** 用 HTMLImageElement 解码，比 createImageBitmap 兼容性好，且不用手动 close。 */
export function decodeImage(bytes: ArrayBuffer, mime: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片解码失败'));
    };
    img.src = url;
  });
}

export function makeCanvas(width: number, height: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器不支持 Canvas 2D');
  return { canvas, ctx };
}

export function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 编码失败'))), 'image/png');
  });
}
