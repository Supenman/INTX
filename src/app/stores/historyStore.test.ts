import { beforeEach, describe, expect, it } from 'vitest';
import { builtinNodes, overrideNode } from '@/domain';
import {
  addNode,
  connectNodes,
  moveNode,
  removeEdge,
  removeNodes,
  resetGraph,
  setNodeParam,
  useGraphStore,
} from './graphStore';
import {
  canRedo,
  canUndo,
  clearHistory,
  checkpoint,
  redo,
  undo,
  useHistoryStore,
} from './historyStore';

function state() {
  return useGraphStore.getState();
}

beforeEach(() => {
  for (const d of builtinNodes) overrideNode(d);
  resetGraph();
  clearHistory();
});

describe('撤销 / 重做', () => {
  it('添加节点可以撤销，也可以重做', () => {
    const id = addNode({ defKind: 'text-input', position: { x: 0, y: 0 } });
    expect(Object.keys(state().nodes)).toEqual([id]);

    expect(undo()).toBe(true);
    expect(Object.keys(state().nodes)).toEqual([]);

    expect(redo()).toBe(true);
    expect(Object.keys(state().nodes)).toEqual([id]);
  });

  it('删除节点（连同它的连线）一次撤销全回来', () => {
    const a = addNode({ defKind: 'text-input', position: { x: 0, y: 0 } });
    const b = addNode({ defKind: 'generate', position: { x: 400, y: 0 } });
    connectNodes({ sourceNodeId: a, sourcePortId: 'text', targetNodeId: b, targetPortId: 'prompt' });
    clearHistory();

    removeNodes([a]);
    expect(Object.keys(state().edges)).toHaveLength(0);

    undo();
    expect(Object.keys(state().nodes)).toHaveLength(2);
    expect(Object.keys(state().edges)).toHaveLength(1);
  });

  it('清空画布可撤销（最容易误触的操作）', () => {
    addNode({ defKind: 'text-input', position: { x: 0, y: 0 } });
    addNode({ defKind: 'generate', position: { x: 400, y: 0 } });
    clearHistory();

    resetGraph();
    expect(Object.keys(state().nodes)).toHaveLength(0);
    undo();
    expect(Object.keys(state().nodes)).toHaveLength(2);
  });

  it('连线失败不进历史', () => {
    addNode({ defKind: 'text-input', position: { x: 0, y: 0 } });
    const b = addNode({ defKind: 'generate', position: { x: 400, y: 0 } });
    clearHistory();

    // text → reference（只吃图/视频）应被拒绝
    const r = connectNodes({ sourceNodeId: Object.keys(state().nodes)[0]!, sourcePortId: 'text', targetNodeId: b, targetPortId: 'reference' });
    expect(r.ok).toBe(false);
    expect(canUndo()).toBe(false);
  });

  it('重复连同一对端口不会产生一条可撤销的空操作', () => {
    const a = addNode({ defKind: 'text-input', position: { x: 0, y: 0 } });
    const b = addNode({ defKind: 'generate', position: { x: 400, y: 0 } });
    const intent = { sourceNodeId: a, sourcePortId: 'text', targetNodeId: b, targetPortId: 'prompt' };
    connectNodes(intent);
    const depth = useHistoryStore.getState().past.length;
    connectNodes(intent); // duplicate
    expect(useHistoryStore.getState().past.length).toBe(depth);
  });

  it('断开连线可撤销', () => {
    const a = addNode({ defKind: 'text-input', position: { x: 0, y: 0 } });
    const b = addNode({ defKind: 'generate', position: { x: 400, y: 0 } });
    connectNodes({ sourceNodeId: a, sourcePortId: 'text', targetNodeId: b, targetPortId: 'prompt' });
    const edgeId = Object.keys(state().edges)[0]!;
    clearHistory();

    removeEdge(edgeId);
    expect(Object.keys(state().edges)).toHaveLength(0);
    undo();
    expect(Object.keys(state().edges)).toHaveLength(1);
  });

  it('参数修改可撤销，同值写入不算一步', () => {
    const id = addNode({ defKind: 'text-input', position: { x: 0, y: 0 } });
    clearHistory();

    setNodeParam(id, 'content', '第一版');
    setNodeParam(id, 'content', '第一版'); // 同值，应被忽略
    expect(useHistoryStore.getState().past).toHaveLength(1);

    undo();
    expect(state().nodes[id]?.params.content).toBe('');
  });

  it('连续打字合并成一步，否则 50 条历史几秒就吃满', () => {
    const id = addNode({ defKind: 'text-input', position: { x: 0, y: 0 } });
    clearHistory();

    for (const t of ['一', '一只', '一只猫', '一只戴墨镜的猫', '一只戴墨镜的橘猫']) {
      setNodeParam(id, 'content', t);
    }
    expect(useHistoryStore.getState().past).toHaveLength(1);
    expect(state().nodes[id]?.params.content).toBe('一只戴墨镜的橘猫');

    undo();
    expect(state().nodes[id]?.params.content).toBe('');
  });

  it('改不同参数是两步，可以分别撤销', () => {
    const id = addNode({ defKind: 'generate', position: { x: 0, y: 0 } });
    clearHistory();

    setNodeParam(id, 'prompt', '第一版提示词');
    setNodeParam(id, 'aspectRatio', '16:9');
    expect(useHistoryStore.getState().past).toHaveLength(2);

    undo();
    expect(state().nodes[id]?.params.aspectRatio).toBe('1:1');
    expect(state().nodes[id]?.params.prompt).toBe('第一版提示词');
  });

  it('一次拖拽（多次位置变更）只算一步', () => {
    const id = addNode({ defKind: 'text-input', position: { x: 0, y: 0 } });
    clearHistory();

    for (const x of [1, 2, 3, 8, 15, 24, 40, 60]) moveNode(id, { x, y: 0 });
    expect(useHistoryStore.getState().past).toHaveLength(1);

    undo();
    expect(state().nodes[id]?.position).toEqual({ x: 0, y: 0 });
  });

  it('撤销后的新操作会清空重做栈', () => {
    addNode({ defKind: 'text-input', position: { x: 0, y: 0 } });
    undo();
    expect(canRedo()).toBe(true);

    addNode({ defKind: 'asset', position: { x: 400, y: 0 } });
    expect(canRedo()).toBe(false);
  });

  it('空栈时 undo/redo 返回 false，不改动画布', () => {
    expect(canUndo()).toBe(false);
    expect(undo()).toBe(false);
    expect(redo()).toBe(false);
  });

  it('历史最多保留 50 条，不会无限吃内存', () => {
    for (let i = 0; i < 60; i += 1) {
      addNode({ defKind: 'text-input', position: { x: i * 400, y: 0 } });
    }
    expect(useHistoryStore.getState().past.length).toBeLessThanOrEqual(50);
  });

  it('回放期间的写操作不会再 checkpoint（避免撤销自己污染历史）', () => {
    addNode({ defKind: 'text-input', position: { x: 0, y: 0 } });
    addNode({ defKind: 'asset', position: { x: 400, y: 0 } });
    const depth = useHistoryStore.getState().past.length;

    undo();
    expect(useHistoryStore.getState().past.length).toBe(depth - 1);
    expect(useHistoryStore.getState().replaying).toBe(false);
  });

  it('checkpoint 的快照是深拷贝，之后改画布不会篡改历史', () => {
    const id = addNode({ defKind: 'text-input', position: { x: 0, y: 0 } });
    checkpoint('手动检查点');
    moveNode(id, { x: 999, y: 999 });
    undo();
    expect(state().nodes[id]?.position).toEqual({ x: 0, y: 0 });
  });
});
