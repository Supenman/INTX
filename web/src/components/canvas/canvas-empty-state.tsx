/**
 * 空画布起始态。
 *
 * 判什么态、显示什么文案全部来自 domain 的 canvasStarter 纯函数，组件只负责渲染。
 * 叠在画布上但不吃指针事件：它不能挡住「右键画布添加节点」和双击创建菜单。
 */
import {
  canvasStarterCopy,
  resolveCanvasEmptyState,
  type CanvasEmptyStateInput,
} from "@/domain";

export function CanvasEmptyState(props: CanvasEmptyStateInput) {
  const kind = resolveCanvasEmptyState(props);
  const copy = canvasStarterCopy(kind);
  if (!copy) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[1] flex flex-col items-center justify-center gap-2 text-center"
      data-canvas-empty-state={kind}
    >
      <div className="text-lg font-medium opacity-60">{copy.title}</div>
      <div className="text-sm opacity-50">{copy.subtitle}</div>
      <div className="text-xs opacity-40">{copy.hint}</div>
    </div>
  );
}
