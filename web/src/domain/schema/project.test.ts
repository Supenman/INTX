import { describe, expect, it } from 'vitest';
import { builtinNodes } from '../node/builtins';
import type { NodeDefinition } from '../node/definition';
import {
  checkIntegrity,
  CURRENT_SCHEMA_VERSION,
  migrate,
  trimForSave,
  validateProjectFile,
  type ProjectFile,
  type ProjectNode,
} from './project';

function node(over: Partial<ProjectNode> = {}): ProjectNode {
  return {
    id: 'n1',
    defKind: 'generate',
    position: { x: 0, y: 0 },
    size: { width: 320, height: 240 },
    params: {},
    ...over,
  };
}

function file(over: Partial<ProjectFile> = {}): ProjectFile {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    project: { id: 'p1', name: 'demo', createdAt: 1, updatedAt: 2 },
    nodes: [node()],
    edges: [],
    assets: [],
    tasks: [],
    ...over,
  };
}

describe('migrate', () => {
  it('当前版本直接通过', () => {
    const r = migrate(file());
    expect(r.ok).toBe(true);
  });

  it('缺少 schemaVersion 被拒绝', () => {
    const r = migrate({ project: { id: 'p', name: 'n' }, nodes: [], edges: [], assets: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('malformed');
  });

  it('未来版本给出明确提示而不是静默降级', () => {
    const r = migrate({ ...file(), schemaVersion: CURRENT_SCHEMA_VERSION + 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('future_version');
  });

  it('非对象输入被拒绝', () => {
    expect(migrate(null).ok).toBe(false);
    expect(migrate('hello').ok).toBe(false);
  });

  it('缺字段的文档被拒绝', () => {
    const r = migrate({ schemaVersion: 1, project: { id: 'p', name: 'n' }, nodes: [] });
    expect(r.ok).toBe(false);
  });

  it('补齐可选的 tasks 与 viewport', () => {
    const r = migrate({ schemaVersion: 1, project: { id: 'p', name: 'n' }, nodes: [], edges: [], assets: [] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.tasks).toEqual([]);
      expect(r.value.viewport).toBeUndefined();
    }
  });
});

describe('validateProjectFile', () => {
  it('viewport 残缺时丢弃而不是半信半疑', () => {
    const r = validateProjectFile({
      schemaVersion: 1,
      project: { id: 'p', name: 'n' },
      nodes: [],
      edges: [],
      assets: [],
      viewport: { x: 1, y: 2 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.viewport).toBeUndefined();
  });
});

describe('trimForSave', () => {
  it('任务超过上限时只保留最近的', () => {
    const tasks = Array.from({ length: 250 }, (_, i) => ({ createdAt: i }) as never);
    const trimmed = trimForSave(file({ tasks }));
    expect(trimmed.tasks).toHaveLength(200);
    expect((trimmed.tasks[0] as unknown as { createdAt: number }).createdAt).toBe(249);
  });

  it('未超上限时原样返回（不复制）', () => {
    const f = file();
    expect(trimForSave(f)).toBe(f);
  });
});

describe('checkIntegrity', () => {
  const known = new Set<string>(builtinNodes.map((d: NodeDefinition) => d.kind));

  it('健康项目无问题', () => {
    expect(checkIntegrity({ file: file(), knownNodeKinds: known })).toEqual([]);
  });

  it('悬空连线被发现', () => {
    const f = file({ edges: [{ id: 'e1', source: 'n1', sourcePort: 'out', target: 'ghost', targetPort: 'prompt' }] });
    const issues = checkIntegrity({ file: f, knownNodeKinds: known });
    expect(issues[0]!.code).toBe('dangling_edge');
  });

  it('指向不存在资产的节点被发现', () => {
    const f = file({ nodes: [node({ assetId: 'as_ghost' })] });
    const issues = checkIntegrity({ file: f, knownNodeKinds: known });
    expect(issues[0]!.code).toBe('missing_asset');
  });

  it('未注册的节点类型被发现', () => {
    const f = file({ nodes: [node({ defKind: 'from-the-future' })] });
    const issues = checkIntegrity({ file: f, knownNodeKinds: known });
    expect(issues[0]!.code).toBe('unknown_node_kind');
  });
});
