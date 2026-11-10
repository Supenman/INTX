import { err, ok, type Result, type UpscaleAdapter, type UpscaleAvailability, type UpscaleImage, type UpscaleRequest, type UpscaleUnavailable } from '@/domain';
import { isTauri, loadFs } from '@/infra/runtime/tauriStores';

/**
 * 正式路线：Tauri 本地 ONNX 超分（Real-ESRGAN 系）。
 *
 * 桌面优先的项目不该为了放大一张图引入服务端，模型与推理都留在本机。
 * 但这条路线有三件前置条件，缺一不可，而且都能被探测出来：
 *   1. 跑在 Tauri 壳里（不是浏览器）
 *   2. 装了 @tauri-apps/plugin-fs 并开放 capability
 *   3. <appDataDir>/models/ 下有模型文件
 *
 * 本轮**只落地契约与探测**：Rust 侧的 `intx_upscale` 命令属于桌面壳的
 * 最后一公里，还没实现；浏览器 / 沙箱环境里这个后端永远返回 no_runtime，
 * 由参考实现接管。upscale() 里保留真实调用形状，条件齐全时才会走到，
 * 任何失败都归类成带 hint 的 no_runtime，不静默、不假装成功。
 */

const MODEL_DIR = 'models';
const MODEL_FILE = 'realesrgan-x4plus.onnx';
const MODEL_PATH = `${MODEL_DIR}/${MODEL_FILE}`;

/** 桌面侧命令的返回形状；Rust 实现需按此返回。 */
interface OnnxReply {
  /** 放大后文件相对 appDataDir 的路径 */
  path: string;
  width: number;
  height: number;
}

async function probe(): Promise<UpscaleAvailability> {
  if (!isTauri()) {
    return {
      ok: false,
      missing: {
        code: 'no_runtime',
        message: '当前运行在浏览器 / 开发环境',
        hint: '用 Tauri 桌面壳启动后才会启用本地 ONNX 推理',
      },
    };
  }
  const fs = await loadFs();
  if (!fs) {
    return {
      ok: false,
      missing: {
        code: 'no_runtime',
        message: '未安装 @tauri-apps/plugin-fs',
        hint: 'pnpm add @tauri-apps/api @tauri-apps/plugin-fs，并在 capability 里放行',
      },
    };
  }
  let hasModel = false;
  try {
    hasModel = await fs.exists(MODEL_PATH, { baseDir: fs.BaseDirectory.AppData });
  } catch {
    hasModel = false;
  }
  if (!hasModel) {
    return {
      ok: false,
      missing: {
        code: 'no_model',
        message: '缺少超分模型文件',
        hint: `把 ${MODEL_FILE} 放到 <appDataDir>/${MODEL_PATH}（模型不随代码库分发）`,
      },
    };
  }
  return { ok: true };
}

export const tauriOnnxAdapter: UpscaleAdapter = {
  id: 'tauri-onnx',
  label: '本地 ONNX · Real-ESRGAN',
  ai: true,
  available: probe,

  async upscale(req: UpscaleRequest): Promise<Result<UpscaleImage, UpscaleUnavailable>> {
    const state = await probe();
    if (!state.ok) return err(state.missing);
    if (req.signal?.aborted) return err({ code: 'aborted', message: '已取消放大' });

    try {
      // 字面量动态 import：让 Vite 把 @tauri-apps/api/core 打进可加载的 chunk。
      // 变量模块名 + @vite-ignore 会留下一个 webview 无法解析的裸说明符。
      const mod: unknown = await import('@tauri-apps/api/core');
      const invoke = (mod as { invoke?: (cmd: string, args: Record<string, unknown>) => Promise<unknown> }).invoke;
      if (!invoke) {
        return err({ code: 'no_runtime', message: '未找到 Tauri invoke', hint: 'pnpm add @tauri-apps/api' });
      }

      const reply = (await invoke('intx_upscale', {
        path: req.sourcePath ?? '',
        scale: req.scale,
        mime: req.mime,
      })) as OnnxReply;

      const fs = await loadFs();
      if (!fs || !reply?.path) {
        return err({
          code: 'no_runtime',
          message: 'Rust 侧 intx_upscale 命令还没有实现',
          hint: '桌面侧需要补上 ONNX 推理命令，返回 { path, width, height }',
        });
      }
      const data = await fs.readFile(reply.path, { baseDir: fs.BaseDirectory.AppData });
      return ok({
        bytes: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
        mime: 'image/png',
        width: reply.width,
        height: reply.height,
      });
    } catch (e) {
      return err({
        code: 'no_runtime',
        message: `本地推理调用失败：${e instanceof Error ? e.message : '未知错误'}`,
        hint: '确认 Rust 侧已实现 intx_upscale 命令，且 onnxruntime 可用',
      });
    }
  },
};
