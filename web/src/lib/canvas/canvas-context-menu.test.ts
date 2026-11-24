import { beforeEach, describe, expect, it } from "vitest";

import { installBuiltinTools, resetToolRegistry } from "@/domain";
import { resolveCanvasContextMenu } from "@/domain/tool/registry";
import { buildToolContext } from "./tool-wiring";

const base = {
  toolMode: "select" as const,
  selectedCount: 0,
  nodeCount: 0,
  clipboardCount: 0,
  canUndo: false,
  canRedo: false,
  demoMode: false,
  node: null,
};

beforeEach(() => {
  resetToolRegistry();
  installBuiltinTools();
});

describe("空白处右键菜单", () => {
  it("六个命令按声明顺序出现", () => {
    const ids = resolveCanvasContextMenu(buildToolContext(base)).map((command) => command.id);
    expect(ids).toEqual(["canvas-add-node", "canvas-upload-here", "canvas-open-assets", "canvas-undo", "canvas-redo", "canvas-paste"]);
  });

  it("撤销、重做、粘贴按上下文置灰，而不是从菜单里消失", () => {
    const empty = resolveCanvasContextMenu(buildToolContext(base));
    expect(empty.filter((command) => command.disabled).map((command) => command.id)).toEqual(["canvas-undo", "canvas-redo", "canvas-paste"]);

    const ready = resolveCanvasContextMenu(buildToolContext({ ...base, canUndo: true, canRedo: true, clipboardCount: 2 }));
    expect(ready.filter((command) => command.disabled)).toHaveLength(0);
  });

  it("创建类命令始终可用", () => {
    const commands = resolveCanvasContextMenu(buildToolContext(base));
    for (const id of ["canvas-add-node", "canvas-upload-here", "canvas-open-assets"]) {
      expect(commands.find((command) => command.id === id)?.disabled).toBe(false);
    }
  });

  it("每个命令都带 i18n key，组件不必自己写文案", () => {
    const commands = resolveCanvasContextMenu(buildToolContext(base));
    expect(commands.every((command) => Boolean(command.labelKey))).toBe(true);
  });
});
