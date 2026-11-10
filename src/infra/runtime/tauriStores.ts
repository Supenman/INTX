import type { ProviderConfig } from '@/domain';
import type { BlobStore, ProviderStore } from '@/app/stores/providerStore';

/**
 * Tauri 宿主下的存储实现。
 *
 * 桌面优先的落点：
 *   <appDataDir>/config.json      厂商配置（含 key，仅本机）
 *   <appDataDir>/blobs/ab/<hash>.png   产物字节，按内容寻址
 *
 * 依赖已在 package.json 里正式安装，capability 见 src-tauri/capabilities/default.json。
 * 这里用**字符串字面量**的动态 import，让 Vite 真正把包打进产物：
 * 早期为了避免「包没装时打包报错」曾用变量模块名 + @vite-ignore，
 * 但那样浏览器/webview 里就是一个无法解析的裸模块说明符，loadFs() 永远返回 null，
 * 桌面端所有存储会静默降级——壳建好了却等于没接上。
 * 浏览器下 isTauri() 为 false，根本不会调用 loadFs()，动态 chunk 不被加载；
 * 且 @tauri-apps/api/core 只在函数内访问 window.__TAURI_INTERNALS__，顶层 import 是安全的。
 */

export interface FsModule {
  BaseDirectory: { AppData: number };
  exists(path: string, opts?: { baseDir?: number }): Promise<boolean>;
  readTextFile(path: string, opts?: { baseDir?: number }): Promise<string>;
  writeTextFile(path: string, data: string, opts?: { baseDir?: number }): Promise<void>;
  writeFile(path: string, data: Uint8Array, opts?: { baseDir?: number }): Promise<void>;
  readFile(path: string, opts?: { baseDir?: number }): Promise<Uint8Array>;
  remove(path: string, opts?: { baseDir?: number }): Promise<void>;
  mkdir(path: string, opts?: { baseDir?: number; recursive?: boolean }): Promise<void>;
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * 确保 $APPDATA 存在。
 *
 * Tauri 官方文档明确写着：AppConfig/AppData 等应用目录「需要应用在运行时自行创建」，
 * 否则第一次写文件就会失败。之前 tauriProviderStore.save() 和 tauriTaskLog.append()
 * 直接往根目录写 config.json / tasks.jsonl，从没建过目录——浏览器回退用 IndexedDB
 * 所以一直没暴露，接上桌面壳才会炸。
 *
 * 用 mkdir('blobs', {recursive:true}) 而不是对空路径 mkdir：递归会连带创建 $APPDATA，
 * 且 'blobs' 是 scope 内明确的相对路径，不会触发路径越权。幂等，可重复调用。
 */
export async function ensureAppData(): Promise<boolean> {
  const fs = await loadFs();
  if (!fs) return false;
  try {
    await fs.mkdir('blobs', { baseDir: fs.BaseDirectory.AppData, recursive: true });
    return true;
  } catch {
    return false;
  }
}

export async function loadFs(): Promise<FsModule | null> {
  try {
    // 字面量而非变量：Vite 需要能静态解析，才能在产物里生成可加载的 chunk。
    const mod: unknown = await import('@tauri-apps/plugin-fs');
    return mod as FsModule;
  } catch {
    return null;
  }
}

const CONFIG_PATH = 'config.json';

export async function tauriProviderStore(): Promise<ProviderStore> {
  const fs = await loadFs();
  return {
    async load() {
      if (!fs) return [];
      const opt = { baseDir: fs.BaseDirectory.AppData };
      if (!(await fs.exists(CONFIG_PATH, opt))) return [];
      const raw = await fs.readTextFile(CONFIG_PATH, opt);
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as ProviderConfig[]) : [];
    },
    async save(configs) {
      if (!fs) throw new Error('未安装 @tauri-apps/plugin-fs，无法写入配置文件');
      await fs.writeTextFile(CONFIG_PATH, JSON.stringify(configs, null, 2), { baseDir: fs.BaseDirectory.AppData });
    },
  };
}

export async function openTauriBlobStore(): Promise<BlobStore> {
  const fs = await loadFs();
  const opt = fs ? { baseDir: fs.BaseDirectory.AppData } : undefined;

  const ensure = async (path: string) => {
    if (!fs || !opt) return;
    const dir = path.slice(0, path.lastIndexOf('/'));
    if (dir && !(await fs.exists(dir, opt))) {
      await fs.mkdir(dir, { ...opt, recursive: true });
    }
  };

  return {
    async put(path, bytes, _mime) {
      if (!fs || !opt) throw new Error('未安装 @tauri-apps/plugin-fs，无法写入产物');
      if (await fs.exists(path, opt)) return; // 内容寻址：已存在即同一份，不重复写
      await ensure(path);
      await fs.writeFile(path, new Uint8Array(bytes), opt);
    },
    async get(path) {
      if (!fs || !opt) return null;
      if (!(await fs.exists(path, opt))) return null;
      const data = await fs.readFile(path, opt);
      return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    },
    async remove(path) {
      if (!fs || !opt) return;
      if (await fs.exists(path, opt)) await fs.remove(path, opt);
    },
    async has(path) {
      if (!fs || !opt) return false;
      return fs.exists(path, opt);
    },
  };
}
