// 生成 Tauri updater 签名密钥对（调用官方 CLI，保证格式正确）。
//
// 运行：cd web && node scripts/generate-updater-keys.mjs
// 产物：
//   ~/.intx-updater.key       私钥（绝不入库、绝不分发，构建时注入环境变量）
//   ~/.intx-updater.key.pub   公钥（填入 src-tauri/tauri.conf.json 的 plugins.updater.pubkey）
//
// 仓库只保存公钥。私钥泄露等于任何人都能给你的用户推送"官方更新"，
// 务必留在发布者本机，不要提交、不要发聊天、不要放 CI 明文变量。
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const privatePath = join(homedir(), ".intx-updater.key");
const publicPath = privatePath + ".pub";

if (existsSync(privatePath) || existsSync(publicPath)) {
    console.error("密钥对已存在，为避免覆盖先手动删除：");
    console.error("  " + privatePath);
    console.error("  " + publicPath);
    process.exit(1);
}

// 交给 tauri CLI 生成，格式由官方保证。生成时它会提示设置私钥密码，
// 记牢这个密码，构建签名时要用到。
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(npx, ["tauri", "signer", "generate", "-w", privatePath], { stdio: "inherit", shell: process.platform === "win32" });
if (result.status !== 0) {
    console.error("密钥生成失败，请确认已安装 @tauri-apps/cli（pnpm install）后重试。");
    process.exit(result.status ?? 1);
}

console.log("\n生成完成。下一步：");
console.log("1. 用文本编辑器打开 " + publicPath + "，把内容填进");
console.log("   src-tauri/tauri.conf.json 的 plugins.updater.pubkey（替换占位符）。\n");
console.log("2. 打包时注入私钥与其密码（PowerShell 示例）：");
console.log("   $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content '" + privatePath + "' -Raw");
console.log("   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = '<你设置的密码>'");
console.log("   pnpm tauri:build\n");
console.log("3. 产物在 src-tauri/target/release/bundle/，含安装包与 .sig 文件。");
console.log("   连同 latest.json 一起传到 GitHub Release v<版本号>；格式见");
console.log("   UPDATE-MECHANISM-REFERENCE.md 的「发布清单」一节。");
