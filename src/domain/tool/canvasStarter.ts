/**
 * 空画布起始状态决策。
 *
 * 把「空画布该长什么样」从组件里搬出来：组件只负责渲染一种 kind，
 * 判断依据（有没有节点、是不是演示厂商、有没有关联项目）集中在这里，
 * 可单测、也不会在两处写出不一致的提示文案。
 */

export type CanvasEmptyState = 'none' | 'guided' | 'freeform' | 'linked';

export interface CanvasEmptyStateInput {
  nodeCount: number;
  /** 只有本地演示厂商时，起始框必须明确写出「不出真图」。 */
  demoMode: boolean;
  /** 预留：未来接项目关联时用，当前恒为 false。 */
  isProjectLinked?: boolean;
  starterMode?: 'guided' | 'freeform';
}

export function resolveCanvasEmptyState(input: CanvasEmptyStateInput): CanvasEmptyState {
  if (input.nodeCount > 0) return 'none';
  if (input.isProjectLinked) return 'linked';
  if (input.demoMode) return 'guided';
  return input.starterMode === 'freeform' ? 'freeform' : 'guided';
}

export interface CanvasStarterCopy {
  title: string;
  subtitle: string;
  hint: string;
}

const COPY: Record<Exclude<CanvasEmptyState, 'none'>, CanvasStarterCopy> = {
  guided: {
    title: '从这里开始',
    subtitle: '点一下添加节点，或右键画布任意位置',
    hint: '也可以从左栏添加 · 当前为本地演示厂商，不出真图',
  },
  freeform: {
    title: '空白画布',
    subtitle: '点一下添加节点，或右键画布任意位置',
    hint: '也可以从左栏添加 · Delete 删除 · Ctrl+D 复制 · Shift 加选',
  },
  linked: {
    title: '关联项目',
    subtitle: '从项目里挑一个起点，或直接添加节点',
    hint: '画布内容会随关联项目一起保存',
  },
};

export function canvasStarterCopy(kind: CanvasEmptyState): CanvasStarterCopy | null {
  return kind === 'none' ? null : COPY[kind];
}
