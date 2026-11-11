import { beforeEach, describe, expect, it } from 'vitest';
import { registerNode, unregisterNode, builtinNodes } from '@/domain';
import {
  addNode,
  connectNodes,
  hydrateGraph,
  moveNode,
  removeNodes,
  renameNodesByPattern,
  resetGraph,
  setNodeParam,
  setNodeTitle,
  useGraphStore,
} from './graphStore';

function seed() {
  for (const d of builtinNodes) registerNode(d);
}

function state() {
  return useGraphStore.getState();
}

describe('graphStore', () => {
  beforeEach(() => {
    resetGraph();
    for (const d of builtinNodes) unregisterNode(d.kind);
    seed();
  });

  it('addNode 使用定义中的默认参数', () => {
    const id = addNode({ defKind: 'generate', position: { x: 0, y: 0 } });
    const node = state().nodes[id]!;
    expect(node.defKind).toBe('generate');
    expect(node.params.outputKind).toBe('image');
    expect(node.params.aspectRatio).toBe('1:1');
  });

  it('连续新增节点不会重叠', () => {
    const ids = [1, 2, 3].map(() => addNode({ defKind: 'generate', position: { x: 100, y: 100 } }));
    const positions = ids.map((id) => state().nodes[id]!.position);
    const unique = new Set(positions.map((p) => `${p.x},${p.y}`));
    expect(unique.size).toBe(3);

    // 两两之间至少有一个轴向的间距大于节点宽度的一半
    for (let i = 0; i < positions.length; i += 1) {
      for (let j = i + 1; j < positions.length; j += 1) {
        const a = positions[i]!;
        const b = positions[j]!;
        const separated = Math.abs(a.x - b.x) >= 340 || Math.abs(a.y - b.y) >= 260;
        expect(separated, `节点 ${i} 与 ${j} 重叠`).toBe(true);
      }
    }
  });

  it('200 个节点连续新增仍然各有独立坐标', () => {
    const ids = Array.from({ length: 200 }, () =>
      addNode({ defKind: 'generate', position: { x: 100, y: 100 } }),
    );
    const positions = ids.map((id) => state().nodes[id]!.position);
    const unique = new Set(positions.map((p) => `${p.x},${p.y}`));
    expect(Object.keys(state().nodes)).toHaveLength(200);
    expect(unique.size, '网格行数写死会让第 101 个之后的节点堆在原点').toBe(200);
  });

  it('未注册的节点类型直接抛错', () => {
    expect(() => addNode({ defKind: 'ghost', position: { x: 0, y: 0 } })).toThrow(/未注册/);
  });

  it('删除节点会连带删除相关连线', () => {
    const text = addNode({ defKind: 'text-input', position: { x: 0, y: 0 } });
    const gen = addNode({ defKind: 'generate', position: { x: 500, y: 0 } });
    connectNodes({ sourceNodeId: text, sourcePortId: 'text', targetNodeId: gen, targetPortId: 'prompt' });
    expect(Object.keys(state().edges)).toHaveLength(1);

    removeNodes([gen]);
    expect(Object.keys(state().edges)).toHaveLength(0);
  });

  it('端口类型匹配时连线成功', () => {
    const text = addNode({ defKind: 'text-input', position: { x: 0, y: 0 } });
    const gen = addNode({ defKind: 'generate', position: { x: 500, y: 0 } });
    const r = connectNodes({ sourceNodeId: text, sourcePortId: 'text', targetNodeId: gen, targetPortId: 'prompt' });
    expect(r.ok).toBe(true);
    expect(Object.values(state().edges)[0]!.targetPort).toBe('prompt');
  });

  it('类型不匹配时拒绝并给出原因', () => {
    const asset = addNode({ defKind: 'asset', position: { x: 0, y: 0 } });
    const gen = addNode({ defKind: 'generate', position: { x: 500, y: 0 } });
    const r = connectNodes({ sourceNodeId: asset, sourcePortId: 'out', targetNodeId: gen, targetPortId: 'prompt' });
    expect(r.ok).toBe(false);
    expect(r.issues?.[0]?.code).toBe('type_mismatch');
    expect(Object.keys(state().edges)).toHaveLength(0);
  });

  it('同一来源连到不同端口时互不影响', () => {
    const asset = addNode({ defKind: 'asset', position: { x: 0, y: 0 } });
    const gen = addNode({ defKind: 'generate', position: { x: 500, y: 0 } });
    const r1 = connectNodes({ sourceNodeId: asset, sourcePortId: 'out', targetNodeId: gen, targetPortId: 'reference' });
    expect(r1.ok).toBe(true);
    const r2 = connectNodes({ sourceNodeId: asset, sourcePortId: 'out', targetNodeId: gen, targetPortId: 'prompt' });
    expect(r2.ok).toBe(false);
    expect(Object.keys(state().edges)).toHaveLength(1);
  });

  it('单路端口换源时替换旧边，而不是逼用户先删线', () => {
    const a = addNode({ defKind: 'text-input', position: { x: 0, y: 0 } });
    const b = addNode({ defKind: 'text-input', position: { x: 0, y: 400 } });
    const gen = addNode({ defKind: 'generate', position: { x: 800, y: 0 } });
    expect(connectNodes({ sourceNodeId: a, sourcePortId: 'text', targetNodeId: gen, targetPortId: 'prompt' }).ok).toBe(true);
    const firstEdgeId = Object.keys(state().edges)[0]!;
    const second = connectNodes({ sourceNodeId: b, sourcePortId: 'text', targetNodeId: gen, targetPortId: 'prompt' });
    expect(second.ok).toBe(true);
    expect(Object.keys(state().edges)).toHaveLength(1);
    expect(Object.values(state().edges)[0]?.source).toBe(b);
    expect(state().edges[firstEdgeId]).toBeUndefined();
  });

  it('重复连同一对端口不报错也不新增', () => {
    const text = addNode({ defKind: 'text-input', position: { x: 0, y: 0 } });
    const gen = addNode({ defKind: 'generate', position: { x: 500, y: 0 } });
    const intent = { sourceNodeId: text, sourcePortId: 'text', targetNodeId: gen, targetPortId: 'prompt' };
    connectNodes(intent);
    const again = connectNodes(intent);
    expect(again.ok).toBe(true);
    expect(Object.keys(state().edges)).toHaveLength(1);
  });

  it('拒绝自连', () => {
    const gen = addNode({ defKind: 'generate', position: { x: 0, y: 0 } });
    // 生成节点的 out 是 image，prompt 只吃 text，先造一个能自连的场景不可能，直接验证 code
    const r = connectNodes({ sourceNodeId: gen, sourcePortId: 'out', targetNodeId: gen, targetPortId: 'prompt' });
    expect(r.ok).toBe(false);
    expect(r.issues?.map((i) => i.code)).toContain('self_connection');
  });

  it('位置未变化时不产生新的 nodes 引用', () => {
    const id = addNode({ defKind: 'generate', position: { x: 10, y: 10 } });
    const before = state().nodes;
    moveNode(id, { x: 10, y: 10 });
    expect(state().nodes).toBe(before);

    moveNode(id, { x: 20, y: 20 });
    expect(state().nodes).not.toBe(before);
    expect(state().nodes[id]!.position).toEqual({ x: 20, y: 20 });
  });

  it('setNodeParam 只改目标键', () => {
    const id = addNode({ defKind: 'generate', position: { x: 0, y: 0 } });
    setNodeParam(id, 'outputKind', 'video');
    expect(state().nodes[id]!.params.outputKind).toBe('video');
    expect(state().nodes[id]!.params.aspectRatio).toBe('1:1');
  });

  it('hydrateGraph 覆盖当前图', () => {
    addNode({ defKind: 'generate', position: { x: 0, y: 0 } });
    hydrateGraph(
      [
        {
          id: 'n1',
          defKind: 'generate',
          position: { x: 1, y: 2 },
          size: { width: 300, height: 200 },
          params: { outputKind: 'video' },
        },
      ],
      [],
    );
    expect(Object.keys(state().nodes)).toEqual(['n1']);
    expect(state().nodes.n1!.params.outputKind).toBe('video');
  });
});

/**
 * 节点改名。
 *
 * 单测在这里能守住的东西：空标题必须回退（不能留一个空名字让卡片变白）、
 * 编号顺序按坐标而不是按传入顺序（用户说的「第三个」是画布上的第三个）。
 */
describe('节点改名', () => {
  beforeEach(() => {
    resetGraph();
    for (const d of builtinNodes) unregisterNode(d.kind);
    seed();
  });

  it('改名后读得到，空标题回退为未命名（不回退到类型名，由显示层负责）', () => {
    const id = addNode({ defKind: 'generate', position: { x: 0, y: 0 } });
    setNodeTitle(id, '主视觉');
    expect(state().nodes[id]!.title).toBe('主视觉');
    setNodeTitle(id, '   ');
    expect(state().nodes[id]!.title).toBeUndefined();
  });

  it('换行被压平，卡片是单行的', () => {
    const id = addNode({ defKind: 'generate', position: { x: 0, y: 0 } });
    setNodeTitle(id, '第一行\n第二行');
    expect(state().nodes[id]!.title).toBe('第一行 第二行');
  });

  it('批量改名按画布坐标编号，不按传入顺序', () => {
    const right = addNode({ defKind: 'generate', position: { x: 400, y: 0 } });
    const left = addNode({ defKind: 'generate', position: { x: 0, y: 0 } });
    // 故意先传右边的
    const n = renameNodesByPattern([right, left], '主图 #');
    expect(n).toBe(2);
    expect(state().nodes[left]!.title).toBe('主图 01');
    expect(state().nodes[right]!.title).toBe('主图 02');
  });

  it('批量改名不存在的 id 直接忽略，不抛错也不算进总数', () => {
    const id = addNode({ defKind: 'generate', position: { x: 0, y: 0 } });
    expect(renameNodesByPattern([id, 'ghost'], '图 #')).toBe(1);
    expect(state().nodes[id]!.title).toBe('图 01');
  });
});
