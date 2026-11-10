import type { ProviderConfig } from '@/domain';
import type { BlobStore, ProviderStore } from '@/app/stores/providerStore';

/**
 * Tauri 宿主下的存储实现。
 *
 * 桌面优先的落点：
 *   <appDataDir>/config.json      厂商配置（含 key，仅本机）
 *   <appDataDir>/blobs/ab/<hash>.png   产物字节，按内容寻址
 *
 * 用动态 import 是为了浏览器构建时不必安装 @tauri-apps/plugin-fs/plugin-store
 * 也能跑（未安装则回退，不会在打包阶段报错）。
 * 真正的桌面构建需要：
 *   pnpm add @tauri-apps/api @tauri-apps/plugin-fs @tauri-apps/plugin-store
 *   并在 tauri.conf.json 里开放相应 capability 权限。
 */

interface FsModule {
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

async function loadFs(): Promise<FsModule | null> {
  try {
    // 用变量做模块名：未安装该包时打包器不会报解析失败，
    // 浏览器构建与 CI 都不需要为了桌面壳去装依赖。
    const name = '@tauri-apps/plugin-fs';
    const mod: unknown = await import(/* @vite-ignore */ name);
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
