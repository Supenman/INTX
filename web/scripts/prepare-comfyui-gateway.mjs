import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
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
for (const name of ["src", "workflows", "prompts", "package.json", "package-lock.json", "LICENSE"]) {
    cpSync(resolve(sourceDir, name), resolve(targetDir, name), { recursive: true });
}

execSync("npm ci --omit=dev --ignore-scripts --no-audit --no-fund", {
    cwd: targetDir,
    stdio: "inherit",
    shell: process.platform === "win32" ? process.env.ComSpec : "/bin/sh",
});

console.log(`Prepared bundled ComfyUI gateway at ${targetDir}`);
