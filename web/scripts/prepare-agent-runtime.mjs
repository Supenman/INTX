import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(webRoot, "..");
const agentRoot = path.join(repoRoot, "canvas-agent");
const sourceDist = path.join(agentRoot, "dist");
const sourceModules = path.join(agentRoot, "node_modules");
const resourcesRoot = path.join(webRoot, "src-tauri", "resources");
const target = path.join(resourcesRoot, "canvas-agent-runtime");

if (!await exists(path.join(sourceModules, ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc"))) {
    run("npm", ["ci", "--omit=optional", "--no-audit", "--no-fund"], agentRoot);
}
run("npm", ["run", "build"], agentRoot);

await fs.rm(target, { recursive: true, force: true });
const agentTarget = path.join(target, "canvas-agent");
await fs.mkdir(agentTarget, { recursive: true });
await fs.cp(sourceDist, path.join(agentTarget, "dist"), { recursive: true });
await fs.copyFile(path.join(agentRoot, "agent-instructions.md"), path.join(agentTarget, "agent-instructions.md"));
await fs.copyFile(path.join(agentRoot, "package.json"), path.join(agentTarget, "package.json"));
await fs.copyFile(path.join(agentRoot, "package-lock.json"), path.join(agentTarget, "package-lock.json"));
run("npm", ["ci", "--omit=dev", "--omit=optional", "--no-audit", "--no-fund"], agentTarget);

const nodeSource = path.dirname(process.execPath);
const nodeTarget = path.join(target, "node");
await fs.mkdir(path.join(nodeTarget, "node_modules"), { recursive: true });
const nodeFile = path.basename(process.execPath);
const bundledNode = path.join(nodeTarget, nodeFile);
await fs.copyFile(process.execPath, bundledNode);
if (process.platform !== "win32") await fs.chmod(bundledNode, (await fs.stat(process.execPath)).mode);
const nodeLicense = path.join(nodeSource, "LICENSE");
if (await exists(nodeLicense)) await fs.copyFile(nodeLicense, path.join(nodeTarget, "Node-LICENSE.txt"));

const npmSourceDir = await resolveNpmPackageDir(nodeSource);
if (!npmSourceDir) {
    throw new Error(`Could not locate bundled npm directory next to Node (${process.execPath}).`);
}
await fs.cp(npmSourceDir, path.join(nodeTarget, "node_modules", "npm"), { recursive: true, dereference: true });

for (const file of process.platform === "win32" ? ["npm", "npm.cmd", "npx", "npx.cmd"] : ["npm", "npx"]) {
    const source = path.join(nodeSource, file);
    if (!await exists(source)) continue;
    const bundled = path.join(nodeTarget, file);
    const resolvedSource = await fs.realpath(source).catch(() => source);
    await fs.copyFile(resolvedSource, bundled);
    if (process.platform !== "win32") await fs.chmod(bundled, (await fs.stat(resolvedSource)).mode);
}

console.log(`Prepared bundled Canvas Agent runtime at ${target}`);

async function resolveNpmPackageDir(execDir) {
    const candidates = [
        path.join(execDir, "node_modules", "npm"),
        path.resolve(execDir, "..", "lib", "node_modules", "npm"),
        path.resolve(execDir, "..", "node_modules", "npm"),
    ];
    for (const candidate of candidates) {
        if (await exists(path.join(candidate, "package.json"))) return candidate;
    }
    const probe = spawnSync("npm", ["root", "-g"], {
        encoding: "utf8",
        shell: process.platform === "win32",
    });
    if (probe.status === 0 && probe.stdout) {
        const globalNpm = path.join(probe.stdout.trim(), "npm");
        if (await exists(path.join(globalNpm, "package.json"))) return globalNpm;
    }
    return null;
}

function run(command, args, cwd) {
    const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
}

async function exists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}
