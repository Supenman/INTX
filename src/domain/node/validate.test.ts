import { describe, expect, it } from 'vitest';
import { checkPrompt, checkRequiredInputs, resolvePrompt, type ConnectionLookup } from './validate';
import { generateNode, storyboardNode } from './builtins';
import type { ProjectNode } from '../schema/project';

function node(partial: Partial<ProjectNode>): ProjectNode {
  return {
    id: 'n1',
    defKind: generateNode.kind,
    position: { x: 0, y: 0 },
    size: { width: 300, height: 200 },
    params: {},
    ...partial,
  };
}

function lookup(pairs: [string, string][]): ConnectionLookup {
  return {
    incomingEdgeCount: (target, port) => pairs.filter(([t, p]) => t === target && p === port).length,
  };
}

describe('提交前的连线校验', () => {
  it('必填口没连上时明确指出是哪个口', () => {
    const issues = checkRequiredInputs(node({}), generateNode, lookup([]));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.portId).toBe('prompt');
    expect(issues[0]?.message).toContain('提示词');
  });

  it('可选口没连不算问题', () => {
    const issues = checkRequiredInputs(node({}), generateNode, lookup([['n1', 'prompt']]));
    expect(issues).toEqual([]);
  });

  it('接口连对了但节点选错了端口时仍然报错（端口 id 必须精确匹配）', () => {
    const issues = checkRequiredInputs(node({}), generateNode, lookup([['n1', 'reference']]));
    expect(issues.map((i) => i.portId)).toEqual(['prompt']);
  });

  it('分镜节点的必填口是分镜文本，不是源图', () => {
    const issues = checkRequiredInputs(
      node({ defKind: 'storyboard' }),
      storyboardNode,
      lookup([]),
    );
    expect(issues.map((i) => i.portId)).toEqual(['script']);
  });
});

describe('提示词来源', () => {
  it('上游文本优先于节点自己的输入框', () => {
    const n = node({ params: { prompt: '自己写的' } });
    expect(resolvePrompt(n, '上游给的')).toBe('上游给的');
  });

  it('上游是空串时回退到节点自己的输入框', () => {
    const n = node({ params: { prompt: '自己写的' } });
    expect(resolvePrompt(n, '   ')).toBe('自己写的');
  });

  it('两边都没有时返回空串，交给 checkPrompt 报错', () => {
    const n = node({});
    expect(resolvePrompt(n, null)).toBe('');
    expect(checkPrompt('')?.code).toBe('empty_param');
    expect(checkPrompt('有内容')).toBeNull();
  });

  it('上游和本地都去掉首尾空白，避免把换行送进请求', () => {
    const n = node({ params: { prompt: '  本地  \n' } });
    expect(resolvePrompt(n, null)).toBe('本地');
  });
});
