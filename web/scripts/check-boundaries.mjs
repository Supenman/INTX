// 依赖边界检查：
// 1. domain 层必须保持零 IO、零 React（见 AGENTS.md「INTX 嫁接纪律」）。
// 2. 厂商请求只能从 `services/api/provider-transport.ts` 出去：api 层不得直接依赖
//    axios 或 `@tauri-apps/plugin-http`，裸 `fetch` 只允许出现在明确不是厂商请求的地方（本地 Agent、
//    本地代理探活、提示词源、脚本里的示例代码）。
// 只查静态 import / export-from 与 `fetch(` 字面写法，不解析路径别名，够用且不需要额外依赖。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const DOMAIN_DIR = join(ROOT, "src", "domain");
const API_DIR = join(ROOT, "src", "services", "api");

/** 允许直接 `fetch` 的 api 文件，新增条目要写清为什么不是厂商请求。 */
const FETCH_ALLOWED = new Set([
    "provider-transport.ts", // 浏览器端实现本身
    "canvas-agent.ts", // 本机 Agent 的对话与画布接口
    "local-proxy.ts", // 本地代理探活
    "model-plugin.ts", // 命中的是给用户看的脚本模板字符串，不是真实请求
]);

const FORBIDDEN = [
    /^react(-dom)?(\/|$)/,
    /^antd(\/|$)/,
    /^@ant-design\//,
    /^axios$/,
    /^zustand$/,
    /^localforage$/,
    /^@tauri-apps\//,
    /^@\/(services|stores|components|pages|hooks|layouts|lib|i18n)(\/|$)/,
    /^\.\.\/\.\.\/(services|stores|components|pages|hooks|layouts|lib|i18n)(\/|$)/,
];

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\b[^;]*?from\s*['"]([^'"]+)['"]/g;
const ONLY_IMPORT_RE = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;

function walk(dir) {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return walk(path);
        return path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
    });
}

const violations = [];
for (const file of walk(DOMAIN_DIR)) {
    const source = readFileSync(file, "utf8");
    for (const re of [IMPORT_RE, ONLY_IMPORT_RE]) {
        re.lastIndex = 0;
        for (const match of source.matchAll(re)) {
            const specifier = match[1];
            if (FORBIDDEN.some((rule) => rule.test(specifier))) {
                violations.push(`${relative(ROOT, file).replace(/\\/g, "/")} → ${specifier}`);
            }
        }
    }
}

const transportViolations = [];
for (const file of walk(API_DIR)) {
    const name = basename(file);
    const source = readFileSync(file, "utf8");
    for (const re of [IMPORT_RE, ONLY_IMPORT_RE]) {
        re.lastIndex = 0;
        for (const match of source.matchAll(re)) {
            const specifier = match[1];
            if (/^axios$/.test(specifier)) transportViolations.push(`${relative(ROOT, file).replace(/\\/g, "/")} → ${specifier}（厂商请求必须走 ProviderTransport）`);
            if (/^@tauri-apps\/plugin-http$/.test(specifier) && name !== "provider-transport.ts") {
                transportViolations.push(`${relative(ROOT, file).replace(/\\/g, "/")} → ${specifier}（只允许出现在 provider-transport.ts）`);
            }
        }
    }
    if (!FETCH_ALLOWED.has(name) && /(^|[^.\w])fetch\s*\(/.test(source)) {
        transportViolations.push(`${relative(ROOT, file).replace(/\\/g, "/")} 直接调用了 fetch（要么走 ProviderTransport，要么在 FETCH_ALLOWED 里说明原因）`);
    }
}

if (violations.length) {
    console.error("domain 层不允许依赖 React / UI / 状态 / 服务 / 网络库：");
    for (const item of violations) console.error(`  ${item}`);
}
if (transportViolations.length) {
    console.error("厂商请求只能从 provider-transport.ts 出去：");
    for (const item of transportViolations) console.error(`  ${item}`);
}
if (violations.length || transportViolations.length) process.exit(1);
console.log("依赖边界正常（domain 无 IO；厂商请求单一出口）");
