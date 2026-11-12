import { listNodeDefinitions } from '../node/registry';
import type {
  AddNodeCommand,
  ToolContext,
  ToolDefinition,
  ToolEntry,
  ToolbarId,
  ToolbarPrefs,
} from './definition';

/** 菜单条目：countLabel 的工具把 {n} 替换成选中数量。 */
export interface ContextMenuCommand {
  id: string;
  label: string;
  action: string;
  payload?: Readonly<Record<string, string>>;
  danger: boolean;
  disabled: boolean;
  category: ToolDefinition['category'];
}

/**
 * 工具注册表与解析管线。
 *
 * 与节点注册表同构：一个 Map + 注册/查询函数。新增一种工具 = 加一条定义并注册，
 * 不需要改任何组件里的 if 链，也不需要给 ToolbarHandlers 加一个回调字段。
 */

const registry = new Map<string, ToolDefinition>();
/** 保留首次插入顺序，重复注册时覆盖内容但不追加（Vite HMR 会重复执行定义模块）。 */
const order: string[] = [];

export function registerTools(defs: readonly ToolDefinition[]): void {
  for (const def of defs) {
    if (!registry.has(def.id)) order.push(def.id);
    registry.set(def.id, def);
  }
}

/** 测试与未来的扩展点热加载用。 */
export function unregisterTool(id: string): boolean {
  const removed = registry.delete(id);
  const at = order.indexOf(id);
  if (at >= 0) order.splice(at, 1);
  return removed;
}

/** 仅测试用：清空注册表，避免用例之间互相污染。 */
export function resetToolRegistry(): void {
  registry.clear();
  order.length = 0;
}

export function getToolbarTools(toolbar: ToolbarId): ToolDefinition[] {
  return order
    .map((id) => registry.get(id))
    .filter((d): d is ToolDefinition => Boolean(d && d.toolbar === toolbar))
    .sort((a, b) => a.defaultOrder - b.defaultOrder);
}

export function defaultToolbarPrefs(toolbar: ToolbarId): ToolbarPrefs {
  const tools = getToolbarTools(toolbar);
  return {
    version: 1,
    order: tools.map((t) => t.id),
    hidden: tools.filter((t) => !t.defaultVisible).map((t) => t.id),
  };
}

/**
 * 旧版把「抓手」「框选」注册成两个独立按钮，后来合并成一个 switch。
 * 用户已经拖过的排序不能因为这次合并被重置，所以迁移时把旧 id 映射到新 id。
 */
export const LEGACY_TOOL_IDS: Readonly<Record<string, string>> = {
  'tool-move': 'tool-canvas-mode',
  'tool-box-select': 'tool-canvas-mode',
};

/**
 * 把任意来源（localStorage / 旧版本 / 脏数据）的偏好归一化成当前有效的偏好。
 * 三条不变式：不重置用户排序、不丢掉新增工具、不留下已删除工具的 id。
 */
export function migrateToolbarPrefs(toolbar: ToolbarId, raw: unknown): ToolbarPrefs {
  const defs = getToolbarTools(toolbar);
  const fallback = defaultToolbarPrefs(toolbar);
  if (!raw || typeof raw !== 'object') return fallback;

  const source = raw as { order?: unknown; hidden?: unknown; visible?: unknown };
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  const remap = (id: string) => LEGACY_TOOL_IDS[id] ?? id;
  const known = new Set(defs.map((d) => d.id));
  const unique = (list: string[]) => [...new Set(list.map(remap))].filter((id) => known.has(id));

  let hidden = unique(strings(source.hidden));
  // 更旧的格式只存 visible 白名单，等价于「其余全部隐藏」。
  if (!Array.isArray(source.hidden) && Array.isArray(source.visible)) {
    const visible = new Set(unique(strings(source.visible)));
    hidden = defs.filter((d) => !visible.has(d.id)).map((d) => d.id);
  }

  const userOrder = unique(strings(source.order));
  const byId = new Map(defs.map((d) => [d.id, d]));
  const result = [...userOrder];
  // 新增工具按 defaultOrder 插到合适位置，用户已有顺序保持不变。
  for (const def of defs) {
    if (result.includes(def.id)) continue;
    const at = result.findIndex((id) => (byId.get(id)?.defaultOrder ?? 0) > def.defaultOrder);
    if (at < 0) result.push(def.id);
    else result.splice(at, 0, def.id);
  }

  return { version: 1, order: result, hidden };
}

/**
 * 解析工具栏：过滤 applicable → 应用用户排序 → 过滤隐藏。
 * prefs 传 null 时用默认偏好，方便单测与首次渲染。
 */
export function resolveToolbarTools(
  toolbar: ToolbarId,
  ctx: ToolContext,
  prefs: ToolbarPrefs | null,
): ToolDefinition[] {
  const effective = prefs ?? defaultToolbarPrefs(toolbar);
  const hidden = new Set(effective.hidden);
  const rank = new Map(effective.order.map((id, i) => [id, i]));
  return getToolbarTools(toolbar)
    .filter((t) => !t.applicable || t.applicable(ctx))
    .filter((t) => !hidden.has(t.id))
    .sort((a, b) => {
      const ai = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const bi = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      return ai !== bi ? ai - bi : a.defaultOrder - b.defaultOrder;
    });
}

/** 在 category 变化处插分隔线；danger 工具由 UI 自己加 class，不单独分组。 */
export function resolveToolbarEntries(
  toolbar: ToolbarId,
  ctx: ToolContext,
  prefs: ToolbarPrefs | null,
): ToolEntry[] {
  const tools = resolveToolbarTools(toolbar, ctx, prefs);
  const entries: ToolEntry[] = [];
  let previous: string | null = null;
  let sep = 0;
  for (const tool of tools) {
    if (previous !== null && previous !== tool.category) {
      entries.push({ kind: 'separator', id: `sep-${toolbar}-${sep}` });
      sep += 1;
    }
    entries.push({
      kind: 'tool',
      tool,
      disabled: Boolean(tool.disabled?.(ctx)),
      active: Boolean(tool.active?.(ctx)),
    });
    previous = tool.category;
  }
  return entries;
}

/**
 * 添加菜单：节点条目**动态**取自节点注册表，画布动作取自本注册表。
 * 因此新增节点类型时，菜单、侧栏、校验都不需要改 UI 代码。
 */
export function resolveAddNodeMenuCommands(ctx: ToolContext): AddNodeCommand[] {
  const nodes: AddNodeCommand[] = listNodeDefinitions().map((def, i) => ({
    id: `node:${def.kind}`,
    label: def.title,
    section: def.category,
    defaultOrder: 10 + i,
    action: 'add-node',
    payload: { kind: def.kind },
    disabledReason: null,
  }));

  const actions: AddNodeCommand[] = getToolbarTools('add-node-menu')
    .filter((t) => !t.applicable || t.applicable(ctx))
    .map((t) => ({
      id: t.id,
      label: t.label,
      section: t.section ?? 'canvas',
      defaultOrder: t.defaultOrder,
      action: t.action,
      payload: t.payload,
      disabledReason: t.disabled?.(ctx) ? t.hint : null,
    }));

  return [...nodes, ...actions].sort((a, b) => a.defaultOrder - b.defaultOrder);
}

/**
 * 节点右键菜单：单节点态与多选态由同一张注册表按 applicable 分流，
 * 多选标签里的 {n} 在这里替换成数量。UI 只渲染，不写「几个节点显示什么」的 if。
 */
export function resolveNodeContextMenu(ctx: ToolContext): ContextMenuCommand[] {
  return getToolbarTools('node-context-menu')
    .filter((t) => !t.applicable || t.applicable(ctx))
    .map((t) => ({
      id: t.id,
      label: t.countLabel ? t.label.replace('{n}', String(ctx.selectedCount)) : t.label,
      action: t.action,
      payload: t.payload,
      danger: Boolean(t.danger),
      disabled: Boolean(t.disabled?.(ctx)),
      category: t.category,
    }));
}
