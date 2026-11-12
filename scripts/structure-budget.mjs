#!/usr/bin/env node
/**
 * 结构预算：让「别把地基重新堆回去」变成一条可执行、会失败的检查。
 *
 * 思路来自 BeefTV 的 AGENTS.md §10 / quality.yml：结构数字只许变小，
 * 确需变大时显式 --update 并在提交说明里写清理由。INTX 放宽了一条：
 * 新增功能必然增加行数，硬卡总行数会让开发卡死，所以总行数允许 15% 内增长，
 * 而「超 800 行的文件数」和「domain 层违规 import 数」是硬性只许不增。
 *
 * 用法：
 *   node scripts/structure-budget.mjs             # 校验并打印报告
 *   node scripts/structure-budget.mjs --json      # 机器可读输出
 *   node scripts/structure-budget.mjs --update    # 收紧/更新基线（需写明理由）
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SRC = join(ROOT, 'src');
const BASELINE = fileURLToPath(new URL('./structure-budget.baseline.json', import.meta.url));
const OVERSIZED_LIMIT = 800;
const LINE_GROWTH_RATIO = 1.15;

const args = new Set(process.argv.slice(2));
const update = args.has('--update');
const asJson = args.has('--json');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = walk(SRC);
const linesOf = (file) => readFileSync(file, 'utf8').split('\n').length;
const isTest = (file) => /\.(test|spec)\.(ts|tsx)$/.test(file);

let sourceLines = 0;
let largestFileLines = 0;
let largestFile = '';
const oversized = [];
let testFiles = 0;
let domainViolations = 0;
const domainViolationFiles = [];

for (const file of files) {
  if (isTest(file)) {
    testFiles += 1;
    continue;
  }
  const lines = linesOf(file);
  sourceLines += lines;
  if (lines > largestFileLines) {
    largestFileLines = lines;
    largestFile = relative(ROOT, file);
  }
  if (lines > OVERSIZED_LIMIT) oversized.push({ file: relative(ROOT, file), lines });

  if (relative(ROOT, file).startsWith('src/domain/')) {
    const text = readFileSync(file, 'utf8');
    // 只统计真正的 import 说明符，注释里提到上层目录不算违规。
    // 限制在分号之前，避免 side-effect import 一路吞到下一个模块的 from。
    const imports = [...text.matchAll(/^\s*import[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    const bad = imports.filter((spec) => /(@\/|\.\.\/|\/)(infra|app|ui)\//.test(spec) || /^@\/(infra|app|ui)$/.test(spec));
    if (bad.length > 0) {
      domainViolations += bad.length;
      domainViolationFiles.push({ file: relative(ROOT, file), imports: bad });
    }
  }
}

const current = {
  sourceLines,
  largestFileLines,
  oversizedFiles: oversized.length,
  domainViolations,
};
const report = { ...current, largestFile, oversized, testFiles, domainViolationFiles, sourceFileCount: files.length - testFiles };

let baseline = null;
try {
  baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
} catch {
  baseline = null;
}

if (update || !baseline) {
  writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
  if (asJson) console.log(JSON.stringify({ ...report, baseline: current, updated: true }, null, 2));
  else {
    console.log(baseline ? '结构预算基线已更新：' : '结构预算基线已建立：');
    console.log(JSON.stringify(current, null, 2));
  }
  process.exit(0);
}

const problems = [];
for (const key of ['oversizedFiles', 'domainViolations']) {
  if (current[key] > baseline[key]) {
    problems.push(`${key} 从 ${baseline[key]} 涨到 ${current[key]}（硬性只许不增）`);
  }
}
for (const key of ['sourceLines', 'largestFileLines']) {
  const ceiling = Math.ceil(baseline[key] * LINE_GROWTH_RATIO);
  if (current[key] > ceiling) {
    problems.push(`${key} 从 ${baseline[key]} 涨到 ${current[key]}，超过 ${LINE_GROWTH_RATIO * 100}% 上限 ${ceiling}`);
  }
}

const output = {
  ...report,
  baseline,
  tightened: Object.keys(current).filter((key) => current[key] < baseline[key]),
  problems,
};

if (asJson) {
  console.log(JSON.stringify(output, null, 2));
} else {
  console.log('结构预算：');
  console.log(`  源码 ${report.sourceFileCount} 个文件 / ${current.sourceLines} 行（基线 ${baseline.sourceLines}）`);
  console.log(`  最大文件 ${largestFile} ${current.largestFileLines} 行（基线 ${baseline.largestFileLines}）`);
  console.log(`  超 ${OVERSIZED_LIMIT} 行文件 ${current.oversizedFiles} 个（基线 ${baseline.oversizedFiles}）`);
  console.log(`  domain 违规 import ${current.domainViolations} 处（基线 ${baseline.domainViolations}）`);
  console.log(`  单测文件 ${testFiles} 个（不计入预算）`);
  if (oversized.length > 0) console.log(`  超长文件：${oversized.map((f) => `${f.file}(${f.lines})`).join('、')}`);
  if (output.tightened.length > 0) console.log(`  ↓ 已收紧：${output.tightened.join('、')}，建议运行 --update 锁住新基线`);
  if (problems.length === 0) console.log('✅ 结构预算通过');
}

if (problems.length > 0) {
  if (!asJson) for (const p of problems) console.error(`❌ ${p}`);
  console.error('确需放宽时运行 pnpm budget:update，并在提交说明里写清理由。');
  process.exit(1);
}
