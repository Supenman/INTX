import { describe, expect, it } from 'vitest';
import { describePortIssue, describePortIssues, effectiveExistingEdges, portTypeLabel } from './connection';
import type { ConnectionIntent, ExistingEdge, PortIssue, PortSpec } from './port';

const intent: ConnectionIntent = {
  sourceNodeId: 'a',
  sourcePortId: 'out',
  targetNodeId: 'b',
  targetPortId: 'in',
};

const single: PortSpec = {
  id: 'in',
  label: '提示词',
  accepts: ['text'],
  multiple: false,
  required: false,
};

const edges: ExistingEdge[] = [
  { sourceNodeId: 'old', sourcePortId: 'out', targetNodeId: 'b', targetPortId: 'in' },
  { sourceNodeId: 'c', sourcePortId: 'out', targetNodeId: 'b', targetPortId: 'other' },
  { sourceNodeId: 'd', sourcePortId: 'out', targetNodeId: 'z', targetPortId: 'in' },
];

describe('单路输入换源的连线语义', () => {
  it('同一输入口上的旧边属于「即将被替换」，不参与容量校验', () => {
    const effective = effectiveExistingEdges(edges, intent, single);
    expect(effective).toHaveLength(2);
    expect(effective.some((e) => e.sourceNodeId === 'old')).toBe(false);
    expect(effective.some((e) => e.targetPortId === 'other')).toBe(true);
    expect(effective.some((e) => e.targetNodeId === 'z')).toBe(true);
  });

  it('多路输入口的旧边必须保留，否则容量校验形同虚设', () => {
    const multiple: PortSpec = { ...single, multiple: true };
    expect(effectiveExistingEdges(edges, intent, multiple)).toEqual(edges);
  });

  it('目标端口未知时不做过滤，校验会走 unknown_port 分支', () => {
    expect(effectiveExistingEdges(edges, intent, undefined)).toEqual(edges);
  });

  it('过滤不会改动传入数组（纯函数）', () => {
    const snapshot = JSON.stringify(edges);
    effectiveExistingEdges(edges, intent, single);
    expect(JSON.stringify(edges)).toBe(snapshot);
  });
});

describe('连线错误说人话', () => {
  it('类型名换成中文，不把内部枚举丢给用户', () => {
    const issue: PortIssue = {
      code: 'type_mismatch',
      message: '「提示词」只接受 image / text，而来源是 video',
    };
    const text = describePortIssue(issue);
    expect(text).toContain('图片');
    expect(text).toContain('文字');
    expect(text).toContain('视频');
    expect(text).not.toMatch(/\bimage\b|\btext\b|\bvideo\b/);
  });

  it('单路输入占用提示改成「会替换」，不再让用户先删线', () => {
    const issue: PortIssue = { code: 'capacity_exceeded', message: '「提示词」只能接一路输入，请先断开已有连线' };
    expect(describePortIssue(issue)).toContain('会替换原有连线');
    expect(describePortIssue(issue)).not.toContain('请先断开');
  });

  it('其余错误原样保留，多个问题用中文分号拼接', () => {
    const self: PortIssue = { code: 'self_connection', message: '节点不能连接到自身' };
    const unknown: PortIssue = { code: 'unknown_port', message: '源节点没有输出口「x」' };
    expect(describePortIssues([self, unknown])).toBe('节点不能连接到自身；源节点没有输出口「x」');
  });

  it('端口类型标签覆盖全部已知类型，未知类型原样返回', () => {
    expect(portTypeLabel('image')).toBe('图片');
    expect(portTypeLabel('any')).toBe('任意类型');
    expect(portTypeLabel('future_type')).toBe('future_type');
  });
});
