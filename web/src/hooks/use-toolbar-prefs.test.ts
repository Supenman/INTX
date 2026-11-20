import { beforeEach, describe, expect, it, vi } from "vitest";

import { installBuiltinTools, resetToolRegistry } from "@/domain";
import { readToolbarPrefs } from "./use-toolbar-prefs";

const store = new Map<string, string>();

beforeEach(() => {
  resetToolRegistry();
  installBuiltinTools();
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
});

describe("工具栏偏好读盘", () => {
  it("没有存档时用默认偏好", () => {
    expect(readToolbarPrefs("main").version).toBe(1);
    expect(readToolbarPrefs("main").hidden).toContain("clear-canvas");
  });

  it("读盘损坏时回落默认，不抛错", () => {
    store.set("intx-toolbar-prefs-main-v1", "{ not json");
    expect(readToolbarPrefs("main").version).toBe(1);
  });

  it("旧版 tool-move id 迁移成 tool-canvas-mode", () => {
    store.set("intx-toolbar-prefs-main-v1", JSON.stringify({ version: 1, order: ["tool-move", "undo"], hidden: [] }));
    const prefs = readToolbarPrefs("main");
    expect(prefs.order).toContain("tool-canvas-mode");
    expect(prefs.order).not.toContain("tool-move");
  });

  it("用户隐藏的工具读回来仍是隐藏的", () => {
    store.set("intx-toolbar-prefs-main-v1", JSON.stringify({ version: 1, order: [], hidden: ["redo"] }));
    expect(readToolbarPrefs("main").hidden).toContain("redo");
  });
});
