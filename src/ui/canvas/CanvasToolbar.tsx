import type { ToolDefinition } from '@/domain';
import type { PersistenceState } from '@/app/useCases/usePersistence';
import { Toast } from '@/ui/common/Feedback';
import type { ToolDispatch } from './CanvasTools';

/**
 * 顶部 chip 工具栏：注册表按钮 + 计数 + 保存/告警状态 + toast。
 * 从 Canvas 拆出以守住 800 行结构预算；不持有状态，全部由 props 传入。
 */
export interface CanvasToolbarProps {
  tools: { tool: ToolDefinition; disabled: boolean }[];
  onAction: ToolDispatch;
  providerCount: number;
  nodeCount: number;
  edgeCount: number;
  assetCount: number;
  demoMode: boolean;
  persistence: PersistenceState;
  toast: string | null;
}

export function CanvasToolbar(props: CanvasToolbarProps) {
  const { persistence } = props;
  return (
    <div className="toolbar">
      {props.tools.map(({ tool, disabled }) => (
        <button
          key={tool.id}
          className="chip chip-btn"
          data-tool-id={tool.id}
          onClick={() => props.onAction(tool.action, tool.payload)}
          disabled={disabled}
          title={
            disabled && (tool.id === 'undo' || tool.id === 'redo')
              ? `没有可${tool.id === 'undo' ? '撤销' : '重做'}的操作`
              : tool.hint
          }
        >
          {tool.label}
          {tool.id === 'open-settings' && <b>{props.providerCount}</b>}
        </button>
      ))}
      <span className="chip">
        节点 <b>{props.nodeCount}</b>
      </span>
      <span className="chip">
        连线 <b>{props.edgeCount}</b>
      </span>
      <span className="chip">
        资产 <b>{props.assetCount}</b>
      </span>
      {props.demoMode && (
        <span className="chip warn" title="当前只配置了本地演示厂商，生成的是占位图，不是真实作品">
          演示模式 · 不出真图
        </span>
      )}
      <span className="chip" title={persistence.error ?? undefined}>
        {persistence.status === 'saved' && '已保存'}
        {persistence.status === 'saving' && '保存中…'}
        {persistence.status === 'loading' && '载入中…'}
        {persistence.status === 'idle' && '就绪'}
        {persistence.status === 'error' && <span className="danger-text">保存失败</span>}
      </span>
      {persistence.interruptedTasks > 0 && (
        <span className="chip warn" title="上次退出时未完成的任务已收敛为「已取消」，可点生成重新跑">
          上次有 {persistence.interruptedTasks} 个任务未跑完
        </span>
      )}
      {persistence.integrityIssues.length > 0 && (
        <span className="chip warn" title={persistence.integrityIssues.map((i) => i.message).join('\n')}>
          存档告警 {persistence.integrityIssues.length}
        </span>
      )}
      <Toast message={props.toast} />
    </div>
  );
}
