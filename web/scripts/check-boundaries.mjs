// 依赖边界检查：domain 层必须保持零 IO、零 React（见 AGENTS.md「INTX 嫁接纪律」）。
// 只查静态 import / export-from 写法，不解析路径别名，够用且不需要额外依赖。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const DOMAIN_DIR = join(ROOT, "src", "domain");

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

if (violations.length) {
    console.error("domain 层不允许依赖 React / UI / 状态 / 服务 / 网络库：");
    for (const item of violations) console.error(`  ${item}`);
    process.exit(1);
}
console.log("domain 依赖边界正常");
