import { beforeEach, describe, expect, it } from "vitest";

import { installBuiltinTools, resetToolRegistry } from "@/domain";
import { buildToolContext, toolView } from "./tool-wiring";

const fields = {
  toolMode: "select" as const,
  selectedCount: 2,
  nodeCount: 2,
  clipboardCount: 0,
  canUndo: true,
  canRedo: false,
  demoMode: false,
};

beforeEach(() => {
  resetToolRegistry();
  installBuiltinTools();
});

describe("画布工具接线层", () => {
  it("把画布的 pan 映射成注册表的 hand", () => {
    expect(buildToolContext(fields).toolMode).toBe("select");
    expect(buildToolContext({ ...fields, toolMode: "pan" }).toolMode).toBe("hand");
  });

  it("undo 的禁用由 canUndo 决定", () => {
    const enabled = buildToolContext(fields);
    const disabled = buildToolContext({ ...fields, canUndo: false });
    expect(toolView("main", "undo", enabled).disabled).toBe(false);
    expect(toolView("main", "undo", disabled).disabled).toBe(true);
  });

  it("等距按钮少于 3 个节点时禁用", () => {
    expect(toolView("selection", "distribute-horizontal", buildToolContext(fields)).disabled).toBe(true);
    const three = buildToolContext({ ...fields, selectedCount: 3 });
    expect(toolView("selection", "distribute-horizontal", three).disabled).toBe(false);
  });

  it("用户隐藏的工具 visible 为 false，但定义仍在", () => {
    const prefs = { version: 1 as const, order: [] as readonly string[], hidden: ["undo"] };
    const view = toolView("main", "undo", buildToolContext(fields), prefs);
    expect(view.exists).toBe(true);
    expect(view.visible).toBe(false);
  });

  it("applicable 不通过的按钮不可见", () => {
    const idle = toolView("node-hover", "node-generate", buildToolContext({ ...fields, node: { kind: "gen", category: "generate", hasAsset: false, busy: false } }));
    const source = toolView("node-hover", "node-generate", buildToolContext({ ...fields, node: { kind: "text", category: "source", hasAsset: false, busy: false } }));
    expect(idle.visible).toBe(true);
    expect(source.visible).toBe(false);
  });

  it("定义缺失时返回中性状态，UI 不退化", () => {
    expect(toolView("main", "tool-focus", buildToolContext(fields))).toMatchObject({
      exists: false,
      visible: true,
      disabled: false,
      active: false,
    });
  });
});
