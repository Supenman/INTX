import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 桌面壳配置对齐检查。
 *
 * 这些配置此前一直只是「文档里说要在 capability 放行」，从没有人验证过。
 * 风险很具体：前端往 tauriStores.ts 里加一个 fs.readDir()，忘了配权限，
 * 浏览器回退一切正常（因为走 IndexedDB），只有打包成桌面应用后才静默失败。
 *
 * 所以这里直接从**源码**提取真正用到的 fs 命令，反推应该有哪些权限，
 * 再拿去和 capability / tauri.conf.json / Cargo.toml 逐项对账。
 * 新增 fs 调用会立刻让测试变红，不靠人记得同步两个文件。
 */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (rel: string) => readFileSync(ROOT + rel, 'utf8');
const readJson = <T>(rel: string): T => JSON.parse(read(rel)) as T;

interface Capability {
  identifier: string;
  windows: string[];
  permissions: (string | { identifier: string; allow?: string[] })[];
}

interface TauriConf {
  identifier: string;
  build: { devUrl: string; frontendDist: string };
  app: { windows: { label: string }[] };
  bundle: { icon: string[] };
}

/** 前端桌面侧会 import fs 的文件；新增文件也要加进这里，否则检查覆盖不到。 */
const DESKTOP_FS_SOURCES = [
  'src/infra/runtime/tauriStores.ts',
  'src/infra/repository/taskLog.ts',
  'src/infra/upscale/tauriOnnxAdapter.ts',
];

/** camelCase 命令 → Tauri 权限标识符（kebab-case）。 */
function commandToPermission(cmd: string): string {
  return 'fs:allow-' + cmd.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/** 扫描源码里所有 `fs.<name>(` 调用，BaseDirectory.AppData 不是调用不会被匹配。 */
function usedFsCommands(): string[] {
  const set = new Set<string>();
  for (const rel of DESKTOP_FS_SOURCES) {
    const text = read(rel);
    for (const m of text.matchAll(/\bfs\.([A-Za-z]+)\s*\(/g)) {
      if (m[1]) set.add(m[1]);
    }
  }
  return [...set].sort();
}

const cap = readJson<Capability>('src-tauri/capabilities/default.json');
const conf = readJson<TauriConf>('src-tauri/tauri.conf.json');

/** 权限项可能是字符串或带 scope 的对象。 */
function permissionId(p: Capability['permissions'][number]): string {
  return typeof p === 'string' ? p : p.identifier;
}

describe('桌面 capability 与代码实际用法对齐', () => {
  it('源码用到的每个 fs 命令都有对应权限', () => {
    const used = usedFsCommands();
    expect(used.length).toBeGreaterThan(0); // 防止正则失效后「什么都没扫到」也通过
    const granted = new Set(cap.permissions.map(permissionId));
    const missing = used.map(commandToPermission).filter((p) => !granted.has(p));
    expect(missing).toEqual([]);
    // 顺带把清单钉住：改动测试预期时，说明确实要动权限了
    expect(used).toEqual([
      'exists', 'mkdir', 'readFile', 'readTextFile', 'remove', 'writeFile', 'writeTextFile',
    ]);
  });

  it('不放多余权限，坚持最小授权（没有 fs:default / write-all 之类的宽集合）', () => {
    const fsPermissions = cap.permissions
      .map(permissionId)
      .filter((p) => p.startsWith('fs:'));
    const allowed = new Set([
      'fs:allow-exists', 'fs:allow-mkdir', 'fs:allow-read-file', 'fs:allow-read-text-file',
      'fs:allow-remove', 'fs:allow-write-file', 'fs:allow-write-text-file', 'fs:scope',
    ]);
    expect(fsPermissions.filter((p) => !allowed.has(p))).toEqual([]);
  });

  it('scope 锁在 $APPDATA 内，且覆盖递归子目录（blobs/ab/<hash> 在子目录）', () => {
    const scope = cap.permissions.find(
      (p): p is { identifier: string; allow?: string[] } =>
        typeof p !== 'string' && p.identifier === 'fs:scope',
    );
    expect(scope).toBeDefined();
    expect(scope?.allow).toContain('$APPDATA');
    expect(scope?.allow).toContain('$APPDATA/**');
    for (const path of scope?.allow ?? []) {
      expect(path.startsWith('$APPDATA')).toBe(true);
    }
  });

  it('capability 绑定的窗口 label 在 tauri.conf.json 里真实存在', () => {
    const labels = conf.app.windows.map((w) => w.label);
    for (const w of cap.windows) expect(labels).toContain(w);
    expect(labels).toContain('main');
  });
});

describe('桌面壳构建配置一致性', () => {
  it('devUrl 端口与 vite.config.ts 的 server.port 一致', () => {
    const vite = read('vite.config.ts');
    const port = Number(/port:\s*(\d+)/.exec(vite)?.[1]);
    expect(port).toBeGreaterThan(0);
    expect(new URL(conf.build.devUrl).port).toBe(String(port));
  });

  it('frontendDist 指向 vite 的产物目录', () => {
    expect(conf.build.frontendDist).toBe('../dist');
  });

  it('bundle 里列的图标文件都存在', () => {
    for (const icon of conf.bundle.icon) {
      expect(existsSync(ROOT + 'src-tauri/' + icon), `缺少图标 ${icon}`).toBe(true);
    }
  });

  it('Cargo.toml 挂了 fs 插件，且与前端 @tauri-apps/plugin-fs 同版本', () => {
    const cargo = read('src-tauri/Cargo.toml');
    const pkg = readJson<{ dependencies: Record<string, string> }>('package.json');
    const cargoVer = /tauri-plugin-fs\s*=\s*"([^"]+)"/.exec(cargo)?.[1];
    const jsVer = pkg.dependencies['@tauri-apps/plugin-fs'];
    expect(cargoVer).toBeTruthy();
    expect(jsVer).toBeTruthy();
    //  caret/tilde 前缀剥掉后主版本号要一致
    const norm = (v: string) => v.replace(/^[\^~]/, '').split('.').slice(0, 2).join('.');
    expect(norm(cargoVer ?? '')).toBe(norm(jsVer ?? ''));
  });
});
