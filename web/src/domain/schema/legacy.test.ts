import { describe, expect, it } from 'vitest';
import {
  LEGACY_CANVAS_KEY,
  LEGACY_CURRENT_KEY,
  LEGACY_PROJECT_INDEX_KEY,
  LEGACY_PROJECT_PREFIX,
  CURRENT_SCHEMA_VERSION,
  defaultNodeSize,
  migrate,
  migrateLegacy,
  parseLegacyText,
  type LegacyDocument,
} from '@/domain';

/** 与旧仓库 canvasStorage.test.js 里的 SAMPLE_STATE 同形状。 */
const CANVAS = {
  nodes: [
    { id: '1', type: 'image', position: { x: 100, y: 100 }, data: { prompt: '' } },
    { id: '2', type: 'text', position: { x: 300, y: 200 }, data: { prompt: 'hello' } },
  ],
  edges: [{ id: 'e-1-2', source: '1', target: '2' }],
  nodeIdCounter: 3,
  nodeStates: {},
  savedAt: 1_700_000_000_000,
};

function docOf(raw: unknown, opts: Parameters<typeof parseLegacyText>[1] = {}): LegacyDocument {
  const r = parseLegacyText(JSON.stringify(raw), opts);
  if (!r.ok) throw new Error(`测试样本应当可解析：${r.error}`);
  return r.value;
}

describe('旧版 key 常量', () => {
  it('与旧仓库硬编码的 localStorage key 完全一致', () => {
    expect(LEGACY_CANVAS_KEY).toBe('beasttv-canvas');
    expect(LEGACY_PROJECT_INDEX_KEY).toBe('beasttv-projects');
    expect(LEGACY_PROJECT_PREFIX).toBe('beasttv-project-');
    expect(LEGACY_CURRENT_KEY).toBe('beasttv-current-project');
  });
});

describe('parseLegacyText', () => {
  it('解析旧单画布，并把 savedAt 当作 updatedAt', () => {
    const doc = docOf(CANVAS);
    expect(doc.nodes).toHaveLength(2);
    expect(doc.edges).toHaveLength(1);
    expect(doc.updatedAt).toBe(CANVAS.savedAt);
    expect(doc.createdAt).toBe(0);
    expect(doc.name).toBe('未命名旧项目');
    expect(doc.source).toBe('file');
  });

  it('解析旧项目数据（带 name / createdAt / updatedAt）', () => {
    const doc = docOf({
      id: 'abc', name: '我的旧项目', nodes: [], edges: [],
      createdAt: 100, updatedAt: 200, nodeStates: { n1: { status: 'done' } },
    });
    expect(doc.name).toBe('我的旧项目');
    expect(doc.createdAt).toBe(100);
    expect(doc.updatedAt).toBe(200);
    expect(Object.keys(doc.nodeStates)).toEqual(['n1']);
  });

  it('调用方可覆盖来源、标签与项目名', () => {
    const doc = docOf(CANVAS, { source: 'canvas', label: '本地存储 · 单画布', name: '覆盖名' });
    expect(doc.source).toBe('canvas');
    expect(doc.label).toBe('本地存储 · 单画布');
    expect(doc.name).toBe('覆盖名');
  });

  it('收集未识别的顶层字段，供报告如实列出', () => {
    const doc = docOf({ ...CANVAS, somethingExtra: 'nope', another: 1 });
    expect(doc.unusedTopLevelFields).toEqual(['another', 'somethingExtra']);
  });

  it('拒绝垃圾 JSON', () => {
    expect(parseLegacyText('not-json').ok).toBe(false);
  });

  it('拒绝数组与 null', () => {
    expect(parseLegacyText('[]').ok).toBe(false);
    expect(parseLegacyText('null').ok).toBe(false);
  });

  it('用户拿错 .intx 包时给出明确指引', () => {
    const r = parseLegacyText(JSON.stringify({ format: 'intx-project', project: {} }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('导入 .intx');
  });

  it('拒绝带 schemaVersion 的新版项目文件', () => {
    const r = parseLegacyText(JSON.stringify({ schemaVersion: 1, nodes: [] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('新版');
  });

  it('缺少 nodes 数组时拒绝', () => {
    const r = parseLegacyText(JSON.stringify({ edges: [] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('nodes');
  });
});

describe('migrateLegacy · 节点类型映射', () => {
  it('image → generate，保留提示词并把产出类型设为图片', () => {
    const doc = docOf({ nodes: [{ id: 'a', type: 'image', position: { x: 12, y: 34 }, data: { prompt: '一只猫' } }], edges: [] });
    const { file, report } = migrateLegacy(doc, { now: 999 });

    expect(file.nodes[0]?.defKind).toBe('generate');
    expect(file.nodes[0]?.params.prompt).toBe('一只猫');
    expect(file.nodes[0]?.params.outputKind).toBe('image');
    expect(file.nodes[0]?.position).toEqual({ x: 12, y: 34 });
    expect(file.nodes[0]?.size).toEqual(defaultNodeSize('generate'));
    expect(report.mappedNodes).toBe(1);
    expect(report.fallbackNodes).toBe(0);
  });

  it('video → generate，产出类型设为视频', () => {
    const doc = docOf({ nodes: [{ id: 'v', type: 'video', data: { prompt: '海浪' } }], edges: [] });
    const { file } = migrateLegacy(doc);
    expect(file.nodes[0]?.defKind).toBe('generate');
    expect(file.nodes[0]?.params.outputKind).toBe('video');
  });

  it('text → text-input，旧模型配置不迁移但如实进报告', () => {
    const doc = docOf({ nodes: [{ id: 't', type: 'text', data: { prompt: '旁白', model: 'gpt-4o' } }], edges: [] });
    const { file, report } = migrateLegacy(doc);
    expect(file.nodes[0]?.defKind).toBe('text-input');
    expect(file.nodes[0]?.params.content).toBe('旁白');
    expect(report.ignoredFields).toContain('model');
    expect(report.consumedFields).toContain('prompt');
  });

  it('source-* 映射到文字输入 / 素材，且尺寸取自共享函数', () => {
    const doc = docOf({
      nodes: [
        { id: '1', type: 'source-markdown', data: { content: '# 标题' } },
        { id: '2', type: 'source-image', data: {} },
      ],
      edges: [],
    });
    const { file } = migrateLegacy(doc);
    expect(file.nodes[0]?.defKind).toBe('text-input');
    expect(file.nodes[0]?.params.content).toBe('# 标题');
    expect(file.nodes[1]?.defKind).toBe('asset');
    expect(file.nodes[1]?.size).toEqual(defaultNodeSize('asset'));
  });

  it('无法识别的类型不静默丢弃：落成占位并保留原始 data 快照', () => {
    const data = { foo: 42, nested: { a: 'b' } };
    const doc = docOf({ nodes: [{ id: 'x', type: 'future-node', data }], edges: [] });
    const { file, report } = migrateLegacy(doc);
    expect(file.nodes[0]?.defKind).toBe('text-input');
    expect(String(file.nodes[0]?.params.content)).toContain('future-node');
    expect(String(file.nodes[0]?.params.content)).toContain('"foo": 42');
    expect(report.fallbackNodes).toBe(1);
    expect(report.notes.some((n) => n.code === 'type_fallback')).toBe(true);
    expect(report.ignoredFields).not.toContain('foo'); // 已整体快照保留
  });

  it('位置非法时钳到原点而不是写 NaN 进项目文件', () => {
    const doc = docOf({ nodes: [{ id: 'x', type: 'text', position: { x: 'oops', y: null }, data: {} }], edges: [] });
    const { file } = migrateLegacy(doc);
    expect(file.nodes[0]?.position).toEqual({ x: 0, y: 0 });
  });

  it('重复 id 归一化并留下告警', () => {
    const doc = docOf({
      nodes: [
        { id: 'same', type: 'text', data: {} },
        { id: 'same', type: 'text', data: {} },
      ],
      edges: [],
    });
    const { file, report } = migrateLegacy(doc);
    expect(new Set(file.nodes.map((n) => n.id)).size).toBe(2);
    expect(report.notes.some((n) => n.code === 'id_normalized')).toBe(true);
  });
});

describe('migrateLegacy · 连线端口补全', () => {
  it('文字 → 生成：补成 text → prompt', () => {
    const doc = docOf({
      nodes: [
        { id: '1', type: 'text', data: { prompt: '一只猫' } },
        { id: '2', type: 'image', data: { prompt: '' } },
      ],
      edges: [{ id: 'e', source: '1', target: '2' }],
    });
    const { file, report } = migrateLegacy(doc);
    expect(file.edges[0]?.sourcePort).toBe('text');
    expect(file.edges[0]?.targetPort).toBe('prompt');
    expect(report.edgeCount).toBe(1);
    expect(report.droppedEdges).toBe(0);
  });

  it('图片 → 生成：补成 out → reference', () => {
    const doc = docOf({
      nodes: [
        { id: '1', type: 'image', data: {} },
        { id: '2', type: 'image', data: {} },
      ],
      edges: [{ id: 'e', source: '1', target: '2' }],
    });
    const { file } = migrateLegacy(doc);
    expect(file.edges[0]?.sourcePort).toBe('out');
    expect(file.edges[0]?.targetPort).toBe('reference');
  });

  it('目标是没有输入口的文字输入节点时丢弃连线，并写清原因', () => {
    const doc = docOf({
      nodes: [
        { id: '1', type: 'text', data: {} },
        { id: '2', type: 'text', data: {} },
      ],
      edges: [{ id: 'e', source: '1', target: '2' }],
    });
    const { file, report } = migrateLegacy(doc);
    expect(file.edges).toHaveLength(0);
    expect(report.droppedEdges).toBe(1);
    expect(report.droppedEdgeReasons[0]).toContain('没有可用的输入口');
  });

  it('同一 prompt 口只留第一路，第二路因单路容量被丢弃', () => {
    const doc = docOf({
      nodes: [
        { id: '1', type: 'text', data: {} },
        { id: '2', type: 'text', data: {} },
        { id: '3', type: 'image', data: {} },
      ],
      edges: [
        { id: 'e1', source: '1', target: '3' },
        { id: 'e2', source: '2', target: '3' },
      ],
    });
    const { file, report } = migrateLegacy(doc);
    expect(file.edges).toHaveLength(1);
    expect(report.droppedEdges).toBe(1);
    expect(report.droppedEdgeReasons[0]).toContain('只能接一路输入');
  });

  it('悬挂边（源节点不在数据里）被丢弃', () => {
    const doc = docOf({
      nodes: [{ id: '1', type: 'image', data: {} }],
      edges: [{ id: 'e', source: 'ghost', target: '1' }],
    });
    const { file, report } = migrateLegacy(doc);
    expect(file.edges).toHaveLength(0);
    expect(report.droppedEdgeReasons[0]).toContain('没被迁移过来');
  });
});

describe('migrateLegacy · 不编造产物与报告完整性', () => {
  it('assets 与 tasks 恒为空，且报告明确说明产物不迁移', () => {
    const doc = docOf({
      nodes: [{ id: '1', type: 'image', data: { prompt: 'x', result: 'https://tmp/abc.png', outputHistory: [1, 2] } }],
      edges: [], nodeStates: { '1': { status: 'done' } },
    });
    const { file, report } = migrateLegacy(doc, { now: 123 });
    expect(file.assets).toEqual([]);
    expect(file.tasks).toEqual([]);
    expect(report.notes.some((n) => n.code === 'no_assets' && n.message.includes('一律不迁移'))).toBe(true);
    expect(report.notes.some((n) => n.code === 'no_assets' && n.message.includes('nodeStates'))).toBe(true);
    expect(report.ignoredFields).toEqual(expect.arrayContaining(['result', 'outputHistory']));
  });

  it('生成的项目文件能被新版 migrate() 读回', () => {
    const doc = docOf(CANVAS);
    const { file } = migrateLegacy(doc, { now: 456 });
    expect(file.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(file.project.updatedAt).toBe(456);
    const back = migrate(file);
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.value.nodes).toHaveLength(2);
  });

  it('报告的计数与实际装载结果一致', () => {
    const doc = docOf({
      nodes: [
        { id: '1', type: 'text', data: { prompt: 'a' } },
        { id: '2', type: 'image', data: { prompt: 'b' } },
        { id: '3', type: 'mystery', data: { x: 1 } },
      ],
      edges: [
        { id: 'e1', source: '1', target: '2' },
        { id: 'e2', source: '3', target: '1' },
      ],
    });
    const { file, report } = migrateLegacy(doc);
    expect(report.nodeCount).toBe(file.nodes.length);
    expect(report.edgeCount).toBe(file.edges.length);
    expect(report.mappedNodes + report.fallbackNodes).toBe(report.nodeCount);
    expect(report.source).toBe('file');
    expect(report.notes[0]?.code).toBe('source');
  });
});
