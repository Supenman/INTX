import { useEffect, useRef } from 'react';
import { redo, undo } from '@/app/stores/historyStore';

/**
 * 画布全局快捷键。
 *
 * 从 Canvas 拆出来守 800 行结构预算；行为不变：
 * Ctrl/Cmd+Z / D / C / V / 1 / 2 / 3，? 快捷键面板，Escape 关菜单。
 * 输入框（INPUT/TEXTAREA/SELECT/contentEditable）里一律放行原生语义。
 *
 * 选区用 ref 读最新值：把 selectedIds 放进依赖会让每次选择都重挂监听。
 */
export interface CanvasShortcutHandlers {
  selectedIds: string[];
  onEscape: () => void;
  onToggleShortcuts: () => void;
  onDuplicate: () => void;
  onCopy: () => void;
  onPaste: () => void;
  zoomTo: (zoom: number, opts?: { duration?: number }) => Promise<boolean> | void;
  fitView: (opts?: { duration?: number; padding?: number; nodes?: { id: string }[] }) => Promise<boolean> | void;
}

export function useCanvasShortcuts(h: CanvasShortcutHandlers): void {
  const ref = useRef(h);
  ref.current = h;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cur = ref.current;
      if (e.key === 'Escape') {
        cur.onEscape();
        return;
      }
      const target = e.target as HTMLElement | null;
      const inField =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable === true;
      if (inField) return;

      // ? 不需要修饰键；Shift+/ 在多数键盘布局上就是 ?
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        cur.onToggleShortcuts();
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;

      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        redo();
      } else if (key === 'd') {
        e.preventDefault();
        cur.onDuplicate();
      } else if (key === 'c') {
        e.preventDefault();
        cur.onCopy();
      } else if (key === 'v') {
        e.preventDefault();
        cur.onPaste();
      } else if (key === '1') {
        e.preventDefault();
        void cur.zoomTo(1, { duration: 200 });
      } else if (key === '2') {
        e.preventDefault();
        void cur.fitView({ duration: 200, padding: 0.15 });
      } else if (key === '3') {
        e.preventDefault();
        if (cur.selectedIds.length > 0) {
          void cur.fitView({ duration: 200, padding: 0.2, nodes: cur.selectedIds.map((id) => ({ id })) });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
