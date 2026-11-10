import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

/** 已有 dev server 就用它，没有则由 e2e/run.mjs 负责拉起。 */
export const BASE_URL = process.env.INTX_E2E_URL ?? 'http://127.0.0.1:7351/';
export const OUTPUT_DIR = fileURLToPath(new URL('./output/', import.meta.url));

/**
 * 所有开过的 browser 都登记在这里。
 *
 * 之前某个 spec 断言失败时不会走到自己的 `await b.close()`，Playwright 的
 * 连接还活着，node 进程就一直不退出——整轮 E2E 会挂十几分钟直到被外层
 * timeout 杀掉，日志还因为管道缓冲什么都看不到。run.mjs 在 finally 里
 * 调 closeAllBrowsers() 兜底，失败也要能干净收场。
 */
const openBrowsers = new Set();

export async function closeAllBrowsers() {
  const pending = [...openBrowsers];
  openBrowsers.clear();
  await Promise.all(pending.map((b) => b.close().catch(() => {})));
}

/** 用系统 Chromium，避免为了跑 E2E 再下载一份浏览器。 */
function findChromium() {
  const fromEnv = process.env.CHROMIUM_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  // 顺序与 e2e/resolve-chromium.sh 保持一致，并由 ciConfig.test.ts 对账。
  // Google Chrome 排前面：Ubuntu 24.04 的 /usr/bin/chromium-browser 是 snap
  // 转接脚本，存在且可执行却起不来，优先命中它会让 E2E 以一种很难懂的方式失败。
  const candidates = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return candidates.find((p) => existsSync(p));
}

/**
 * 开一个干净的浏览器上下文。
 *
 * addInitScript 里挂的 __intxMod 很关键：Vite HMR 会给模块 URL 加 ?t=xxx，
 * 写死 '/src/...' 动态 import 会实例化出**另一个** store，注入的节点根本
 * 不会出现在页面上。从 resource 表反查页面真正加载的 URL 才拿到同一个单例。
 */
export async function openPage(contextOptions = {}) {
  const browser = await chromium.launch({
    executablePath: findChromium(),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  openBrowsers.add(browser);
  browser.on('disconnected', () => openBrowsers.delete(browser));
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    ...contextOptions,
  });
  await context.addInitScript(() => {
    window.__intxMod = async (base) => {
      const urls = performance.getEntriesByType('resource').map((e) => e.name);
      const hits = urls.filter((u) => u.includes(base));
      return import(hits.at(-1) || base);
    };
  });
  const page = await context.newPage();
  // 默认 30s 太长：一个选错的选择器就能让整轮 E2E 挂十几分钟，而且
  // page.evaluate 里的动态 import 不受它约束。统一压到 15s，失败要快。
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(30000);
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('CONSOLE ' + m.text().slice(0, 240));
  });
  page.on('dialog', (d) => d.accept());

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  return { browser, context, page, errors };
}

export function check(condition, message) {
  if (!condition) throw new Error('断言失败：' + message);
}

/** 每个 spec 收尾：控制台错误一律算失败，而不是只打印出来看一眼。 */
export function finish(name, errors) {
  console.log(`${name} · 错误: ${errors.length ? errors.slice(0, 6).join('\n') : '无'}`);
  check(errors.length === 0, `${name} 出现 ${errors.length} 条控制台错误`);
}
