import { useEffect, useRef, type ReactNode } from 'react';

/**
 * 面板遮罩的统一行为。
 *
 * 此前每个浮层各写一份关闭逻辑：有的 onClick 关（从面板内按下、
 * 拖到遮罩松手会误关），有的 mousedown 关，有的不响应 Esc。
 * 这里收敛成一套，行为对齐 PromptEditor 里已经打磨过的两条规则：
 *
 * 1. 遮罩关闭必须「按下在遮罩上 && 抬起也在遮罩上」。只判按下，
 *    面板内容重排后松手落在遮罩上就会把整个浮层误关。
 * 2. Esc 关闭，但输入框里的 Esc 让位给字段自己的语义
 *    （批量改名的 Esc 是放弃编辑）；capture 阶段先于画布快捷键。
 *
 * 嵌套浮层（预览 → 素材编辑）用 `escDisabled` 让底层暂时让位，
 * 避免一次 Esc 把两层全关掉。
 */
export interface PanelMaskProps {
  onClose: () => void;
  /** 上层还有浮层时置 true：本层不响应 Esc，也不响应遮罩点击 */
  escDisabled?: boolean;
  children: ReactNode;
}

export function PanelMask({ onClose, escDisabled = false, children }: PanelMaskProps) {
  const maskDown = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (escDisabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      const inField =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable === true;
      if (inField) return; // 字段自己的 Esc 语义优先（放弃编辑等）
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [escDisabled]);

  return (
    <div
      className="panel-mask"
      onMouseDown={(e) => {
        if (!escDisabled && e.target === e.currentTarget) maskDown.current = true;
      }}
      onMouseUp={(e) => {
        const wasMask = maskDown.current && e.target === e.currentTarget;
        maskDown.current = false;
        if (wasMask) closeRef.current();
      }}
    >
      {children}
    </div>
  );
}
