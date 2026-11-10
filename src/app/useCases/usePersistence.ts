import { useCallback, useEffect, useRef, useState } from 'react';
import { collectAssetIndex, isHydratingAssets } from '@/app/useCases/assetLibrary';
import { loadProjectFile } from '@/app/useCases/projectFile';
import { restoreTasks, startTaskLog } from '@/app/useCases/taskRecovery';
import { resolveRuntime } from '@/infra/runtime';
import { hydrateProject, indexedDbRepository, snapshotProject } from '@/infra/repository/projectRepository';
import { useGraphStore } from '@/app/stores/graphStore';
import { useAssetStore } from '@/app/stores/assetStore';
import type { IntegrityIssue } from '@/domain';

/**
 * 自动保存 + 启动恢复。
 *
 * 对旧实现的改进：旧版把项目塞进 localStorage，写失败只 console.warn，
 * 用户以为存住了。这里把保存状态显式暴露给 UI，失败能被看见。
 *
 * 顺序：先装资产索引，再装画布 —— 反过来的话节点会先渲染一次空缩略图。
 */

export type SaveStatus = 'loading' | 'idle' | 'saving' | 'saved' | 'error';

const SAVE_DEBOUNCE_MS = 600;

export interface PersistenceState {
  status: SaveStatus;
  error: string | null;
  integrityIssues: IntegrityIssue[];
  /** 上次启动时，有多少任务是"应用退出没跑完"被收敛掉的 */
  interruptedTasks: number;
  saveNow: () => Promise<boolean>;
}

export function usePersistence(): PersistenceState {
  const [status, setStatus] = useState<SaveStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [integrityIssues, setIntegrityIssues] = useState<IntegrityIssue[]>([]);
  const [interruptedTasks, setInterruptedTasks] = useState(0);

  const timerRef = useRef<number | undefined>(undefined);
  const readyRef = useRef(false);

  const saveNow = useCallback(async (): Promise<boolean> => {
    setStatus('saving');
    try {
      const file = snapshotProject();
      // 资产清单与画布一起落盘：少了它，重开时产物就成了孤儿
      file.assets = collectAssetIndex();
      await indexedDbRepository.save(file);
      setStatus('saved');
      setError(null);
      return true;
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : '保存失败');
      return false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let stopLog: (() => void) | undefined;

    void (async () => {
      try {
        // 1) 项目文件：节点、连线、任务缓存
        const file = await loadProjectFile();
        if (cancelled) return;
        if (file && file.nodes.length > 0) {
          const { issues } = hydrateProject(file);
          setIntegrityIssues(issues);
        }

        // 2) 任务日志：权威状态，覆盖缓存，把没跑完的任务收敛掉
        const runtime = await resolveRuntime();
        if (cancelled) return;
        const report = await restoreTasks(runtime.tasks);
        if (report.interrupted > 0) {
          setInterruptedTasks(report.interrupted);
          void saveNow(); // 让项目文件里的缓存也同步成终态
        }

        // 3) 恢复完成之后才开订阅，否则恢复动作会被自己写回日志
        if (!cancelled) stopLog = startTaskLog(runtime.tasks);
        setStatus('idle');
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : '恢复项目失败');
        setStatus('error');
      } finally {
        readyRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
      stopLog?.();
    };
  }, [saveNow]);

  useEffect(() => {
    const schedule = () => {
      if (!readyRef.current) return;
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        void saveNow();
      }, SAVE_DEBOUNCE_MS);
    };

    const unsubGraph = useGraphStore.subscribe((curr, prev) => {
      if (curr.nodes === prev.nodes && curr.edges === prev.edges) return;
      schedule();
    });

    /**
     * 资产索引也要订阅。
     *
     * 以前只订阅画布：生成任务走 attachAssets() 会顺带改节点，所以碰巧能存上。
     * 素材编辑（裁切 / 遮罩）只往资产库加一条、不碰任何节点，
     * 只订阅画布的话刷新后新资产就消失了。E2E 会专门验这一步。
     */
    const unsubAssets = useAssetStore.subscribe((curr, prev) => {
      if (curr.assets === prev.assets) return;
      if (isHydratingAssets()) return;
      schedule();
    });

    return () => {
      unsubGraph();
      unsubAssets();
      window.clearTimeout(timerRef.current);
    };
  }, [saveNow]);

  return { status, error, integrityIssues, interruptedTasks, saveNow };
}
