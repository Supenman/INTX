import { create } from 'zustand';
import { defaultToolbarPrefs, migrateToolbarPrefs, type ToolbarId, type ToolbarPrefs } from '@/domain';

/**
 * 工具栏偏好的持久化与运行时状态。
 *
 * 两条设计约束：
 * - 注册表在 main.tsx 里同步安装，但本模块被 Canvas 静态 import，
 *   模块顶层执行时注册表可能还是空的。所以初始 prefs 是 null，
 *   等 Canvas 挂载后 hydrate()，此时才能算出有意义的默认顺序。
 * - 偏好是 UI 状态，不进项目文件、不进 .intx 包、不参与撤销历史。
 */

const TOOLBARS: readonly ToolbarId[] = ['main', 'selection', 'node-hover', 'add-node-menu'];
const storageKey = (toolbar: ToolbarId) => `intx-toolbar-prefs-${toolbar}-v1`;

function readOne(toolbar: ToolbarId): ToolbarPrefs {
  try {
    if (typeof localStorage === 'undefined') return defaultToolbarPrefs(toolbar);
    const raw = localStorage.getItem(storageKey(toolbar));
    return migrateToolbarPrefs(toolbar, raw ? (JSON.parse(raw) as unknown) : null);
  } catch {
    // 存档损坏 / 隐私模式禁用 localStorage：回落默认，不让整个画布打不开。
    return defaultToolbarPrefs(toolbar);
  }
}

function loadAll(): Record<ToolbarId, ToolbarPrefs> {
  const out = {} as Record<ToolbarId, ToolbarPrefs>;
  for (const toolbar of TOOLBARS) out[toolbar] = readOne(toolbar);
  return out;
}

function writeOne(toolbar: ToolbarId, prefs: ToolbarPrefs): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(storageKey(toolbar), JSON.stringify(prefs));
  } catch {
    // 写失败不影响当前会话的显示，刷新后回到默认即可。
  }
}

interface ToolPrefsState {
  /** null = 尚未 hydrate；解析函数会把 null 当成默认偏好。 */
  prefs: Record<ToolbarId, ToolbarPrefs> | null;
  hydrate: () => void;
  setHidden: (toolbar: ToolbarId, toolId: string, hidden: boolean) => void;
  reset: (toolbar: ToolbarId) => void;
}

export const useToolbarPrefs = create<ToolPrefsState>((set, get) => ({
  prefs: null,
  hydrate: () => set({ prefs: loadAll() }),
  setHidden: (toolbar, toolId, hidden) => {
    const current = get().prefs?.[toolbar] ?? readOne(toolbar);
    const next: ToolbarPrefs = {
      ...current,
      hidden: hidden
        ? [...new Set([...current.hidden, toolId])]
        : current.hidden.filter((id) => id !== toolId),
    };
    writeOne(toolbar, next);
    set({ prefs: { ...(get().prefs ?? loadAll()), [toolbar]: next } });
  },
  reset: (toolbar) => {
    const next = defaultToolbarPrefs(toolbar);
    writeOne(toolbar, next);
    set({ prefs: { ...(get().prefs ?? loadAll()), [toolbar]: next } });
  },
}));
