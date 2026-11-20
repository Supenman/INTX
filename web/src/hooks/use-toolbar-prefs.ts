/**
 * 工具栏显隐 / 排序偏好持久化。
 *
 * 偏好只存在 localStorage，不进 .intx、不参与撤销：换台机器不该把工具栏布局搬走。
 * 首帧同步读盘，避免按钮先按默认显示再跳动；读盘损坏或隐私模式禁用存储时静默回落默认。
 */
import { useCallback, useEffect, useState } from "react";

import {
  defaultToolbarPrefs,
  migrateToolbarPrefs,
  type ToolbarId,
  type ToolbarPrefs,
} from "@/domain";

const storageKey = (toolbar: ToolbarId) => `intx-toolbar-prefs-${toolbar}-v1`;

/** 供首帧与单测使用；任何异常都回落默认偏好，不让整个画布打不开。 */
export function readToolbarPrefs(toolbar: ToolbarId): ToolbarPrefs {
  try {
    const raw = globalThis.localStorage.getItem(storageKey(toolbar));
    if (!raw) return defaultToolbarPrefs(toolbar);
    return migrateToolbarPrefs(toolbar, JSON.parse(raw) as unknown);
  } catch {
    return defaultToolbarPrefs(toolbar);
  }
}

export function useToolbarPrefs(toolbar: ToolbarId) {
  const [prefs, setPrefsState] = useState<ToolbarPrefs>(() => readToolbarPrefs(toolbar));

  useEffect(() => {
    try {
      globalThis.localStorage.setItem(storageKey(toolbar), JSON.stringify(prefs));
    } catch {
      // 存储不可用（隐私模式 / 配额满）：偏好不落盘，但画布照常可用。
    }
  }, [toolbar, prefs]);

  const setPrefs = useCallback((next: ToolbarPrefs) => setPrefsState(next), []);
  return { prefs, setPrefs };
}
