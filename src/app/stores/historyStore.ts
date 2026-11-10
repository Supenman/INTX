import { create } from 'zustand';
import type { ProjectEdge, ProjectNode } from '@/domain';
import { useGraphStore } from './graphStore';

/**
 * 撤销 / 重做。
 *
 * 存的是**整张图的快照**，不是 diff。理由很实际：节点最多几百个，
 * 一份快照几十 KB，50 条也就几 MB；换来的是不用为每种操作写反向操作，
 * 也不会出现"撤销一半"的中间态。旧代码根本没有历史，用户误点"清空画布"
 * 就只能重做一遍——这是最该先补的基础体验。
 *
 * 记录的时机是**显式 checkpoint**：每个写操作在自己动手前存一份当前状态。
 * 不用订阅 store 的原因是装载项目、挂产物这些内部同步不该进历史，
 * 否则一开应用按 Ctrl+Z 就把画布清空了。
 */

export interface GraphSnapshot {
  nodes: Record<string, ProjectNode>;
  edges: Record<string, ProjectEdge>;
}

export interface HistoryEntry {
  label: string;
  snapshot: GraphSnapshot;
  at: number;
  /** 合并键：同一键在窗口内的连续变更算一步（拖拽时尤其重要） */
  mergeKey: string | null;
}

const MAX_ENTRIES = 50;
/** 拖拽中 React Flow 每帧都派发位置变更，必须合并成一步 */
const MERGE_WINDOW_MS = 700;

export interface HistoryState {
  past: HistoryEntry[];
  future: GraphSnapshot[];
  /** 撤销/重做回放中，此时写操作不能再 checkpoint，否则会污染历史 */
  replaying: boolean;
  lastAction: string | null;
}

export const useHistoryStore = create<HistoryState>(() => ({
  past: [],
  future: [],
  replaying: false,
  lastAction: null,
}));

function takeSnapshot(): GraphSnapshot {
  const { nodes, edges } = useGraphStore.getState();
  // 走一次 JSON 是为了拿到纯数据：immer 的 draft 代理不能被存进历史
  return JSON.parse(JSON.stringify({ nodes, edges })) as GraphSnapshot;
}

/**
 * 在当前变更**发生之前**调用。
 *
 * `mergeKey` 给高频变更用：拖拽每秒几十次，只有第一次真正入栈，
 * 于是 Ctrl+Z 一次回到拖拽前的位置，而不是退回 1 像素。
 */
export function checkpoint(label: string, mergeKey: string | null = null): void {
  const s = useHistoryStore.getState();
  if (s.replaying) return;

  const now = Date.now();
  const last = s.past[s.past.length - 1];
  if (mergeKey && last && last.mergeKey === mergeKey && now - last.at < MERGE_WINDOW_MS) {
    // 续期但不换快照：保留这一串变更开始前的状态
    last.at = now;
    useHistoryStore.setState({ future: [] });
    return;
  }

  const past = [...s.past, { label, snapshot: takeSnapshot(), at: now, mergeKey }];
  if (past.length > MAX_ENTRIES) past.shift();
  useHistoryStore.setState({ past, future: [], lastAction: label });
}

function applySnapshot(snap: GraphSnapshot): void {
  useHistoryStore.setState({ replaying: true });
  try {
    useGraphStore.setState((s) => {
      s.nodes = JSON.parse(JSON.stringify(snap.nodes)) as typeof s.nodes;
      s.edges = JSON.parse(JSON.stringify(snap.edges)) as typeof s.edges;
    });
  } finally {
    useHistoryStore.setState({ replaying: false });
  }
}

export function undo(): boolean {
  const s = useHistoryStore.getState();
  const entry = s.past[s.past.length - 1];
  if (!entry) return false;
  const current = takeSnapshot();

  useHistoryStore.setState({
    past: s.past.slice(0, -1),
    future: [...s.future, current],
    lastAction: `撤销：${entry.label}`,
  });
  applySnapshot(entry.snapshot);
  return true;
}

export function redo(): boolean {
  const s = useHistoryStore.getState();
  const next = s.future[s.future.length - 1];
  if (!next) return false;
  const current = takeSnapshot();

  useHistoryStore.setState({
    future: s.future.slice(0, -1),
    past: [
      ...s.past,
      { label: s.lastAction ?? '重做', snapshot: current, at: Date.now(), mergeKey: null },
    ],
    lastAction: '重做',
  });
  applySnapshot(next);
  return true;
}

/** 装载项目 / 新建项目之后调用：历史不该跨越项目边界。 */
export function clearHistory(): void {
  useHistoryStore.setState({ past: [], future: [], replaying: false, lastAction: null });
}

export function canUndo(): boolean {
  return useHistoryStore.getState().past.length > 0;
}

export function canRedo(): boolean {
  return useHistoryStore.getState().future.length > 0;
}
