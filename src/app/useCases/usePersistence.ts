import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_PROJECT_ID,
  hydrateProject,
  indexedDbRepository,
  snapshotProject,
} from '@/infra/repository/projectRepository';
import { useGraphStore } from '@/app/stores/graphStore';
import type { IntegrityIssue } from '@/domain';

/**
 * 自动保存 + 启动恢复。
 *
 * 对旧实现的改进：旧版把项目塞进 localStorage，写失败只 console.warn，
 * 用户以为存住了。这里把保存状态显式暴露给 UI，失败能被看见。
 */

export type SaveStatus = 'loading' | 'idle' | 'saving' | 'saved' | 'error';

const SAVE_DEBOUNCE_MS = 600;

export interface PersistenceState {
  status: SaveStatus;
  error: string | null;
  integrityIssues: IntegrityIssue[];
  /** 手动保存，返回是否成功 */
  saveNow: () => Promise<boolean>;
}

export function usePersistence(): PersistenceState {
  const [status, setStatus] = useState<SaveStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [integrityIssues, setIntegrityIssues] = useState<IntegrityIssue[]>([]);

  const timerRef = useRef<number | undefined>(undefined);
  const readyRef = useRef(false);

  const saveNow = useCallback(async (): Promise<boolean> => {
    setStatus('saving');
    try {
      await indexedDbRepository.save(snapshotProject());
      setStatus('saved');
      setError(null);
      return true;
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : '保存失败');
      return false;
    }
  }, []);

  // 启动恢复
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const file = await indexedDbRepository.load(DEFAULT_PROJECT_ID);
        if (cancelled) return;
        if (file && file.nodes.length > 0) {
          const { issues } = hydrateProject(file);
          setIntegrityIssues(issues);
        }
        setStatus('idle');
      } catch (e) {
        if (cancelled) return;
        // 恢复失败不阻塞使用：保留空画布，但把原因说出来
        setError(e instanceof Error ? e.message : '恢复项目失败');
        setStatus('error');
      } finally {
        readyRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 变更后防抖保存
  useEffect(() => {
    const unsub = useGraphStore.subscribe((curr, prev) => {
      if (!readyRef.current) return;
      // 只有节点/连线变化才值得写盘，纯位置拖动等也算变化
      if (curr.nodes === prev.nodes && curr.edges === prev.edges) return;
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        void saveNow();
      }, SAVE_DEBOUNCE_MS);
    });
    return () => {
      unsub();
      window.clearTimeout(timerRef.current);
    };
  }, [saveNow]);

  return { status, error, integrityIssues, saveNow };
}
