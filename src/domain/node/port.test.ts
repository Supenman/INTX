import { describe, expect, it } from 'vitest';
import { acceptsType, isValidConnection, validateConnection, type ExistingEdge, type PortSpec } from './port';

const imagePort: PortSpec = {
  id: 'reference',
  label: '参考素材',
  accepts: ['image', 'video'],
  multiple: true,
  required: false,
};

const promptPort: PortSpec = {
  id: 'prompt',
  label: '提示词',
  accepts: ['text'],
  multiple: false,
  required: true,
};

const textOut: PortSpec = { id: 'text', label: '文本', accepts: ['text'], multiple: true, required: false };
const imageOut: PortSpec = { id: 'out', label: '图', accepts: ['image'], multiple: false, required: false };

function vc(over: Partial<Parameters<typeof validateConnection>[0]> = {}) {
  return validateConnection({
    intent: {
      sourceNodeId: 'a',
      sourcePortId: 'out',
      targetNodeId: 'b',
      targetPortId: 'prompt',
    },
    sourcePort: textOut,
    targetPort: promptPort,
    sourceType: 'text',
    existingEdges: [],
    ...over,
  });
}

describe('acceptsType', () => {
  it('多类型端口接受任一', () => {
    expect(acceptsType(imagePort, 'image')).toBe(true);
    expect(acceptsType(imagePort, 'video')).toBe(true);
    expect(acceptsType(imagePort, 'text')).toBe(false);
  });

  it('any 端口接受一切', () => {
    const anyPort: PortSpec = { ...promptPort, accepts: ['any'] };
    expect(acceptsType(anyPort, 'video')).toBe(true);
  });
});

describe('validateConnection', () => {
  it('类型匹配时通过', () => {
    expect(isValidConnection({
      intent: { sourceNodeId: 'a', sourcePortId: 'text', targetNodeId: 'b', targetPortId: 'prompt' },
      sourcePort: textOut,
      targetPort: promptPort,
      sourceType: 'text',
      existingEdges: [],
    })).toBe(true);
  });

  it('把文本连到只吃图的端口，连线阶段就拒绝', () => {
    const issues = vc({
      targetPort: imagePort,
      intent: { sourceNodeId: 'a', sourcePortId: 'text', targetNodeId: 'b', targetPortId: 'reference' },
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('type_mismatch');
    expect(issues[0]!.message).toContain('image / video');
  });

  it('拒绝自连', () => {
    const issues = vc({
      intent: { sourceNodeId: 'a', sourcePortId: 'out', targetNodeId: 'a', targetPortId: 'prompt' },
    });
    expect(issues.map((i) => i.code)).toContain('self_connection');
  });

  it('端口不存在时报告 unknown_port', () => {
    const issues = vc({ targetPort: undefined });
    expect(issues[0]!.code).toBe('unknown_port');
  });

  it('单路端口已有连线时拒绝第二条', () => {
    const existing: ExistingEdge[] = [
      { sourceNodeId: 'c', sourcePortId: 'text', targetNodeId: 'b', targetPortId: 'prompt' },
    ];
    const issues = vc({ existingEdges: existing });
    expect(issues.map((i) => i.code)).toContain('capacity_exceeded');
  });

  it('多路端口可以接多条', () => {
    const existing: ExistingEdge[] = [
      { sourceNodeId: 'c', sourcePortId: 'out', targetNodeId: 'b', targetPortId: 'reference' },
      { sourceNodeId: 'd', sourcePortId: 'out', targetNodeId: 'b', targetPortId: 'reference' },
    ];
    const issues = vc({
      targetPort: imagePort,
      sourcePort: imageOut,
      sourceType: 'image',
      existingEdges: existing,
      intent: { sourceNodeId: 'e', sourcePortId: 'out', targetNodeId: 'b', targetPortId: 'reference' },
    });
    expect(issues).toHaveLength(0);
  });

  it('只统计指向同一端口的连线', () => {
    const existing: ExistingEdge[] = [
      { sourceNodeId: 'c', sourcePortId: 'text', targetNodeId: 'b', targetPortId: 'other' },
    ];
    expect(vc({ existingEdges: existing })).toHaveLength(0);
  });

  it('一次返回全部问题而不是只报第一个', () => {
    const issues = validateConnection({
      intent: { sourceNodeId: 'a', sourcePortId: 'x', targetNodeId: 'a', targetPortId: 'y' },
      sourcePort: undefined,
      targetPort: undefined,
      sourceType: 'text',
      existingEdges: [],
    });
    // 自连 + 两个端口都不存在
    expect(issues.length).toBe(3);
  });
});
