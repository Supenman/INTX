import type { MouseEvent } from 'react';
import {
  canvasStarterCopy,
  getToolbarTools,
  resolveAddNodeMenuCommands,
  resolveToolbarEntries,
  resolveToolbarTools,
  type CanvasEmptyState,
  type ToolContext,
  type ToolbarId,
  type ToolbarPrefs,
} from '@/domain';

export type { ToolMode } from '@/domain';

/**
 * 画布浮层 UI —— 全部由声明式工具注册表解析出来。
 *
 * 这些组件不读 store、不写图，只做两件事：把 ToolContext 交给解析函数，
 * 把解析结果渲染成按钮；点击时把 `action` 交回 Canvas 统一 dispatch。
 * 因此「新增一个工具」只需在 domain 加一条定义，不用碰这里任何一行。
 */

export type ToolDispatch = (action: string, payload?: Readonly<Record<string, string>>) => void;

const prefFor = (prefs: Record<ToolbarId, ToolbarPrefs> | null, toolbar: ToolbarId): ToolbarPrefs | null =>
  prefs?.[toolbar] ?? null;

const MENU_SECTIONS: { id: 'source' | 'generate' | 'utility' | 'canvas'; title: string }[] = [
  { id: 'source', title: '素材与输入' },
  { id: 'generate', title: '生成' },
  { id: 'utility', title: '工具' },
  { id: 'canvas', title: '画布' },
];

export function ModeSwitch({
  ctx,
  prefs,
  onAction,
}: {
  ctx: ToolContext;
  prefs: Record<ToolbarId, ToolbarPrefs> | null;
  onAction: ToolDispatch;
}) {
  // 抓手 / 区域选择是同一个工具的 switch，不是两个手写的按钮。
  const modeTool = resolveToolbarTools('main', ctx, prefFor(prefs, 'main')).find(
    (t) => t.id === 'tool-canvas-mode',
  );
  if (!modeTool?.switchOptions) return null;
  const current = modeTool.switchValue?.(ctx) ?? ctx.toolMode;

  return (
    <div className="mode-switch" role="group" aria-label="画布工具">
      {modeTool.switchOptions.map((option) => (
        <button
          key={option.id}
          data-tool-id={modeTool.id}
          className={current === option.value ? 'active' : ''}
          onClick={() => onAction('set-tool-mode', { mode: option.value })}
          title={modeTool.hint}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** 框选多个节点后出现的悬浮栏；单选时不打扰。 */
export function SelectionToolbar({
  ctx,
  prefs,
  onAction,
}: {
  ctx: ToolContext;
  prefs: Record<ToolbarId, ToolbarPrefs> | null;
  onAction: ToolDispatch;
}) {
  if (ctx.selectedCount < 2) return null;
  const entries = resolveToolbarEntries('selection', ctx, prefFor(prefs, 'selection'));
  return (
    <div className="selection-toolbar" role="toolbar" aria-label={`已选中 ${ctx.selectedCount} 个节点`}>
      <span className="selection-count">已选 {ctx.selectedCount}</span>
      <span className="toolbar-sep" />
      {entries.map((entry) =>
        entry.kind === 'separator' ? (
          <span className="toolbar-sep" key={entry.id} />
        ) : (
          <button
            key={entry.tool.id}
            data-tool-id={entry.tool.id}
            className={entry.tool.danger ? 'danger' : ''}
            disabled={entry.disabled}
            title={entry.tool.hint}
            onClick={() => onAction(entry.tool.action, entry.tool.payload)}
          >
            {entry.tool.label}
          </button>
        ),
      )}
    </div>
  );
}

export interface AddMenuProps {
  x: number;
  y: number;
  ctx: ToolContext;
  prefs: Record<ToolbarId, ToolbarPrefs> | null;
  onAction: ToolDispatch;
  onToggleTool: (toolbar: ToolbarId, toolId: string, hidden: boolean) => void;
  onClose: () => void;
}

/** 右键空白处 / 空画布起始框共用的添加菜单，节点条目由节点注册表动态生成。 */
export function AddMenu(props: AddMenuProps) {
  const commands = resolveAddNodeMenuCommands(props.ctx);
  const selectionTools = getToolbarTools('selection');
  const hidden = new Set(prefFor(props.prefs, 'selection')?.hidden ?? []);

  return (
    <>
      <div className="menu-backdrop" onClick={props.onClose} onContextMenu={(e) => e.preventDefault()} />
      <div className="add-menu" style={{ left: props.x, top: props.y }} role="menu">
        <div className="add-menu-head">添加节点</div>
        {MENU_SECTIONS.map((section) => {
          const items = commands.filter((c) => c.section === section.id);
          if (items.length === 0) return null;
          return (
            <div className="add-menu-group" key={section.id}>
              <div className="add-menu-label">{section.title}</div>
              {items.map((command) => (
                <button
                  key={command.id}
                  role="menuitem"
                  data-tool-id={command.id}
                  disabled={command.disabledReason !== null}
                  title={command.disabledReason ?? undefined}
                  onClick={() => props.onAction(command.action, command.payload)}
                >
                  {command.label}
                  {command.id === 'menu-paste' && (
                    <span className="add-menu-suffix">
                      {command.disabledReason ? '(剪贴板为空)' : '(Ctrl+V)'}
                    </span>
                  )}
                </button>
              ))}
            </div>
          );
        })}
        <div className="add-menu-group">
          <div className="add-menu-label">工具栏显示</div>
          <div className="add-menu-toggles">
            {selectionTools.map((tool) => (
              <label key={tool.id} className="add-menu-toggle">
                <input
                  type="checkbox"
                  data-tool-toggle={tool.id}
                  checked={!hidden.has(tool.id)}
                  onChange={(e) => props.onToggleTool('selection', tool.id, !e.target.checked)}
                />
                {tool.label}
              </label>
            ))}
          </div>
        </div>
        <div className="add-menu-foot">Delete 删除 · Ctrl+D 复制 · Shift 加选</div>
      </div>
    </>
  );
}

/** 空画布中央的起始框：只提供入口，不创建占位节点；文案由 domain 决策。 */
export function CanvasStarter({
  kind,
  onOpen,
}: {
  kind: CanvasEmptyState;
  onOpen: (e: MouseEvent) => void;
}) {
  const copy = canvasStarterCopy(kind);
  if (!copy) return null;
  return (
    <button className="canvas-starter" onClick={onOpen} title="打开添加菜单">
      <span className="canvas-starter-plus">+</span>
      <strong>{copy.title}</strong>
      <span>{copy.subtitle}</span>
      <span className="canvas-starter-hint">{copy.hint}</span>
    </button>
  );
}
