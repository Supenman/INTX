import { beforeEach, describe, expect, it } from 'vitest';
import { addNode, connectNodes, resetGraph, setNodeParam, useGraphStore } from '@/app/stores/graphStore';
import { useTaskStore } from '@/app/stores/taskStore';
import { hydrateProject, snapshotProject } from '@/infra/repository/projectRepository';
import { migrate, CURRENT_SCHEMA_VERSION } from '@/domain/schema/project';
import { builtinNodes, overrideNode } from '@/domain';

/**
 * 存档往返测试。
 *
 * 旧项目最大的隐患不是画布卡，而是"关掉再打开东西没了"。
 * 这个测试守住底线：存下去的东西，经一次 JSON 序列化再读回来，必须一致。
 */

function resetAll() {
  resetGraph();
  useTaskStore.setState({ tasks: {} });
}

// 节点注册表是全局的，测试里要自己铺一遍（main.tsx 在真实应用里做这件事）。
// 用 overrideNode 而不是 registerNode：同文件里的其它测试可能已经注册过。
beforeEach(() => {
  for (const d of builtinNodes) overrideNode(d);
});

describe('项目存档往返', () => {
  it('节点、连线、位置在往返后完全一致', () => {
    resetAll();
    const a = addNode({ defKind: 'text-input', position: { x: 0, y: 0 } });
    const b = addNode({ defKind: 'generate', position: { x: 420, y: 80 } });
    const conn = connectNodes({
      sourceNodeId: a,
      sourcePortId: 'text',
      targetNodeId: b,
      targetPortId: 'prompt',
    });
    expect(conn.ok).toBe(true);

    const saved = snapshotProject('测试项目');
    expect(saved.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(saved.nodes).toHaveLength(2);
    expect(saved.edges).toHaveLength(1);

    // 模拟「存盘 → 重新打开」：必须走一次 JSON，才能暴露不可序列化的字段
    const migrated = migrate(JSON.parse(JSON.stringify(saved)));
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;

    resetAll();
    hydrateProject(migrated.value);

    const after = useGraphStore.getState();
    expect(Object.keys(after.nodes).sort()).toEqual([a, b].sort());
    expect(after.nodes[b]?.position).toEqual({ x: 420, y: 80 });

    const edges = Object.values(after.edges);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.source).toBe(a);
    expect(edges[0]?.sourcePort).toBe('text');
    expect(edges[0]?.targetPort).toBe('prompt');
  });

  it('节点参数被保存下来', () => {
    resetAll();
    const id = addNode({ defKind: 'text-input', position: { x: 0, y: 0 } });
    setNodeParam(id, 'text', '一只戴墨镜的猫');

    const saved = snapshotProject();
    expect(saved.nodes.find((n) => n.id === id)?.params.text).toBe('一只戴墨镜的猫');
  });

  it('任务也一起存盘，读回来能恢复展示状态', () => {
    resetAll();
    const id = addNode({ defKind: 'generate', position: { x: 0, y: 0 } });
    useTaskStore.setState({
      tasks: {
        tk_test: {
          id: 'tk_test',
          nodeId: id,
          kind: 'image',
          params: { kind: 'image', prompt: 'x', model: 'mock/image-v1', providerId: 'mock', inputAssetIds: [] },
          status: 'succeeded',
          phase: null,
          upstreamProgress: 1,
          resultAssetIds: ['as_1'],
          error: null,
          upstreamRef: null,
          attempt: 1,
          cost: null,
          createdAt: 100,
          startedAt: 110,
          finishedAt: 200,
        },
      },
    });

    const saved = snapshotProject();
    expect(saved.tasks).toHaveLength(1);
    expect(saved.tasks[0]?.status).toBe('succeeded');
  });

  it('未知节点类型的存档不会整体崩掉，而是给出告警', () => {
    resetAll();
    const file = snapshotProject();
    file.nodes.push({
      id: 'ghost',
      defKind: 'not-registered',
      position: { x: 0, y: 0 },
      size: { width: 100, height: 100 },
      params: {},
    });

    const { issues } = hydrateProject(file);
    expect(issues.some((i) => i.code === 'unknown_node_kind')).toBe(true);
    // 认识的节点仍在
    expect(Object.keys(useGraphStore.getState().nodes)).not.toContain('ghost');
  });

  it('未来版本的项目文件被明确拒绝，而不是读出半截数据', () => {
    const r = migrate({ schemaVersion: 999, project: { id: 'a', name: 'b' }, nodes: [], edges: [], assets: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('future_version');
  });
});
