import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { closeAllBrowsers } from './helpers.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
// output/ 被 gitignore，clone 下来不一定存在；截图/导出前先建好
mkdirSync(fileURLToPath(new URL('./output/', import.meta.url)), { recursive: true });
const VITE_BIN = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const BASE_URL = process.env.INTX_E2E_URL ?? 'http://127.0.0.1:7351/';

const SPECS = [
  ['生成闭环', './specs/generation.mjs'],
  ['撤销/取消/恢复/导入导出', './specs/recovery.mjs'],
  ['200 节点压力', './specs/stress-200.mjs'],
  ['素材编辑/裁切/遮罩', './specs/material-edit.mjs'],
  ['旧版数据迁移', './specs/legacy-import.mjs'],
  ['画布基本功/删除/框选/对齐', './specs/canvas-basics.mjs'],
  ['工具注册表/偏好/悬浮栏/连线语义', './specs/tool-registry.mjs'],
  ['P2 审计/出境/成本/复现', './specs/p2-audit.mjs'],
];

async function reachable() {
  try {
    const r = await fetch(BASE_URL, { signal: AbortSignal.timeout(1200) });
    return r.ok;
  } catch {
    return false;
  }
}

/** 有现成 dev server 就复用，没有就自己拉一个，跑完负责收掉。 */
async function ensureServer() {
  if (await reachable()) {
    console.log(`复用已在运行的 dev server: ${BASE_URL}`);
    return () => {};
  }
  console.log('启动 dev server…');
  const child = spawn(process.execPath, [VITE_BIN, '--host', '127.0.0.1', '--port', '7351', '--strictPort'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d.toString(); });
  child.stderr.on('data', (d) => { log += d.toString(); });

  for (let i = 0; i < 80; i += 1) {
    if (await reachable()) {
      console.log(`dev server 就绪: ${BASE_URL}`);
      return () => {
        child.kill('SIGTERM');
        setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 1500).unref();
      };
    }
    if (child.exitCode !== null) break;
    await delay(300);
  }
  child.kill('SIGKILL');
  throw new Error('dev server 没能起来。最近输出：\n' + log.slice(-1500));
}

const stop = await ensureServer();
let passed = 0;
const failures = [];

try {
  for (const [name, file] of SPECS) {
    console.log(`\n===== ${name} =====`);
    try {
      const mod = await import(file);
      await mod.run();
      passed += 1;
      console.log(`✅ ${name} 通过`);
    } catch (e) {
      failures.push({ name, message: e?.stack ?? String(e) });
      console.log(`❌ ${name} 失败: ${e?.message ?? e}`);
    }
  }
} finally {
  stop();
  // 失败的 spec 没走到自己的 b.close()，Playwright 连接会吊住整个 node 进程。
  // 统一兜底关掉，保证 E2E 无论全绿还是失败都能按时退出并 flush 日志。
  await closeAllBrowsers();
}

console.log(`\n===== E2E 汇总: ${passed}/${SPECS.length} 通过 =====`);
for (const f of failures) console.log(`\n[${f.name}]\n${f.message}`);
if (failures.length > 0) process.exitCode = 1;
