import type { NodeDefinition, ParamValue } from './definition';

/**
 * 节点类型注册表。
 *
 * 一个 Map + 注册/查询函数。v0.1 只注册四种节点，
 * 但任何新类型（包括未来的插件）都走同一条路径进来，
 * 不需要改 switch，也不需要改扫描式 if 链。
 */

const registry = new Map<string, NodeDefinition>();
const listeners = new Set<() => void>();

export type RegisterConflict = {
  code: 'duplicate_kind';
  message: string;
};

export function registerNode(def: NodeDefinition): { ok: true } | { ok: false; error: RegisterConflict } {
  if (registry.has(def.kind)) {
    return {
      ok: false,
      error: { code: 'duplicate_kind', message: `节点类型「${def.kind}」已注册` },
    };
  }
  registry.set(def.kind, def);
  notify();
  return { ok: true };
}

/** 仅测试与插件热加载用：覆盖已注册的定义。 */
export function overrideNode(def: NodeDefinition): void {
  registry.set(def.kind, def);
  notify();
}

export function unregisterNode(kind: string): boolean {
  const removed = registry.delete(kind);
  if (removed) notify();
  return removed;
}

export function getNodeDefinition(kind: string): NodeDefinition | undefined {
  return registry.get(kind);
}

/** 必须存在——调用方在不该失败的地方用。找不到直接抛，暴露注册遗漏。 */
export function requireNodeDefinition(kind: string): NodeDefinition {
  const def = registry.get(kind);
  if (!def) {
    throw new Error(`未注册的节点类型：${kind}`);
  }
  return def;
}

export function listNodeDefinitions(): NodeDefinition[] {
  return [...registry.values()];
}

export function listByCategory(category: NodeDefinition['category']): NodeDefinition[] {
  return listNodeDefinitions().filter((d) => d.category === category);
}

export function subscribeRegistry(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(): void {
  for (const fn of listeners) fn();
}

export type { NodeDefinition, ParamValue };
