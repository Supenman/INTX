import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(scriptDir, "..");
const repoRoot = resolve(webDir, "..");
const sourceDir = resolve(repoRoot, "comfyui-gateway");
const targetDir = resolve(repoRoot, "web/src-tauri/resources/comfyui-gateway");

if (!existsSync(resolve(sourceDir, "src/server.js"))) {
    throw new Error(`ComfyUI gateway source is missing: ${sourceDir}`);
}

rmSync(targetDir, { recursive: true, force: true });
mkdirSync(dirname(targetDir), { recursive: true });
// 内置工作流不随包分发：本项目走「用户在配置页导入自己的 ComfyUI API 工作流」路线。
// 只建空注册表目录，导入接口会往这里写注册表和工作流文件。
for (const name of ["src", "prompts", "package.json", "package-lock.json", "LICENSE"]) {
    cpSync(resolve(sourceDir, name), resolve(targetDir, name), { recursive: true });
}
const workflowsDir = resolve(targetDir, "workflows");
mkdirSync(workflowsDir, { recursive: true });
writeFileSync(resolve(workflowsDir, "registry.json"), JSON.stringify({ version: 1, workflows: [] }, null, 2));

execSync("npm ci --omit=dev --ignore-scripts --no-audit --no-fund", {
    cwd: targetDir,
    stdio: "inherit",
    shell: process.platform === "win32" ? process.env.ComSpec : "/bin/sh",
});

console.log(`Prepared bundled ComfyUI gateway at ${targetDir}`);
