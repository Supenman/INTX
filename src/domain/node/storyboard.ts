import { parseGrid } from './grid';

/**
 * 分镜的纯逻辑：切行、剧本覆盖度、补格计划、单格替换。
 *
 * 这些判断以前散在执行用例和提示词拼装里，缩格补格会把新旧产物
 * 合并成 10 条、行数与格数不匹配时静默循环/丢弃。收敛成纯函数后
 * 可在 node 环境单测，执行层与确认文案共用同一套事实，不会各说各话。
 */

/** 与 storyboardPrompt 完全同一套切行规则：按行拆、trim、滤空行。 */
export function storyboardLines(script: string): string[] {
  return script
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');
}

/** 剧本行数与宫格格数的覆盖关系。机器事实，文案由 UI 层组织。 */
export type ScriptCoverage =
  | { kind: 'empty' }
  | { kind: 'exact'; lines: number }
  | { kind: 'reuse'; lines: number; cells: number; repeated: number }
  | { kind: 'drop'; lines: number; cells: number; dropped: number };

export function analyzeStoryboardScript(script: string, grid: string): ScriptCoverage {
  const lines = storyboardLines(script).length;
  const cells = parseGrid(grid).total;
  if (lines === 0) return { kind: 'empty' };
  if (lines === cells) return { kind: 'exact', lines };
  if (lines < cells) return { kind: 'reuse', lines, cells, repeated: cells - lines };
  return { kind: 'drop', lines, cells, dropped: lines - cells };
}

/** 最近一次任务快照里与补格相关的参数；undefined = 旧快照未记录，跳过比较。 */
export interface ResumeSnapshot {
  grid?: string;
  aspectRatio?: string;
  style?: string;
}

export type ResumePlan =
  | { action: 'fill'; startCell: number; keepIds: readonly string[] }
  | { action: 'truncate'; keepIds: readonly string[]; dropped: number; message: string }
  | { action: 'reject'; message: string };

/**
 * 补格计划。三分支：
 * - 已有产物 >= 当前格数：截断保留前 N 格（零成本，不建任务不发请求）。
 *   不伪造一条「0 次调用却挂 N 个产物」的成功任务，审计口径才诚实。
 * - 已有产物 < 格数但快照参数已变：拒绝。补格会混入新旧两种参数的产物，
 *   让用户走「拆分」全新生成（那里有费用确认），或改回原参数再补。
 * - 其余：从已有格数之后补齐（原行为）。
 */
export function planStoryboardResume(input: {
  existingIds: readonly string[];
  grid: string;
  aspectRatio: string;
  style: string;
  snapshot: ResumeSnapshot | null;
}): ResumePlan {
  const total = parseGrid(input.grid).total;
  const existing = input.existingIds;

  if (existing.length >= total) {
    const keepIds = existing.slice(0, total);
    const dropped = existing.length - total;
    const message =
      dropped > 0
        ? `格数已缩减：保留前 ${total} 格（按原参数生成），多余 ${dropped} 格产物仍保留在资产库`
        : `${total} 格已全部出图，无需补格。要重新生成请用「拆分」或单格重发`;
    return { action: 'truncate', keepIds, dropped, message };
  }

  const snap = input.snapshot;
  if (snap) {
    const drift: string[] = [];
    if (snap.grid !== undefined && snap.grid !== input.grid) drift.push(`宫格 ${snap.grid}→${input.grid}`);
    if (snap.aspectRatio !== undefined && snap.aspectRatio !== input.aspectRatio) {
      drift.push(`比例 ${snap.aspectRatio}→${input.aspectRatio}`);
    }
    if (snap.style !== undefined && snap.style !== input.style) drift.push('画风');
    if (drift.length > 0) {
      return {
        action: 'reject',
        message: `上次生成后参数已变（${drift.join('、')}），补格会混入新旧两种参数的产物。请点「拆分」全新生成，或改回原参数再补格`,
      };
    }
  }

  return { action: 'fill', startCell: existing.length, keepIds: existing };
}

/** 替换第 N 格产物（不追加）。越界时原样返回，调用方负责前置校验。 */
export function replaceCell(ids: readonly string[], cellIndex: number, newId: string): string[] {
  if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= ids.length) return [...ids];
  const next = [...ids];
  next[cellIndex] = newId;
  return next;
}
