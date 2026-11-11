import { CURRENT_SCHEMA_VERSION, checkIntegrity, migrate, trimForSave, type ProjectFile, type ProjectNode } from '@/domain';
import { hydrateGraph, useGraphStore } from '@/app/stores/graphStore';
import { useTaskStore } from '@/app/stores/taskStore';
import { listNodeDefinitions } from '@/domain';

/**
 * 项目仓库接口。
 *
 * 桌面端用 Tauri 文件系统实现，Web 调试用 IndexedDB 实现，
 * 上层用例只依赖这个接口 —— 这是"以后要不要支持多端"这个决策
 * 不阻塞当前开发的唯一办法。
 */

export interface ProjectRepository {
  load(id: string): Promise<ProjectFile | null>;
  save(file: ProjectFile): Promise<void>;
  list(): Promise<{ id: string; name: string; updatedAt: number }[]>;
  remove(id: string): Promise<void>;
}

const DB_NAME = 'intx';
const STORE = 'projects';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'project.id', });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

/** IndexedDB 实现。写入前统一走 trim，避免任务日志把项目文件撑大。 */
export const indexedDbRepository: ProjectRepository = {
  async load(id) {
    const raw = await tx<unknown>('readonly', (s) => s.get(id) as IDBRequest<unknown>);
    if (!raw) return null;
    const result = migrate(raw);
    return result.ok ? result.value : null;
  },
  async save(file) {
    await tx('readwrite', (s) => s.put(trimForSave(file)) as IDBRequest<IDBValidKey>);
  },
  async list() {
    const all = await tx<ProjectFile[]>('readonly', (s) => s.getAll() as IDBRequest<ProjectFile[]>);
    return all
      .map((f) => ({ id: f.project.id, name: f.project.name, updatedAt: f.project.updatedAt }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async remove(id) {
    await tx('readwrite', (s) => s.delete(id) as IDBRequest<undefined>);
  },
};

export const DEFAULT_PROJECT_ID = 'default';

/** 从当前 store 状态组装一份项目文件。 */
export function snapshotProject(name = '未命名项目'): ProjectFile {
  const { nodes, edges } = useGraphStore.getState();
  const { tasks } = useTaskStore.getState();

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    project: {
      id: DEFAULT_PROJECT_ID,
      name,
      createdAt: 0,
      updatedAt: Date.now(),
    },
    nodes: Object.values(nodes).map(
      (n): ProjectNode => ({
        id: n.id,
        defKind: n.defKind,
        // 白名单式序列化：新增字段必须同步加在这里，否则「界面上改了、存档里没有」
        // ——刷新就丢，而且只在刷新后才暴露。节点标题就是踩过这个坑才补的。
        ...(n.title !== undefined ? { title: n.title } : {}),
        position: n.position,
        size: n.size,
        params: n.params,
        ...(n.assetId !== undefined ? { assetId: n.assetId } : {}),
        ...(n.derivedAssetIds !== undefined ? { derivedAssetIds: n.derivedAssetIds } : {}),
        ...(n.lastTaskId !== undefined ? { lastTaskId: n.lastTaskId } : {}),
      }),
    ),
    edges: Object.values(edges),
    assets: [],
    tasks: Object.values(tasks),
  };
}

/**
 * 把项目文件装载进 store，并返回完整性告警供 UI 展示。
 *
 * 未知节点类型**不装载**：没有 NodeDefinition 就不知道该渲染什么、
 * 有哪些端口，硬塞进画布会得到一个点不动的空壳。
 * 用户看到的是告警 + 其余画布照常可用，而不是整页白屏。
 */
export function hydrateProject(file: ProjectFile): { issues: ReturnType<typeof checkIntegrity> } {
  const knownNodeKinds = new Set(listNodeDefinitions().map((d) => d.kind));

  const graphNodes = file.nodes
    .filter((n) => knownNodeKinds.has(n.defKind))
    .map((n) => ({
      ...n,
      // 兼容旧版本可能缺失的尺寸
      size: n.size ?? { width: 280, height: 220 },
    }));
  const loadedIds = new Set(graphNodes.map((n) => n.id));
  // 只保留两端都装载成功的连线，悬挂边不进入图
  const graphEdges = file.edges.filter((e) => loadedIds.has(e.source) && loadedIds.has(e.target));

  // 走统一的装载入口：它会清掉历史，避免"打开项目后按 Ctrl+Z 画布变空"
  hydrateGraph(graphNodes, graphEdges);

  useTaskStore.setState(() => {
    const tasks: Record<string, (typeof file.tasks)[number]> = {};
    for (const t of file.tasks) tasks[t.id] = t;
    return { tasks };
  });

  const issues = checkIntegrity({ file, knownNodeKinds });
  return { issues };
}
