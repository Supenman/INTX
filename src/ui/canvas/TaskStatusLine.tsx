import { readTaskOutcome } from '@/domain';
import type { latestTaskForNode } from '@/app/stores/taskStore';
import type { RunGenerationOptions } from '@/app/useCases/runGeneration';
import { outcomeCopy } from './outcomeCopy';

/**
 * 节点任务状态行。从 CanvasNode 拆出守结构预算；failed 态文案/按钮
 * 结构一字不动（outcome-policy e2e 锁着），只新增 canceled 态的补格入口。
 *
 * 判定全在 domain（readTaskOutcome），文案全在 outcomeCopy，这里只渲染。
 */
export interface TaskStatusLineProps {
  task: ReturnType<typeof latestTaskForNode>;
  nodeId: string;
  onGenerate: (nodeId: string, options?: RunGenerationOptions) => void;
  /** 分镜且已有产物 < 当前格数：canceled 态给「继续补齐」入口 */
  canResume: boolean;
  /** generate 节点 canceled 态给「重新生成」入口 */
  canRegenerate: boolean;
}

export function TaskStatusLine({ task, nodeId, onGenerate, canResume, canRegenerate }: TaskStatusLineProps) {
  if (!task) return null;

  if (task.status === 'running') {
    const hasProgress = task.upstreamProgress !== null;
    return (
      <div className="node-status running">
        <span className="phase">{phaseLabel(task.phase)}</span>
        <span className={`bar${hasProgress ? '' : ' indeterminate'}`}>
          <i style={hasProgress ? { width: `${Math.round(task.upstreamProgress! * 100)}%` } : undefined} />
        </span>
        {hasProgress && <span className="mono">{Math.round(task.upstreamProgress! * 100)}%</span>}
      </div>
    );
  }

  if (task.status === 'failed') {
    /**
     * 失败态只查 domain 算出来的三态，不在渲染里按错误码分支。
     * 之前 submission_uncertain 是这里的一个特判，加一个码就要改一次 UI；
     * 现在新增错误码只改 `domain/task/outcome.ts`，文案只改 outcomeCopy.ts。
     */
    const outcome = readTaskOutcome(task);
    const copy = outcomeCopy(outcome);
    return (
      <div className="node-status failed" title={copy.hint}>
        <span className="err-text">
          {copy.badge} {task.error?.message ?? '失败'}
        </span>
        {copy.action && (
          <button
            className="link-btn nodrag"
            onClick={() => {
              // 点了确认就真的跑一次，而且只补缺失的分镜格。
              // 以前只把状态改回 queued：busy 判定会把按钮变成「取消」，
              // 用户永远点不到执行，任务就那么卡着。
              onGenerate(nodeId, { resume: true });
            }}
          >
            {copy.action}
          </button>
        )}
      </div>
    );
  }

  if (task.status === 'succeeded') {
    return (
      <div className="node-status succeeded">
        <span>✓ 完成（第 {task.attempt} 次）</span>
      </div>
    );
  }

  if (task.status === 'queued') {
    return (
      <div className="node-status queued">
        <span>排队中</span>
      </div>
    );
  }

  if (task.status === 'canceled') {
    // outcome 把 canceled 判为 not_charged/allowed，UI 终于用上：
    // 分镜跑一半取消，已出的格保留，给「继续补齐」而不是逼用户整批重买。
    return (
      <div className="node-status canceled" title={task.error?.message}>
        <span>已取消{task.error ? ` · ${task.error.message}` : ''}</span>
        {canResume && (
          <button className="link-btn nodrag" onClick={() => onGenerate(nodeId, { resume: true })}>
            继续补齐（已出的保留）
          </button>
        )}
        {!canResume && canRegenerate && (
          <button className="link-btn nodrag" onClick={() => onGenerate(nodeId)}>
            重新生成
          </button>
        )}
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
