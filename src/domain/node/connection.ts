import type { ConnectionIntent, ExistingEdge, PortSpec, PortType } from './port';

/**
 * 连线语义的单一来源。
 *
 * 之前这里有个真实缺陷：`connectNodes()` 写了「单路输入口再连一根就替换旧边」，
 * 但它调用的 `validateConnection()` 会先把那根旧边算成 `capacity_exceeded`
 * 并直接返回失败 —— 替换代码根本执行不到，UI 的 `isValidConnection` 也把
 * 用户拖过去的线挡掉了。store 与画布各自算了一遍「旧边算不算占用」，
 * 结论还不一致。
 *
 * 现在两处都调用 `effectiveExistingEdges()`：单路输入口上指向同一端口的旧边
 * 属于「即将被替换」，不参与容量校验。
 */
export function effectiveExistingEdges(
  existing: readonly ExistingEdge[],
  intent: ConnectionIntent,
  targetPort: PortSpec | undefined,
): ExistingEdge[] {
  if (!targetPort || targetPort.multiple) return [...existing];
  return existing.filter(
    (e) => !(e.targetNodeId === intent.targetNodeId && e.targetPortId === intent.targetPortId),
  );
}

const TYPE_LABELS: Readonly<Record<string, string>> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  text: '文字',
  table_data: '表格',
  any: '任意类型',
};

export function portTypeLabel(type: PortType | string): string {
  return TYPE_LABELS[type] ?? type;
}

/**
 * 只需要 code / message 两个字段：调用方可能来自 store 的 ConnectResult，
 * 那里的类型比 domain 的 PortIssue 更宽，不该为了显示一行提示去强转。
 */
export interface PortIssueLike {
  code: string;
  message: string;
}

/** 把校验结果说成人话：不把 `image / text` 这种内部枚举原样丢给用户。 */
export function describePortIssue(issue: PortIssueLike): string {
  if (issue.code === 'capacity_exceeded') {
    return '这个输入口只接一路，新连线会替换原有连线';
  }
  if (issue.code === 'type_mismatch') {
    return Object.entries(TYPE_LABELS).reduce(
      (message, [raw, label]) => message.replace(new RegExp(`\\b${raw}\\b`, 'g'), label),
      issue.message,
    );
  }
  return issue.message;
}

export function describePortIssues(issues: readonly PortIssueLike[]): string {
  return issues.map(describePortIssue).join('；');
}
