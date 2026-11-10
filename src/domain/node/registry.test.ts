import { beforeEach, describe, expect, it } from 'vitest';
import { builtinNodes } from './builtins';
import { defaultParams, outputType } from './definition';
import {
  getNodeDefinition,
  listByCategory,
  listNodeDefinitions,
  registerNode,
  requireNodeDefinition,
  unregisterNode,
} from './registry';
import type { NodeDefinition } from './definition';

function registerBuiltins() {
  for (const def of builtinNodes) registerNode(def);
}

describe('registry', () => {
  beforeEach(() => {
    for (const def of builtinNodes) unregisterNode(def.kind);
  });

  it('注册后可查询', () => {
    registerBuiltins();
    expect(getNodeDefinition('generate')?.title).toBe('生成');
    expect(listNodeDefinitions()).toHaveLength(4);
  });

  it('重复注册被拒绝而不是静默覆盖', () => {
    registerBuiltins();
    const r = registerNode(builtinNodes[0]!);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('duplicate_kind');
  });

  it('requireNodeDefinition 在未注册时抛错，暴露注册遗漏', () => {
    expect(() => requireNodeDefinition('nope')).toThrow(/未注册/);
  });

  it('按分类查询', () => {
    registerBuiltins();
    expect(listByCategory('source').map((d) => d.kind)).toEqual(['text-input', 'asset']);
    expect(listByCategory('generate').map((d) => d.kind)).toEqual(['generate', 'storyboard']);
  });

  it('新类型可以直接注册进来（扩展性不被焊死）', () => {
    const custom: NodeDefinition = {
      kind: 'custom-thing',
      title: '自定义',
      category: 'utility',
      inputPorts: [],
      outputPorts: [{ id: 'out', label: '出', accepts: ['image'], multiple: false, required: false }],
      params: [],
    };
    expect(registerNode(custom).ok).toBe(true);
    expect(getNodeDefinition('custom-thing')?.title).toBe('自定义');
    unregisterNode('custom-thing');
  });
});

describe('definition helpers', () => {
  it('defaultParams 从 ParamSpec 推导', () => {
    const gen = requireNodeDefinitionOr(builtinNodes.find((d) => d.kind === 'generate')!);
    const params = defaultParams(gen);
    expect(params.outputKind).toBe('image');
    expect(params.aspectRatio).toBe('1:1');
    expect(params.prompt).toBe('');
  });

  it('outputType 取第一个输出口的具体类型', () => {
    const asset = builtinNodes.find((d) => d.kind === 'asset')!;
    expect(outputType(asset)).toBe('image');
  });

  it('内置节点没有重复 id', () => {
    const kinds = builtinNodes.map((d) => d.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it('参数 id 在单个节点内唯一', () => {
    for (const def of builtinNodes) {
      const ids = def.params.map((p) => p.id);
      expect(new Set(ids).size, `${def.kind} 有重复参数 id`).toBe(ids.length);
    }
  });

  it('端口 id 在单个节点内唯一', () => {
    for (const def of builtinNodes) {
      const ids = [...def.inputPorts, ...def.outputPorts].map((p) => p.id);
      expect(new Set(ids).size, `${def.kind} 有重复端口 id`).toBe(ids.length);
    }
  });
});

function requireNodeDefinitionOr(def: NodeDefinition): NodeDefinition {
  return def;
}
