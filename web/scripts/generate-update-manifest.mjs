// 免密码生成自研更新器清单 update.json：
// 扫描 web/src-tauri/target/release/bundle/nsis/ 下的 *-setup.exe，计算 SHA-256 与体积，
// 输出标准 update.json，随安装包一起上传至 GitHub Release 或任意国内镜像/对象存储即可。
//
// 用法（在 web/ 目录下）：
//   node scripts/generate-update-manifest.mjs
// 可选环境变量：
//   UPDATE_BASE_URL  自定义下载基址（默认 https://github.com/Supenman/INTX/releases/download/v<version>）
//   UPDATE_MIRRORS   逗号分隔的备用镜像完整下载地址或基址
//   UPDATE_NOTES     更新说明（默认读取简单提示）
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(scriptDir, "..");
const repoRoot = resolve(webDir, "..");
const nsisDir = resolve(webDir, "src-tauri/target/release/bundle/nsis");

const versionRaw = readFileSync(resolve(repoRoot, "VERSION"), "utf8").trim();
const version = versionRaw.replace(/^v/i, "");

if (!existsSync(nsisDir)) {
    console.error(`找不到 NSIS 构建目录：${nsisDir}\n请先运行 pnpm tauri:build。`);
    process.exit(1);
}

const installerName = readdirSync(nsisDir)
    .filter((name) => name.toLowerCase().endsWith("-setup.exe"))
    .sort()
    .at(-1);

if (!installerName) {
    console.error(`在 ${nsisDir} 中未找到 *-setup.exe 安装包。`);
    process.exit(1);
}

const installerPath = join(nsisDir, installerName);
const buffer = readFileSync(installerPath);
const sha256 = createHash("sha256").update(buffer).digest("hex");
const size = statSync(installerPath).size;

const baseUrl = (
    process.env.UPDATE_BASE_URL?.trim() ||
    `https://github.com/Supenman/INTX/releases/download/v${version}`
).replace(/\/+$/, "");

const mirrors = (process.env.UPDATE_MIRRORS || "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.startsWith("https://"))
    .map((item) => (item.endsWith(".exe") ? item : `${item.replace(/\/+$/, "")}/${encodeURIComponent(installerName)}`));

const manifest = {
    version,
    pub_date: new Date().toISOString(),
    notes: process.env.UPDATE_NOTES?.trim() || `INTX v${version}`,
    platforms: {
        "windows-x86_64": {
            url: `${baseUrl}/${encodeURIComponent(installerName)}`,
            ...(mirrors.length ? { mirrors } : {}),
            sha256,
            size,
        },
    },
};

const outputPath = join(nsisDir, "update.json");
writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Generated ${outputPath}`);
console.log(`  installer: ${installerName} (${(size / 1024 / 1024).toFixed(2)} MB)`);
console.log(`  sha256:    ${sha256}`);
