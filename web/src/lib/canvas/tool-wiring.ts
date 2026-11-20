/**
 * 画布 UI → 工具注册表的接线层。
 *
 * domain 的解析函数是纯函数，这里只负责两件事：
 *   1. 把组件手里的状态映射成 ToolContext（纯函数、可单测）；
 *   2. 按 id 查询单个工具在当前上下文下的可见 / 禁用 / 激活 / 提示。
 *
 * 刻意不替换现有按钮：图标、i18n 文案、class、aria-label、顺序都留在组件里。
 * 注册表先接上「按钮该不该出现、该不该灰掉」的判定，六组 E2E 与既有视觉不受影响。
 * 定义缺失时返回中性状态（既不隐藏也不禁用），注册表未安装时 UI 不退化。
 */
import {
  defaultToolbarPrefs,
  getToolbarTools,
  resolveToolbarTools,
  type ToolContext,
  type ToolNodeContext,
  type ToolbarId,
  type ToolbarPrefs,
} from "@/domain";

export interface CanvasToolState {
  toolMode: "select" | "pan" | "hand";
  selectedCount: number;
  nodeCount: number;
  clipboardCount: number;
  canUndo: boolean;
  canRedo: boolean;
  demoMode: boolean;
  node?: ToolNodeContext | null;
  contextNodeId?: string | null;
}

/** 画布的 pan 与注册表的 hand 是同一个工具，只在这里对齐一次。 */
export function buildToolContext(state: CanvasToolState): ToolContext {
  return {
    toolMode: state.toolMode === "pan" ? "hand" : state.toolMode,
    selectedCount: state.selectedCount,
    nodeCount: state.nodeCount,
    clipboardCount: state.clipboardCount,
    canUndo: state.canUndo,
    canRedo: state.canRedo,
    demoMode: state.demoMode,
    node: state.node ?? null,
    contextNodeId: state.contextNodeId ?? null,
  };
}

export interface ToolViewState {
  /** 注册表里有没有这条定义 */
  exists: boolean;
  /** 当前上下文是否适用 */
  applicable: boolean;
  /** 适用且未被用户偏好隐藏 */
  visible: boolean;
  disabled: boolean;
  active: boolean;
  hint: string;
}

const NEUTRAL: ToolViewState = {
  exists: false,
  applicable: true,
  visible: true,
  disabled: false,
  active: false,
  hint: "",
};

/**
 * 查单个工具的状态。prefs 传 null 时用默认偏好。
 * 定义缺失返回中性值，因此组件在注册表未安装的页面上仍按原样渲染。
 */
export function toolView(
  toolbar: ToolbarId,
  toolId: string,
  ctx: ToolContext,
  prefs: ToolbarPrefs | null = null,
): ToolViewState {
  const def = getToolbarTools(toolbar).find((tool) => tool.id === toolId);
  if (!def) return NEUTRAL;

  const applicable = !def.applicable || def.applicable(ctx);
  const effective = prefs ?? defaultToolbarPrefs(toolbar);
  const visible = resolveToolbarTools(toolbar, ctx, effective).some((tool) => tool.id === toolId);

  return {
    exists: true,
    applicable,
    visible,
    disabled: Boolean(def.disabled?.(ctx)),
    active: Boolean(def.active?.(ctx)),
    hint: def.hint,
  };
}
