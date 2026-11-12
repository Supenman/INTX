import { resolveNodeContextMenu, type ToolContext } from '@/domain';
import type { ToolDispatch } from './CanvasTools';

/**
 * 节点右键菜单。
 *
 * 单节点态 / 多选态由注册表的 applicable 分流（见 definitions.ts），
 * 这里只渲染解析结果。多选标签带数量（「删除 3 个节点」），
 * 让用户在点下去之前就知道这次动作影响几个节点。
 */
export interface NodeContextMenuProps {
  x: number;
  y: number;
  ctx: ToolContext;
  onAction: ToolDispatch;
  onClose: () => void;
}

export function NodeContextMenu({ x, y, ctx, onAction, onClose }: NodeContextMenuProps) {
  const commands = resolveNodeContextMenu(ctx);
  if (commands.length === 0) return null;

  return (
    <>
      <div className="menu-backdrop" onClick={onClose} onContextMenu={(e) => e.preventDefault()} />
      <div className="add-menu node-context-menu" style={{ left: x, top: y }} role="menu">
        <div className="add-menu-head">
          {ctx.selectedCount >= 2 ? `已选 ${ctx.selectedCount} 个节点` : '节点'}
        </div>
        {commands.map((command) => (
          <button
            key={command.id}
            role="menuitem"
            data-tool-id={command.id}
            className={command.danger ? 'danger' : ''}
            disabled={command.disabled}
            onClick={() => {
              onAction(command.action, command.payload);
              onClose();
            }}
          >
            {command.label}
          </button>
        ))}
        <div className="add-menu-foot">Delete 删除 · Ctrl+D 复制 · Esc 关闭</div>
      </div>
    </>
  );
}
