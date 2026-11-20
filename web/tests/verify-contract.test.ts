import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// 测试从 web/ 跑（bun test tests），仓库根是上一级。
const WEB = import.meta.dir.replace(/\/tests$/, "");
const REPO = join(WEB, "..");

const pkg = JSON.parse(readFileSync(join(WEB, "package.json"), "utf8"));
const scripts: Record<string, string> = pkg.scripts;

test("verify 聚合了所有静态检查脚本，避免加了脚本却忘了接门禁", () => {
    const verify = scripts.verify ?? "";
    for (const name of ["typecheck", "check:boundaries", "check:tokens", "check:structure", "test"]) {
        expect(scripts[name]).toBeTruthy();
        expect(verify).toContain(`pnpm ${name}`);
    }
});

test("结构预算脚本与基线文件都存在，且基线非空", () => {
    expect(scripts["check:structure"]).toContain("structure-budget.mjs");
    const baseline = JSON.parse(readFileSync(join(WEB, "scripts", "structure-budget.baseline.json"), "utf8"));
    expect(baseline.total).toBeGreaterThan(0);
    expect(Object.keys(baseline.files).length).toBeGreaterThan(0);
});

test("CI 有 workflow 调用 pnpm verify，且触发路径覆盖 web 源码与脚本", () => {
    const wf = readFileSync(join(REPO, ".github", "workflows", "verify.yml"), "utf8");
    expect(wf).toContain("pnpm verify");
    for (const path of ["web/src/**", "web/scripts/**", "web/package.json"]) {
        expect(wf).toContain(path);
    }
});

test("verify 不串联需要浏览器/网络的检查，保证 CI 无头可跑", () => {
    expect(scripts.verify).not.toContain("check:overflow");
    expect(scripts.verify).not.toContain("tauri");
});
