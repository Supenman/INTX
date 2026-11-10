import { describe, expect, it } from 'vitest';
import {
  INTX_FORMAT,
  INTX_FORMAT_VERSION,
  fromBase64,
  inspectPackage,
  parsePackageText,
  serializePackage,
  toBase64,
  type IntxPackage,
} from './projectPackage';
import { CURRENT_SCHEMA_VERSION, type ProjectFile } from '@/domain';

function emptyProject(): ProjectFile {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    project: { id: 'p1', name: '测试项目', createdAt: 1, updatedAt: 2 },
    nodes: [
      {
        id: 'n1',
        defKind: 'generate',
        position: { x: 10, y: 20 },
        size: { width: 340, height: 260 },
        params: { prompt: '一只猫' },
      },
    ],
    edges: [],
    assets: [],
    tasks: [],
  };
}

function samplePackage(): IntxPackage {
  return {
    format: INTX_FORMAT,
    formatVersion: INTX_FORMAT_VERSION,
    exportedAt: 1000,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    project: emptyProject(),
    blobs: { abc123: { mime: 'image/png', data: toBase64(new Uint8Array([1, 2, 3, 255]).buffer) } },
  };
}

describe('base64 编解码', () => {
  it('往返一致', () => {
    const original = new Uint8Array([0, 1, 2, 127, 128, 200, 255, 137, 80, 78, 71]);
    const decoded = new Uint8Array(fromBase64(toBase64(original.buffer as ArrayBuffer)));
    expect([...decoded]).toEqual([...original]);
  });

  it('大字节不分块会爆栈，这里能安全处理', () => {
    const big = new Uint8Array(200_000);
    for (let i = 0; i < big.length; i += 1) big[i] = i % 256;
    expect(fromBase64(toBase64(big.buffer as ArrayBuffer)).byteLength).toBe(200_000);
  });
});

describe('项目包序列化', () => {
  it('JSON 往返后节点、位置、参数原样', () => {
    const parsed = parsePackageText(serializePackage(samplePackage()));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.pkg.project.nodes).toEqual(emptyProject().nodes);
    expect(parsed.pkg.blobs.abc123?.mime).toBe('image/png');
  });

  it('包里不会带上 API Key', () => {
    const text = serializePackage(samplePackage());
    expect(text).not.toContain('apiKey');
    expect(text).not.toContain('sk-');
  });

  it('坏 JSON 被拒绝，不抛异常', () => {
    expect(parsePackageText('{ 这不是 json').ok).toBe(false);
  });

  it('不是 INTX 格式的文件被拒绝', () => {
    expect(parsePackageText('{"format":"something-else"}').ok).toBe(false);
  });

  it('未来版本的项目包被拒绝，而不是读出半截', () => {
    const pkg = { ...samplePackage(), formatVersion: 999 };
    expect(parsePackageText(JSON.stringify(pkg)).ok).toBe(false);
  });

  it('缺 blobs 被拒绝', () => {
    const pkg = { ...samplePackage(), blobs: undefined };
    expect(parsePackageText(JSON.stringify(pkg)).ok).toBe(false);
  });

  it('inspectPackage 会跑 schema 迁移与校验', () => {
    expect(inspectPackage(samplePackage()).ok).toBe(true);
    const future = { ...samplePackage(), project: { ...emptyProject(), schemaVersion: 999 } };
    expect(inspectPackage(future).ok).toBe(false);
  });
});
