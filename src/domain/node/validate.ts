import type { NodeDefinition } from './definition';
import type { ProjectNode } from '../schema/project';

/**
 * 连线合法性校验（前置校验）。
 *
 * 与 `port.ts` 的差别：
 * - `port.ts` 管"两个端口能不能接"（连线的当下）
 * - 这里管"这个节点现在能不能跑"（提交的当下）
 *
 * 旧代码把后者做成了运行时异常：点生成 → 后端报 400 → 前端把 400 原文
 * 塞进 `task.error` 给用户看。用户看不懂 "prompt is required"。
 *
 * 这里提前查出来，并且给出**具体到端口**的说明，让 UI 能直接把用户指到
 * 那个没接上的口子上。
 */

export type MissingInputCode = 'missing_required_input';

export interface MissingInput {
  code: MissingInputCode;
  portId: string;
  portLabel: string;
  message: string;
}

export interface ConnectionLookup {
  /** 返回指向 targetNodeId 的所有连线，取其中的 sourcePortId */
  incomingEdgeCount: (targetNodeId: string, targetPortId: string) => number;
}

/**
 * 检查节点提交前是否满足定义里的必填输入口。
 *
 * 只看端口是否被连上，不关心上游节点是否已有产物 ——
 * 上游没产物是"上游的问题"，会在上游自己的运行时暴露，
 * 不应该让下游提前报一个看不懂的错。
 */
export function checkRequiredInputs(
  node: ProjectNode,
  def: NodeDefinition,
  edges: ConnectionLookup,
): MissingInput[] {
  const missing: MissingInput[] = [];
  for (const port of def.inputPorts) {
    if (!port.required) continue;
    if (edges.incomingEdgeCount(node.id, port.id) > 0) continue;
    missing.push({
      code: 'missing_required_input',
      portId: port.id,
      portLabel: port.label,
      message: `「${def.title}」的必填输入「${port.label}」还没有连上`,
    });
  }
  return missing;
}

/** 节点自身的参数是否够跑。目前只查 prompt 这类文本必填项。 */
export interface ParamIssue {
  code: 'empty_param';
  paramId: string;
  message: string;
}

/**
 * 生成节点允许「提示词」来自两个地方：上游连线，或节点自己的输入框。
 * 两者都有时以上游为准（连线是更明确的意图），这也是旧代码没做好的地方——
 * 旧代码同时读两处，谁覆盖谁取决于执行顺序。
 */
export function resolvePrompt(node: ProjectNode, upstreamText: string | null): string {
  if (upstreamText !== null && upstreamText.trim() !== '') return upstreamText.trim();
  const own = typeof node.params.prompt === 'string' ? node.params.prompt : '';
  return own.trim();
}

export function checkPrompt(prompt: string): ParamIssue | null {
  if (prompt !== '') return null;
  return { code: 'empty_param', paramId: 'prompt', message: '还没有提示词：接一个文字节点，或直接在节点里写' };
}
