import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * CI 配置对账。
 *
 * 目的不是「证明 yaml 能解析」，而是防止 CI 悄悄失效：改了 script 名、
 * 换掉 E2E 端口、给 Chromium 候选加了一处却只改一半，都会出现本地全绿、
 * 红灯只在云端亮（或者更糟——云端压根没跑该跑的东西）。所以这里把
 * workflow 和它依赖的源码契约逐项对齐，跟 tauriConfig.test.ts 一个思路。
 */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (rel: string) => readFileSync(ROOT + rel, 'utf8');
const readJson = <T>(rel: string): T => JSON.parse(read(rel)) as T;

const WORKFLOW = '.github/workflows/ci.yml';
const PACKAGE_WINDOWS = '.github/workflows/package-windows.yml';
const workflow = read(WORKFLOW);
const winWorkflow = read(PACKAGE_WINDOWS);
const pkg = readJson<{
  packageManager?: string;
  engines?: { node?: string };
  scripts: Record<string, string>;
}>('package.json');
const helpers = read('e2e/helpers.mjs');
const probe = read('e2e/resolve-chromium.sh');

/** 去掉整行注释，免得说明文字里的命令被当成真的 CI 步骤。 */
const stripComments = (text: string) => text.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
const code = stripComments(workflow);
const winCode = stripComments(winWorkflow);

/** workflow 里所有 `pnpm <cmd>`；install 是 pnpm 内置命令，不是 package script。 */
function pnpmCommandsIn(text: string): string[] {
  return [...text.matchAll(/\bpnpm\s+([a-z][a-z0-9:_-]*)/g)]
    .map((m) => m[1])
    .filter((v): v is string => Boolean(v));
}
const pnpmCommands = () => pnpmCommandsIn(code);

/** workflow 中所有单行 run 步骤（多行 `run: |` 只取首行，够用）。 */
function runSteps(): string[] {
  return [...workflow.matchAll(/^\s*(?:-\s*)?run:.*$/gm)].map((m) => m[0]);
}

/**
 * 从文件里抽出 /usr/bin/... 候选；注释里复用同一路径不影响（去重）。
 * shebang 的 `#!/usr/bin/env bash` 是解释器声明，不是候选，先剔掉。
 */
function linuxCandidates(text: string): string[] {
  const body = text.split('\n').filter((line) => !line.startsWith('#!')).join('\n');
  return [...new Set([...body.matchAll(/\/usr\/bin\/[A-Za-z0-9._-]+/g)].map((m) => m[0]))].sort();
}

const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

describe('CI workflow 与工程脚本对齐', () => {
  it('workflow 存在，且声明了 check / e2e 两个 job', () => {
    expect(existsSync(ROOT + WORKFLOW)).toBe(true);
    expect(workflow).toMatch(/^ {2}check:/m);
    expect(workflow).toMatch(/^ {2}e2e:/m);
  });

  it('workflow 里调用的每个 pnpm script 都在 package.json 真实存在', () => {
    const cmds = pnpmCommands();
    expect(cmds.length).toBeGreaterThan(0); // 防止正则失效后「什么都没扫到」也通过
    const bogus = cmds.filter((c) => c !== 'install' && !(c in pkg.scripts));
    expect(bogus).toEqual([]);
  });

  it('verify / build / e2e 三道验收都真的进了 CI', () => {
    const cmds = pnpmCommands();
    for (const cmd of ['verify', 'build', 'e2e']) expect(cmds).toContain(cmd);
  });

  it('两个 job 都用冻结锁文件安装，不偷偷升级依赖', () => {
    const hits = code.match(/pnpm install --frozen-lockfile/g) ?? [];
    expect(hits).toHaveLength(2);
  });

  it('pnpm 版本由 packageManager 单一来源决定，action-setup 不写死版本', () => {
    expect(pkg.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
    expect(code).toContain('pnpm/action-setup@v4');
    expect(code).not.toMatch(/with:\s*\n\s*version:\s*\d/);
  });

  it('CI 的 Node 版本不低于 engines.node', () => {
    const declared = Number(/node-version:\s*(\d+)/.exec(code)?.[1]);
    const minimum = Number(/>=(\d+)/.exec(pkg.engines?.node ?? '')?.[1]);
    expect(declared).toBeGreaterThan(0);
    expect(minimum).toBeGreaterThan(0);
    expect(declared).toBeGreaterThanOrEqual(minimum);
  });

  it('eslint 忽略桌面构建产物，本地 tauri build 之后 pnpm verify 不会挂', () => {
    // 真实踩过：codegen 生成的压缩 JS 带控制字符，eslint . 会解析报错
    const eslint = read('eslint.config.js');
    expect(eslint).toContain("'src-tauri/target'");
    expect(eslint).toContain("'src-tauri/gen'");
  });

  it('CI 不另起常驻 dev server，也不覆盖 E2E 端口', () => {
    // e2e/run.mjs 自己拉起并收掉 7351；再手动开一个会撞 --strictPort
    expect(runSteps().some((s) => s.includes('pnpm dev'))).toBe(false);
    expect(workflow).not.toContain('INTX_E2E_URL');
  });

  it('Rust 桌面编译暂不进 CI，原因写在 workflow 注释里', () => {
    // runner 缺 webkit2gtk-4.1 / appindicator、Cargo.lock 未生成，硬跑只会假失败
    expect(runSteps().some((s) => s.includes('tauri:check'))).toBe(false);
    expect(workflow).toContain('webkit2gtk');
  });
});

describe('CI 与 E2E 的浏览器 / 产物契约一致', () => {
  it('探测脚本与 helpers.mjs 的 Chromium 候选完全一致', () => {
    const fromProbe = linuxCandidates(probe);
    expect(fromProbe.length).toBeGreaterThan(0);
    expect(linuxCandidates(helpers)).toEqual(fromProbe);
    expect(probe).toContain(MAC_CHROME);
    expect(helpers).toContain(MAC_CHROME);
  });

  it('探测会实际执行 --version，过滤掉存在但起不来的 snap wrapper', () => {
    expect(probe).toContain('--version');
  });

  it('workflow 通过 CHROMIUM_PATH 把探测结果交给 helpers', () => {
    expect(code).toContain('CHROMIUM_PATH');
    expect(code).toContain('bash e2e/resolve-chromium.sh');
    expect(helpers).toContain('process.env.CHROMIUM_PATH');
  });

  it('失败时上传的产物目录与 helpers 的 OUTPUT_DIR 一致', () => {
    expect(code).toContain('path: e2e/output/');
    expect(code).toContain('if: failure()');
    expect(helpers).toContain("new URL('./output/', import.meta.url)");
  });
});

describe('结构预算', () => {
  it('脚本与基线都入库，预算接进 verify（CI 的 check job 会跑到）', () => {
    expect(existsSync(ROOT + 'scripts/structure-budget.mjs')).toBe(true);
    expect(existsSync(ROOT + 'scripts/structure-budget.baseline.json')).toBe(true);
    expect(pkg.scripts.budget).toContain('structure-budget.mjs');
    expect(pkg.scripts['budget:update']).toContain('--update');
    expect(pkg.scripts.verify).toContain('pnpm budget');
    expect(workflow).toContain('pnpm verify');
  });

  it('默认只读校验，只有显式 --update 才写基线，超标会失败', () => {
    const script = read('scripts/structure-budget.mjs');
    expect(script).toContain("args.has('--update')");
    expect(script).toContain('writeFileSync(BASELINE');
    expect(script).toContain('process.exit(1)');
    // 硬性只许不增的两项不能被悄悄放宽
    expect(script).toContain("['oversizedFiles', 'domainViolations']");
  });
});

describe('Windows 安装包 workflow', () => {
  it('文件存在，且跑在 windows-latest', () => {
    expect(existsSync(ROOT + PACKAGE_WINDOWS)).toBe(true);
    expect(winWorkflow).toContain('runs-on: windows-latest');
  });

  it('调用的 pnpm script 都真实存在，且冻结锁文件安装', () => {
    const cmds = pnpmCommandsIn(winCode);
    expect(cmds.length).toBeGreaterThan(0);
    const bogus = cmds.filter((c) => c !== 'install' && !(c in pkg.scripts));
    expect(bogus).toEqual([]);
    expect(cmds).toContain('tauri:build');
    expect(winCode).toContain('pnpm install --frozen-lockfile');
  });

  it('只在手动 / v2 分支 / tag 触发，不跟日常 push 一起编 Rust', () => {
    expect(winWorkflow).toContain('workflow_dispatch:');
    expect(winWorkflow).toContain('branches: [v2]');
    expect(winWorkflow).toMatch(/tags: \['v\*'\]/);
  });

  it('产物包含 msi 与 nsis exe，且缺文件直接判失败', () => {
    expect(winCode).toContain('bundle/msi/*.msi');
    expect(winCode).toContain('bundle/nsis/*.exe');
    expect(winCode).toContain('if-no-files-found: error');
  });

  it('Node 版本与主 CI 一致，pnpm 版本同样只由 packageManager 决定', () => {
    const nodeVer = (t: string) => /node-version:\s*(\d+)/.exec(t)?.[1];
    expect(nodeVer(winCode)).toBe(nodeVer(code));
    expect(winCode).toContain('pnpm/action-setup@v4');
    expect(winCode).not.toMatch(/with:\s*\n\s*version:\s*\d/);
  });
});
