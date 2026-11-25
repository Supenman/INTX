#!/usr/bin/env node
/**
 * 结构预算门禁：源码不许越滚越大、厂商域名不许散落到业务逻辑里。
 *
 * tsc / 单测 / 构建都抓不到「文件越写越长」「BaseURL 硬编码在 case 分支里」，
 * 这类问题只会在下一次改动时咬人。本脚本按文件记账，基线只许降低：
 *   - 单文件超过 800 行的部分（overLines）
 *   - 源码里出现的厂商域名字面量（vendorUrls），默认配置里的除外
 *
 * 和 check-tokens 同构：命中数只能 ≤ 基线，减少后可用 --update 降基线防止回退。
 * domain 的违规 import 由 check-boundaries.mjs 负责，这里不重复。
 *
 * 用法：
 *   node scripts/structure-budget.mjs              # 按基线校验
 *   node scripts/structure-budget.mjs --update     # 重写基线（只能降低）
 *   node scripts/structure-budget.mjs --reseat     # 把当前存量整体记为基线，仅用于基线已失效时
 *   node scripts/structure-budget.mjs --json       # 只输出 JSON
 *
 * 退出码：0 通过；1 有新增或读取失败。
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL("..", import.meta.url)), "src");
const BASELINE = join(ROOT, "..", "scripts", "structure-budget.baseline.json");
const MAX_LINES = 800;

/** 这些文件里的域名是「出厂默认 BaseURL」，是产品配置不是硬编码，记账但不算违规扩散。 */
const DEFAULT_CONFIG_FILES = new Set([
    "src/stores/use-config-store.ts",
    "src/services/api/image.ts",
]);

const VENDOR_URL = /https?:\/\/(api\.modelscope\.cn|api\.openai\.com|generativelanguage\.googleapis\.com|api\.anthropic\.com)/g;

/**
 * 按路径放宽行数上限。理由是这些文件的主体是平铺的数据行，不是逻辑：
 * 800 行对它们意味着「多支持一个语言 / 多一个地区」就红，逼着人去改基线，
 * 反而让门禁失去意义。逻辑代码仍然是 MAX_LINES。
 */
const PATH_LIMITS = [
    { pattern: /^src\/i18n\/locales\/[^/]+\.ts$/, maxLines: 1600, reason: "语言包按 key 平铺" },
    { pattern: /^src\/lib\/opencut\/stickers\/providers\/[^/]+\.ts$/, maxLines: 1600, reason: "贴纸/地区数据表" },
];

function limitFor(rel) {
    return PATH_LIMITS.find((entry) => entry.pattern.test(rel))?.maxLines ?? MAX_LINES;
}

function walk(dir) {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return walk(path);
        return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
}

function measure() {
    const files = {};
    for (const path of walk(ROOT)) {
        const rel = relative(join(ROOT, ".."), path).split("\\").join("/");
        const text = readFileSync(path, "utf8");
        const lines = text.split("\n").length;
        const overLines = Math.max(0, lines - limitFor(rel));
        const vendorUrls = DEFAULT_CONFIG_FILES.has(rel) ? 0 : (text.match(VENDOR_URL) ?? []).length;
        if (overLines || vendorUrls) files[rel] = { overLines, vendorUrls, total: overLines + vendorUrls };
    }
    return { total: Object.values(files).reduce((sum, f) => sum + f.total, 0), files };
}

const args = process.argv.slice(2);
const update = args.includes("--update");
/** 存量入账：把当前所有超标一次性写成基线，用于基线长期没跟上的情况。只能人工决定后使用。 */
const reseat = args.includes("--reseat");
const jsonOnly = args.includes("--json");
const current = measure();

if (reseat) {
    let old = null;
    try {
        old = JSON.parse(readFileSync(BASELINE, "utf8"));
    } catch {
        // 首次生成。
    }
    writeFileSync(BASELINE, `${JSON.stringify(current, null, 4)}\n`, "utf8");
    console.log(`基线已重置为当前存量：total=${current.total}（原 ${old?.total ?? "无"}）`);
    console.log("以下问题从此只许减少：");
    for (const [file, m] of Object.entries(current.files)) {
        const before = old?.files[file]?.total ?? 0;
        console.log(`  ${file}: ${before} -> ${m.total}`);
    }
    process.exit(0);
}

if (update) {
    let old = null;
    try {
        old = JSON.parse(readFileSync(BASELINE, "utf8"));
    } catch {
        // 首次生成，没有旧基线就不做「只允许降低」校验。
    }
    if (old) {
        const grew = Object.entries(current.files)
            .filter(([file, m]) => m.total > (old.files[file]?.total ?? 0))
            .map(([file, m]) => `${file}: ${m.total} > ${old.files[file]?.total ?? 0}`);
        if (grew.length) {
            console.error("基线只允许降低，以下文件比旧基线更高，请先修掉：\n" + grew.join("\n"));
            process.exit(1);
        }
    }
    writeFileSync(BASELINE, `${JSON.stringify(current, null, 4)}\n`, "utf8");
    console.log(`基线已更新：total=${current.total}`);
    process.exit(0);
}

let baseline;
try {
    baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
} catch {
    console.error("缺少 scripts/structure-budget.baseline.json，先跑一次 --update 生成");
    process.exit(1);
}

const regressions = Object.entries(current.files)
    .filter(([file, m]) => m.total > (baseline.files[file]?.total ?? 0))
    .map(([file, m]) => ({ file, current: m.total, baseline: baseline.files[file]?.total ?? 0 }));

if (jsonOnly) {
    console.log(JSON.stringify({ total: current.total, baselineTotal: baseline.total, regressions }, null, 2));
} else if (regressions.length) {
    console.error("结构预算超标（只许变小）：");
    for (const r of regressions) console.error(`  ${r.file}: ${r.current} > ${r.baseline}`);
    process.exit(1);
} else {
    const saved = baseline.total - current.total;
    console.log(`结构预算通过：${current.total}（基线 ${baseline.total}${saved > 0 ? `，已减少 ${saved}` : ""}）`);
}
if (regressions.length) process.exit(1);
