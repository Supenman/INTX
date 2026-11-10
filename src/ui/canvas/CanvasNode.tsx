import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { getNodeDefinition, type ProjectNode } from '@/domain';
import { latestTaskForNode, useTaskStore } from '@/app/stores/taskStore';

/**
 * 通用节点渲染。
 *
 * 只订阅自己的数据：`useTaskStore` 里用 selector 精确取本节点的最近任务，
 * 别的节点跑任务不会让这个组件重渲染。
 */

export interface CanvasNodeData extends Record<string, unknown> {
  node: ProjectNode;
  onGenerate: (nodeId: string) => void;
}

export const CanvasNode = memo(function CanvasNode({ id, data, selected }: NodeProps) {
  const { node, onGenerate } = data as CanvasNodeData;
  const def = getNodeDefinition(node.defKind);

  const task = useTaskStore((s) => latestTaskForNode(s.tasks, id));

  if (!def) {
    return (
      <div className="node selected">
        <div className="node-head">未知节点</div>
        <div className="node-body">类型「{node.defKind}」未注册</div>
      </div>
    );
  }

  const prompt = typeof node.params.prompt === 'string' ? node.params.prompt : '';
  const content = typeof node.params.content === 'string' ? node.params.content : '';
  const outputKind = typeof node.params.outputKind === 'string' ? node.params.outputKind : 'image';

  return (
    <div
      className={`node${selected ? ' selected' : ''}`}
      style={{ width: node.size.width, minHeight: node.size.height }}
    >
      {def.inputPorts.map((port, i) => (
        <Handle
          key={port.id}
          id={port.id}
          type="target"
          position={Position.Left}
          style={{ top: `${((i + 1) / (def.inputPorts.length + 1)) * 100}%` }}
          title={`${port.label}（${port.accepts.join(' / ')}）`}
        />
      ))}

      <div className="node-head">
        <span className={`node-dot${def.category === 'generate' ? ' generate' : ''}`} />
        {def.title}
      </div>

      <div className="node-body">
        {node.defKind === 'text-input' && (
          <div className="node-prompt">{content || <span className="node-empty">还没有内容</span>}</div>
        )}

        {node.defKind === 'generate' && (
          <>
            <div className="node-prompt">{prompt || <span className="node-empty">还没有提示词</span>}</div>
            <div className="node-field">
              <span>产出</span>
              <b>{outputKind}</b>
            </div>
            <div className="node-field">
              <span>宽高比</span>
              <b>{String(node.params.aspectRatio ?? '1:1')}</b>
            </div>
            <button
              className="node-generate-btn nodrag"
              disabled={task?.status === 'running' || task?.status === 'queued'}
              onClick={() => onGenerate(id)}
            >
              {task?.status === 'running' ? '生成中…' : '生成'}
            </button>
          </>
        )}

        {node.defKind === 'asset' && (
          <div className="node-empty">接入素材后这里显示预览</div>
        )}

        {node.defKind === 'storyboard' && (
          <div className="node-empty">接一张源图，按宫格切分</div>
        )}

        <TaskStatusLine task={task} />
      </div>

      {def.outputPorts.map((port, i) => (
        <Handle
          key={port.id}
          id={port.id}
          type="source"
          position={Position.Right}
          style={{ top: `${((i + 1) / (def.outputPorts.length + 1)) * 100}%` }}
          title={`${port.label}（${port.accepts.join(' / ')}）`}
        />
      ))}
    </div>
  );
});

function TaskStatusLine({ task }: { task: ReturnType<typeof latestTaskForNode> }) {
  if (!task) return null;

  if (task.status === 'running') {
    const hasProgress = task.upstreamProgress !== null;
    return (
      <div className="node-status">
        <span style={{ color: 'var(--accent)' }}>{phaseLabel(task.phase)}</span>
        <span className={`bar${hasProgress ? '' : ' indeterminate'}`}>
          <i style={hasProgress ? { width: `${Math.round(task.upstreamProgress! * 100)}%` } : undefined} />
        </span>
        {hasProgress && <span style={{ fontFamily: 'var(--mono)' }}>{Math.round(task.upstreamProgress! * 100)}%</span>}
      </div>
    );
  }

  if (task.status === 'failed') {
    return (
      <div className="node-status" style={{ color: 'var(--danger)' }} title={task.error?.message}>
        <span>✕ {task.error?.message ?? '失败'}</span>
      </div>
    );
  }

  if (task.status === 'succeeded') {
    return (
      <div className="node-status" style={{ color: 'var(--ok)' }}>
        <span>✓ 完成（第 {task.attempt} 次）</span>
      </div>
    );
  }

  if (task.status === 'queued') {
    return (
      <div className="node-status" style={{ color: 'var(--warn)' }}>
        <span>排队中</span>
      </div>
    );
  }

  return null;
}

function phaseLabel(phase: string | null): string {
  switch (phase) {
    case 'submitting':
      return '提交中';
    case 'generating':
      return '生成中';
    case 'downloading':
      return '下载中';
    default:
      return '处理中';
  }
}
