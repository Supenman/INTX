import { beforeEach, describe, expect, it } from 'vitest';
import { builtinNodes, overrideNode } from '@/domain';
import { resetGraph, useGraphStore } from '@/app/stores/graphStore';
import { useAssetStore } from '@/app/stores/assetStore';
import {
  applyLegacy,
  previewLegacy,
  readLegacyFile,
  scanLegacySources,
  type LegacyStorage,
} from './legacyImport';

const CANVAS = {
  nodes: [
    { id: '1', type: 'text', position: { x: 10, y: 20 }, data: { prompt: '一只猫' } },
    { id: '2', type: 'image', position: { x: 300, y: 20 }, data: { prompt: '' } },
  ],
  edges: [{ id: 'e', source: '1', target: '2' }],
  nodeIdCounter: 3,
  nodeStates: {},
  savedAt: 1_700_000_000_000,
};

function fakeStorage(entries: Record<string, string>): LegacyStorage {
  return { getItem: (k) => entries[k] ?? null };
}

beforeEach(() => {
  for (const def of builtinNodes) overrideNode(def);
  resetGraph();
  useAssetStore.setState({ assets: {}, byHash: {}, ready: true });
});

describe('scanLegacySources', () => {
  it('找到 beasttv-canvas 老单画布', () => {
    const found = scanLegacySources(fakeStorage({ 'beasttv-canvas': JSON.stringify(CANVAS) }));
    expect(found).toHaveLength(1);
    expect(found[0]?.source).toBe('canvas');
    expect(found[0]?.detail).toContain('2 个节点');
    expect(found[0]?.detail).toContain('1 条连线');
  });

  it('按项目索引逐条读出 beasttv-project-<id>', () => {
    const found = scanLegacySources(
      fakeStorage({
        'beasttv-projects': JSON.stringify([
          { id: 'a1', name: '分镜稿' },
          { id: 'b2', name: '空项目' },
        ]),
        'beasttv-project-a1': JSON.stringify({ ...CANVAS, name: '分镜稿' }),
        'beasttv-project-b2': JSON.stringify({ nodes: [], edges: [] }),
      }),
    );
    expect(found.map((s) => s.label)).toEqual(['项目 · 分镜稿', '项目 · 空项目']);
    expect(found[0]?.name).toBe('分镜稿');
    expect(found[0]?.source).toBe('project');
  });

  it('单画布与项目索引同时存在时都列出来', () => {
    const found = scanLegacySources(
      fakeStorage({
        'beasttv-canvas': JSON.stringify(CANVAS),
        'beasttv-projects': JSON.stringify([{ id: 'a1', name: '旧项目' }]),
        'beasttv-project-a1': JSON.stringify(CANVAS),
      }),
    );
    expect(found).toHaveLength(2);
    expect(found.map((s) => s.source)).toEqual(['canvas', 'project']);
  });

  it('跳过损坏的索引、缺数据的条目与非旧格式数据', () => {
    const found = scanLegacySources(
      fakeStorage({
        'beasttv-projects': JSON.stringify([
          { id: 'good', name: '好' },
          { id: 'missing', name: '缺数据' },
          { name: '没有 id' },
          { id: 'new', name: '新版' },
        ]),
        'beasttv-project-good': JSON.stringify(CANVAS),
        'beasttv-project-new': JSON.stringify({ schemaVersion: 1, nodes: [], edges: [], assets: [] }),
      }),
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.id).toBe('project:good');
  });

  it('索引不是数组时只返回单画布部分', () => {
    expect(scanLegacySources(fakeStorage({ 'beasttv-projects': '{}' }))).toEqual([]);
  });

  it('getItem 抛异常（隐私模式）时不炸页面', () => {
    const storage: LegacyStorage = {
      getItem: () => {
        throw new Error('access denied');
      },
    };
    expect(scanLegacySources(storage)).toEqual([]);
  });

  it('没有旧数据时返回空数组', () => {
    expect(scanLegacySources(fakeStorage({}))).toEqual([]);
  });
});

describe('readLegacyFile', () => {
  it('从用户选的 JSON 文件造一个来源', async () => {
    const fakeFile = {
      name: 'beasttv-export.json',
      size: 256,
      text: async () => JSON.stringify(CANVAS),
    } as unknown as File;
    const src = await readLegacyFile(async () => fakeFile);
    expect(src?.source).toBe('file');
    expect(src?.name).toBe('beasttv-export');
    expect(src?.label).toContain('beasttv-export.json');
  });

  it('用户取消时返回 null', async () => {
    expect(await readLegacyFile(async () => null)).toBeNull();
  });
});

describe('previewLegacy', () => {
  it('只出报告，不改任何 store', () => {
    const src = scanLegacySources(fakeStorage({ 'beasttv-canvas': JSON.stringify(CANVAS) }))[0];
    if (!src) throw new Error('应当扫到来源');
    const nodesBefore = useGraphStore.getState().nodes;
    const r = previewLegacy(src);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.report.nodeCount).toBe(2);
      expect(r.report.edgeCount).toBe(1);
      expect(r.report.notes.some((n) => n.code === 'no_assets')).toBe(true);
    }
    expect(useGraphStore.getState().nodes).toBe(nodesBefore);
  });

  it('拿错 .intx 包时给出明确指引', () => {
    const r = previewLegacy({
      id: 'x', label: '文件', detail: '', source: 'file', name: 'x',
      text: JSON.stringify({ format: 'intx-project', project: {} }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('导入 .intx');
  });
});

describe('applyLegacy', () => {
  it('装载节点与连线，并把文字 → 生成补成 text → prompt', async () => {
    const src = scanLegacySources(fakeStorage({ 'beasttv-canvas': JSON.stringify(CANVAS) }))[0];
    if (!src) throw new Error('应当扫到来源');
    const result = await applyLegacy(src);
    expect(result.ok).toBe(true);

    const { nodes, edges } = useGraphStore.getState();
    expect(Object.keys(nodes)).toHaveLength(2);
    expect(Object.keys(edges)).toHaveLength(1);
    const textNode = Object.values(nodes).find((n) => n.defKind === 'text-input');
    const generateNode = Object.values(nodes).find((n) => n.defKind === 'generate');
    expect(textNode?.params.content).toBe('一只猫');
    expect(textNode?.position).toEqual({ x: 10, y: 20 });
    const edge = Object.values(edges)[0];
    expect(edge?.sourcePort).toBe('text');
    expect(edge?.targetPort).toBe('prompt');
    expect(edge?.source).toBe(textNode?.id);
    expect(edge?.target).toBe(generateNode?.id);
    expect(result.report?.nodeCount).toBe(2);
  });

  it('不动资产库（引用不变），也不把旧产物塞进 assets', async () => {
    const assetsBefore = useAssetStore.getState().assets;
    const src = scanLegacySources(fakeStorage({ 'beasttv-canvas': JSON.stringify(CANVAS) }))[0];
    if (!src) throw new Error('应当扫到来源');
    await applyLegacy(src);
    expect(useAssetStore.getState().assets).toBe(assetsBefore);
  });

  it('坏数据返回失败且画布保持原样', async () => {
    const r = await applyLegacy({
      id: 'x', label: '坏文件', detail: '', source: 'file', name: 'x', text: 'not-json',
    });
    expect(r.ok).toBe(false);
    expect(Object.keys(useGraphStore.getState().nodes)).toHaveLength(0);
  });
});
