import { beforeEach, describe, expect, it } from 'vitest';
import { builtinNodes } from '../node/builtins';
import { overrideNode, unregisterNode } from '../node/registry';
import { canvasStarterCopy, resolveCanvasEmptyState } from './canvasStarter';
import { installBuiltinTools } from './definitions';
import type { ToolContext } from './definition';
import {
  defaultToolbarPrefs,
  getToolbarTools,
  migrateToolbarPrefs,
  resetToolRegistry,
  resolveAddNodeMenuCommands,
  resolveToolbarEntries,
  resolveToolbarTools,
} from './registry';

const baseCtx: ToolContext = {
  toolMode: 'select',
  selectedCount: 2,
  nodeCount: 0,
  clipboardCount: 0,
  canUndo: true,
  canRedo: false,
  demoMode: true,
  node: null,
};

const nodeCtx = (over: Partial<ToolContext['node']> = {}): ToolContext => ({
  ...baseCtx,
  node: { kind: 'generate', category: 'generate', hasAsset: false, busy: false, ...over },
});

beforeEach(() => {
  resetToolRegistry();
  installBuiltinTools();
});

describe('工具注册表', () => {
  it('注册是幂等的：HMR 重复执行不会长出重复按钮', () => {
    const before = getToolbarTools('selection').length;
    installBuiltinTools();
    installBuiltinTools();
    expect(getToolbarTools('selection').length).toBe(before);
    expect(new Set(getToolbarTools('selection').map((t) => t.id)).size).toBe(before);
  });

  it('按 defaultOrder 排序，left 对齐排在删除之前', () => {
    const ids = getToolbarTools('selection').map((t) => t.id);
    expect(ids.indexOf('align-left')).toBeLessThan(ids.indexOf('delete-selection'));
  });

  it('applicable 决定出现与否：生成节点显示「生成」，忙时换成「取消」', () => {
    expect(resolveToolbarTools('node-hover', baseCtx, null)).toHaveLength(0);
    const idle = resolveToolbarTools('node-hover', nodeCtx(), null).map((t) => t.id);
    expect(idle).toContain('node-generate');
    expect(idle).not.toContain('node-cancel');
    const busy = resolveToolbarTools('node-hover', nodeCtx({ busy: true }), null).map((t) => t.id);
    expect(busy).toContain('node-cancel');
    expect(busy).not.toContain('node-generate');
  });

  it('文字节点不会出现生成按钮（不为每种节点写一条 if）', () => {
    const ids = resolveToolbarTools('node-hover', nodeCtx({ category: 'source', kind: 'text-input' }), null).map(
      (t) => t.id,
    );
    expect(ids).toEqual(['node-duplicate', 'node-delete']);
  });

  it('disabled 由 ctx 计算：少于 3 个节点时等距按钮灰掉', () => {
    const two = resolveToolbarEntries('selection', baseCtx, null);
    const three = resolveToolbarEntries('selection', { ...baseCtx, selectedCount: 3 }, null);
    const find = (entries: typeof two, id: string) =>
      entries.find((e) => e.kind === 'tool' && e.tool.id === id);
    expect(find(two, 'distribute-horizontal')).toMatchObject({ disabled: true });
    expect(find(three, 'distribute-horizontal')).toMatchObject({ disabled: false });
  });

  it('用户排序与隐藏生效，且未列出的新工具仍会被补进来', () => {
    const prefs = { version: 1 as const, order: ['delete-selection', 'align-left'], hidden: ['chain-selection'] };
    const ids = resolveToolbarTools('selection', baseCtx, prefs).map((t) => t.id);
    expect(ids.slice(0, 2)).toEqual(['delete-selection', 'align-left']);
    expect(ids).not.toContain('chain-selection');
    expect(ids).toContain('align-right');
  });

  it('category 变化处自动插分隔线，顺序仍与解析结果一致', () => {
    const tools = resolveToolbarTools('selection', baseCtx, null).map((t) => t.id);
    const entries = resolveToolbarEntries('selection', baseCtx, null);
    expect(entries.some((e) => e.kind === 'separator')).toBe(true);
    expect(entries.filter((e) => e.kind === 'tool').map((e) => (e.kind === 'tool' ? e.tool.id : ''))).toEqual(tools);
  });

  it('破坏性操作默认隐藏，不进默认工具栏', () => {
    expect(defaultToolbarPrefs('main').hidden).toContain('clear-canvas');
  });
});

describe('工具栏偏好迁移', () => {
  it('脏数据回落到默认偏好，不抛错', () => {
    for (const raw of [null, undefined, 42, 'x', {}, { order: 'nope' }]) {
      expect(migrateToolbarPrefs('main', raw).version).toBe(1);
    }
  });

  it('旧版「抓手 / 框选」两个 id 合并成 switch 且不留重复', () => {
    const prefs = migrateToolbarPrefs('main', {
      order: ['tool-move', 'undo', 'tool-box-select', 'redo'],
      hidden: [],
    });
    expect(prefs.order.filter((id) => id === 'tool-canvas-mode')).toHaveLength(1);
    expect(prefs.order.indexOf('undo')).toBeLessThan(prefs.order.indexOf('redo'));
  });

  it('新增工具按 defaultOrder 插入，用户已有的相对顺序不变', () => {
    const prefs = migrateToolbarPrefs('main', { order: ['arrange-all', 'undo'], hidden: [] });
    // 新工具会插到合适位置，因此不能断言「前两个还是用户那两个」；
    // 真正不能破的是用户排列出来的相对先后。
    expect(prefs.order.indexOf('arrange-all')).toBeLessThan(prefs.order.indexOf('undo'));
    for (const def of getToolbarTools('main')) expect(prefs.order).toContain(def.id);
    expect(new Set(prefs.order).size).toBe(prefs.order.length);
  });

  it('更旧的 visible 白名单格式等价转成 hidden', () => {
    const prefs = migrateToolbarPrefs('main', { visible: ['undo'] });
    expect(prefs.hidden).toContain('redo');
    expect(prefs.hidden).not.toContain('undo');
  });

  it('已删除工具的 id 会被清掉', () => {
    const prefs = migrateToolbarPrefs('main', { order: ['ghost-tool', 'undo'], hidden: ['ghost-tool'] });
    expect(prefs.order).not.toContain('ghost-tool');
    expect(prefs.hidden).not.toContain('ghost-tool');
  });
});

describe('添加菜单动态跟随节点注册表', () => {
  it('新增节点类型不需要改菜单代码', () => {
    const before = resolveAddNodeMenuCommands(baseCtx).map((c) => c.label);
    const custom = {
      ...builtinNodes[0]!,
      kind: 'custom-for-menu-test',
      title: '测试用节点',
    };
    overrideNode(custom);
    const after = resolveAddNodeMenuCommands(baseCtx);
    expect(before).not.toContain('测试用节点');
    expect(after.map((c) => c.label)).toContain('测试用节点');
    const entry = after.find((c) => c.label === '测试用节点');
    expect(entry).toMatchObject({ action: 'add-node', payload: { kind: 'custom-for-menu-test' } });
    unregisterNode('custom-for-menu-test');
  });

  it('剪贴板为空时粘贴给出理由，复制后恢复可用', () => {
    const empty = resolveAddNodeMenuCommands(baseCtx).find((c) => c.id === 'menu-paste');
    expect(empty?.disabledReason).toBeTruthy();
    const ready = resolveAddNodeMenuCommands({ ...baseCtx, clipboardCount: 2 }).find((c) => c.id === 'menu-paste');
    expect(ready?.disabledReason).toBeNull();
  });

  it('画布动作排在节点条目之后', () => {
    const list = resolveAddNodeMenuCommands(baseCtx);
    const lastNode = Math.max(...list.filter((c) => c.action === 'add-node').map((c) => c.defaultOrder));
    for (const c of list.filter((x) => x.action !== 'add-node')) expect(c.defaultOrder).toBeGreaterThan(lastNode);
  });
});

describe('空画布起始状态', () => {
  it('有节点时不需要起始框', () => {
    expect(resolveCanvasEmptyState({ nodeCount: 3, demoMode: true })).toBe('none');
    expect(canvasStarterCopy('none')).toBeNull();
  });

  it('演示厂商给引导态，且文案明确写出不出真图', () => {
    expect(resolveCanvasEmptyState({ nodeCount: 0, demoMode: true })).toBe('guided');
    expect(canvasStarterCopy('guided')?.hint).toContain('不出真图');
  });

  it('接了真实厂商后换成自由起始态', () => {
    expect(resolveCanvasEmptyState({ nodeCount: 0, demoMode: false, starterMode: 'freeform' })).toBe('freeform');
    expect(canvasStarterCopy('freeform')?.hint).not.toContain('不出真图');
  });

  it('关联项目优先于演示模式', () => {
    expect(resolveCanvasEmptyState({ nodeCount: 0, demoMode: true, isProjectLinked: true })).toBe('linked');
  });
});
