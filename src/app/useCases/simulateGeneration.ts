import { useCallback } from 'react';
import { useGraphStore } from '@/app/stores/graphStore';
import {
  markFailed,
  markPhase,
  markProgress,
  markRunning,
  markSucceeded,
  submitTask,
  useTaskStore,
} from '@/app/stores/taskStore';
import type { TaskKind } from '@/domain';

/**
 * 模拟生成用例 —— S2 阶段的占位实现。
 *
 * 刻意不接真实后端，但**走完整的任务状态机**：
 * queued → running（三个阶段）→ succeeded/failed。
 * 目的有两个：
 *
 * 1. 证明 Task/Asset 模型能跑通，不必等后端就绪；
 * 2. 顺便验证"没有真进度就不编百分比"这条设计——
 *    这里的进度来自模拟的"上游回报"，并且会有一段时间返回 null。
 *
 * 接入真实适配器时，只需把 setTimeout 换成 HTTP 调用，上层 UI 一行不改。
 */

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

/**
 * 返回**稳定引用**的生成函数。
 *
 * 踩坑记录：这个 hook 直接返回内联 async 函数时，每次渲染都是新引用，
 * 上游 onGenerate 的 useCallback 随之变化，进而触发同步 effect 反复执行，
 * 最终导致 "Maximum update depth exceeded"。
 * 用 useCallback 包一层（内部不依赖任何会变化的状态）即可固定引用。
 */
export function useSimulatedGeneration() {
  return useCallback(async function generate(nodeId: string): Promise<void> {
    const node = useGraphStore.getState().nodes[nodeId];
    if (!node) return;

    const outputKind = (node.params.outputKind as TaskKind | undefined) ?? 'image';
    const prompt = typeof node.params.prompt === 'string' ? node.params.prompt : '';

    // 参数快照：提交那一刻冻结，之后节点怎么改都不影响这次任务
    const taskId = submitTask({
      nodeId,
      kind: outputKind,
      params: {
        kind: outputKind,
        prompt,
        model: 'mock/model',
        providerId: 'mock',
        inputAssetIds: [],
        aspectRatio: String(node.params.aspectRatio ?? '1:1'),
      },
    });

    try {
      await sleep(320);
      markRunning(taskId);

      await sleep(500);
      markPhase(taskId, 'generating');

      // 前 1.2 秒上游没有进度可报 → null → UI 显示不确定态扫光
      await sleep(1200);
      if (useTaskStore.getState().tasks[taskId]?.status !== 'running') return;

      for (const p of [0.2, 0.45, 0.68, 0.85]) {
        await sleep(420);
        if (useTaskStore.getState().tasks[taskId]?.status !== 'running') return;
        markProgress(taskId, p);
      }

      markPhase(taskId, 'downloading');
      await sleep(360);
      markProgress(taskId, 1);

      // 演示错误分支：提示词包含 fail 时走失败路径
      if (prompt.toLowerCase().includes('fail')) {
        throw new Error('429 rate limit exceeded');
      }

      markSucceeded(taskId, []);
    } catch (e) {
      markFailed(taskId, e);
    }
  }, []);
}
