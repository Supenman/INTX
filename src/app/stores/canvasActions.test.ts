import { beforeEach, describe, expect, it } from 'vitest';
import { LAYOUT_STEP_X, builtinNodes, registerNode, unregisterNode, type ProjectEdge, type ProjectNode } from '@/domain';
import {
  alignSelected,
  autoArrange,
  duplicateNodes,
  hydrateGraph,
  resetGraph,
  setNodePositions,
  useGraphStore,
} from './graphStore';
import { clearHistory, undo, useHistoryStore } from './historyStore';

function node(id: string, x: number, y: number, defKind = 'text-input'): ProjectNode {
  return {
    id,
    defKind,
    position: { x, y },
    size: { width: 260, height: 180 },
    params: {},
  };
}

function edge(id: string, source: string, target: string): ProjectEdge {
  return { id, source, sourcePort: 'text', target, targetPort: 'prompt' };
}

function seed(nodes: ProjectNode[], edges: ProjectEdge[] = []): void {
  hydrateGraph(nodes, edges);
  clearHistory();
}

const state = () => useGraphStore.getState();
const historyDepth = () => useHistoryStore.getState().past.length;

describe('画布批量操作', () => {
  beforeEach(() => {
    resetGraph();
    for (const d of builtinNodes) unregisterNode(d.kind);
    for (const d of builtinNodes) registerNode(d);
  });

  it('复制节点会带上参数、尺寸与产物引用，但不复制任务状态', () => {
    const src: ProjectNode = {
      ...node('a', 100, 200, 'generate'),
      params: { prompt: '一只猫', outputKind: 'image' },
      assetId: 'as_1',
      derivedAssetIds: ['as_1', 'as_2'],
      lastTaskId: 'tk_1',
    };
    seed([src]);

    const [copyId] = duplicateNodes(['a']);
    expect(copyId).toBeDefined();
    const copy = state().nodes[copyId!];
    expect(copy?.defKind).toBe('generate');
    expect(copy?.params.prompt).toBe('一只猫');
    expect(copy?.position).toEqual({ x: 140, y: 240 });
    expect(copy?.assetId).toBe('as_1');
    expect(copy?.derivedAssetIds).toEqual(['as_1', 'as_2']);
    expect(copy?.lastTaskId).toBeUndefined();
    // 资产是共享引用，不能因为复制就多出一张资产
    expect(copy?.derivedAssetIds).not.toBe(src.derivedAssetIds);
  });

  it('两端都在选区里的连线一并复制，跨选区的边不带过来', () => {
    seed(
      [node('a', 0, 0), node('b', 400, 0, 'generate'), node('c', 800, 0, 'generate')],
      [edge('e1', 'a', 'b'), edge('e2', 'a', 'c')],
    );

    duplicateNodes(['a', 'b']);
    const edges = Object.values(state().edges);
    expect(edges).toHaveLength(3);
    // 新边的两端都不是原来的 id
    const inner = edges.filter((e) => e.source !== 'a' && e.target !== 'b' && e.target !== 'c');
    expect(inner).toHaveLength(1);
    expect(inner[0]?.targetPort).toBe('prompt');
    // 原来的 a→c 仍在，且没有被复制成指向 c 的新边
    expect(edges.filter((e) => e.target === 'c')).toHaveLength(1);
  });

  it('复制整批只记一步历史，撤销后副本全部消失', () => {
    seed([node('a', 0, 0), node('b', 400, 0, 'generate')]);
    duplicateNodes(['a', 'b']);
    expect(historyDepth()).toBe(1);
    expect(Object.keys(state().nodes)).toHaveLength(4);
    undo();
    expect(Object.keys(state().nodes)).toHaveLength(2);
  });

  it('对齐走 domain 算法且一步可撤销', () => {
    seed([node('a', 10, 20), node('b', 130, 90, 'generate')]);
    alignSelected(['a', 'b'], 'left');
    expect(state().nodes['b']?.position.x).toBe(10);
    expect(historyDepth()).toBe(1);
    undo();
    expect(state().nodes['b']?.position.x).toBe(130);
  });

  it('setNodePositions 在无节点真正移动时不制造历史记录', () => {
    seed([node('a', 10, 20), node('b', 130, 90, 'generate')]);
    setNodePositions({ a: { x: 10, y: 20 } }, '对齐节点');
    expect(historyDepth()).toBe(0);
  });

  it('autoArrange 给了选区就只动选中的节点', () => {
    seed(
      [node('a', 0, 0), node('b', 900, 600, 'generate'), node('u', 2000, 2000, 'asset')],
      [edge('e1', 'a', 'b')],
    );
    autoArrange(['a', 'b']);
    expect(state().nodes['u']?.position).toEqual({ x: 2000, y: 2000 });
    expect(state().nodes['b']?.position.x).toBe(LAYOUT_STEP_X);
    expect(historyDepth()).toBe(1);
  });

  it('自动整理整图后，各节点不重叠', () => {
    seed([
      node('a', 0, 0),
      node('b', 700, 400, 'generate'),
      node('c', 1200, 800, 'asset'),
    ], [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')]);
    autoArrange();
    const positions = Object.values(state().nodes).map((n) => `${n.position.x},${n.position.y}`);
    expect(new Set(positions).size).toBe(3);
  });
});
