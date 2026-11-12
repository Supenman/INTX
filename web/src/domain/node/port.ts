import type { AssetKind } from '../asset/model';

/**
 * Port —— 节点的输入/输出口。
 *
 * 旧架构的连线只记录"从 A 到 B"，传什么内容是运行时靠 sourceType 猜的，
 * 猜错就等到生成阶段才报一个莫名其妙的错。
 *
 * 新架构把语义前移到连线阶段：每个端口声明自己接受哪些类型，
 * 一个只吃图片的输入口，在被连上文字节点的那一刻就应该被拒绝。
 */

/** 端口可承载的数据类型。比 AssetKind 多一个 'text' 之外的概念，便于扩展。 */
export type PortType = AssetKind | 'any';

export interface PortSpec {
  id: string;
  label: string;
  accepts: readonly PortType[];
  /** 是否允许多路输入（如多参考图） */
  multiple: boolean;
  required: boolean;
}

export function acceptsType(port: PortSpec, type: PortType): boolean {
  return port.accepts.includes('any') || port.accepts.includes(type);
}

export type PortIssueCode = 'unknown_port' | 'type_mismatch' | 'capacity_exceeded' | 'self_connection';

export interface PortIssue {
  code: PortIssueCode;
  message: string;
}

export interface ConnectionIntent {
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
}

/** 已存在的连线（只保留校验需要的字段，避免领域层依赖画布模型）。 */
export interface ExistingEdge {
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
}

export interface ValidateConnectionInput {
  intent: ConnectionIntent;
  /** 源节点的输出口 */
  sourcePort: PortSpec | undefined;
  /** 目标节点的输入口 */
  targetPort: PortSpec | undefined;
  /** 源端口实际承载的类型（由源节点产出的 asset kind 决定） */
  sourceType: PortType;
  /** 该目标端口上已有的连线 */
  existingEdges: readonly ExistingEdge[];
}

/**
 * 校验一条连线是否合法。返回全部问题而不是只报第一个，
 * 便于 UI 一次性把原因说清。
 */
export function validateConnection(input: ValidateConnectionInput): PortIssue[] {
  const { intent, sourcePort, targetPort, sourceType, existingEdges } = input;
  const issues: PortIssue[] = [];

  if (intent.sourceNodeId === intent.targetNodeId) {
    issues.push({ code: 'self_connection', message: '节点不能连接到自身' });
  }
  if (!sourcePort) {
    issues.push({ code: 'unknown_port', message: `源节点没有输出口「${intent.sourcePortId}」` });
  }
  if (!targetPort) {
    issues.push({ code: 'unknown_port', message: `目标节点没有输入口「${intent.targetPortId}」` });
  }
  if (!sourcePort || !targetPort) return issues;

  if (!acceptsType(targetPort, sourceType)) {
    issues.push({
      code: 'type_mismatch',
      message: `「${targetPort.label}」只接受 ${targetPort.accepts.join(' / ')}，而来源是 ${sourceType}`,
    });
  }

  if (!targetPort.multiple) {
    const occupied = existingEdges.filter(
      (e) => e.targetNodeId === intent.targetNodeId && e.targetPortId === intent.targetPortId,
    );
    if (occupied.length > 0) {
      issues.push({
        code: 'capacity_exceeded',
        message: `「${targetPort.label}」只能接一路输入，请先断开已有连线`,
      });
    }
  }

  return issues;
}

export function isValidConnection(input: ValidateConnectionInput): boolean {
  return validateConnection(input).length === 0;
}
