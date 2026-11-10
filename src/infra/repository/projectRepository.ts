import { CURRENT_SCHEMA_VERSION, checkIntegrity, migrate, trimForSave, type ProjectFile, type ProjectNode } from '@/domain';
import { useGraphStore } from '@/app/stores/graphStore';
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
        position: n.position,
        size: n.size,
        params: n.params,
        ...(n.assetId !== undefined ? { assetId: n.assetId } : {}),
        ...(n.lastTaskId !== undefined ? { lastTaskId: n.lastTaskId } : {}),
      }),
    ),
    edges: Object.values(edges),
    assets: [],
    tasks: Object.values(tasks),
  };
}

/** 把项目文件装载进 store，并返回完整性告警供 UI 展示。 */
export function hydrateProject(file: ProjectFile): { issues: ReturnType<typeof checkIntegrity> } {
  const graphNodes = file.nodes.map((n) => ({
    ...n,
    // 兼容旧版本可能缺失的尺寸
    size: n.size ?? { width: 280, height: 220 },
  }));

  useGraphStore.setState((s) => {
    s.nodes = {};
    s.edges = {};
    for (const n of graphNodes) s.nodes[n.id] = n;
    for (const e of file.edges) s.edges[e.id] = e;
  });

  useTaskStore.setState(() => {
    const tasks: Record<string, (typeof file.tasks)[number]> = {};
    for (const t of file.tasks) tasks[t.id] = t;
    return { tasks };
  });

  const knownNodeKinds = new Set(listNodeDefinitions().map((d) => d.kind));
  const issues = checkIntegrity({ file: { ...file, nodes: graphNodes }, knownNodeKinds });
  return { issues };
}
