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

export interface RequiredInputOptions {
  /**
   * 端口 id → 节点自己在这个口上填的文字。
   *
   * 生成节点的 `prompt` 口允许**两种来源**：上游连线，或节点自己的输入框。
   * 只查连线会误判：用户明明在框里写了提示词、点了生成，却被告诉
   * 「提示词还没有连上」——而界面上那句话就写在他刚打完字的框下面。
   *
   * 分镜的 `script` 口不在此列：它只收上游文本（分镜文本要按段落切格，
   * 不能是随手一行的本地草稿）。
   */
  localText?: Record<string, string>;
}

/**
 * 哪些节点的哪个必填输入口，允许由**节点自己的参数**直接满足。
 *
 * 只有生成节点：提示词既可以连线接上游，也可以直接在框里写。分镜不在
 * 其中——它的 `script` 要按段落切格，随手一行草稿跑出来的分镜没有意义。
 *
 * 这条知识必须留在 domain：写在用例里，迟早有人加新节点时忘掉，
 * 于是又出现「用户写了提示词，点生成被告知还没连上」。
 */
export const LOCAL_TEXT_PORTS: Record<string, string> = { generate: 'prompt' };

/** 取节点上能顶替必填口的那段本地文字（参数 id 与端口 id 同名）。 */
export function localTextFor(node: ProjectNode): Record<string, string> {
  const portId = LOCAL_TEXT_PORTS[node.defKind];
  if (portId === undefined) return {};
  const value = node.params[portId];
  if (typeof value !== 'string' || value.trim() === '') return {};
  return { [portId]: value };
}

/**
 * 检查节点提交前是否满足定义里的必填输入口。
 *
 * 只看端口是否被连上（或是否有等价的本地输入），不关心上游节点是否已有
 * 产物 —— 上游没产物是"上游的问题"，会在上游自己的运行时暴露，
 * 不应该让下游提前报一个看不懂的错。
 */
export function checkRequiredInputs(
  node: ProjectNode,
  def: NodeDefinition,
  edges: ConnectionLookup,
  opts?: RequiredInputOptions,
): MissingInput[] {
  const missing: MissingInput[] = [];
  for (const port of def.inputPorts) {
    if (!port.required) continue;
    if (edges.incomingEdgeCount(node.id, port.id) > 0) continue;
    if ((opts?.localText?.[port.id] ?? '').trim() !== '') continue;
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
 * 哪个输入口接文本。
 *
 * 生成节点叫 `prompt`，分镜节点叫 `script`。这个映射原本在两处各写一遍：
 * `runGeneration()` 里写对了，`CanvasNode` 里却写死成 `'text'`——那是文字节点的
 * **输出**口 id。后果不是报错，而是更糟的「静默不一致」：请求带着上游提示词
 * 真的发了出去（真机回了 HTTP 451），卡片却一直显示「还没有提示词」，
 * 用户看到「没提示词却报错」，根本无从判断问题在哪。
 *
 * 收成一个函数，显示层和执行层都从这里取，谁也别再猜端口名。
 */
export function textInputPortId(defKind: string): string {
  return defKind === 'storyboard' ? 'script' : 'prompt';
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
