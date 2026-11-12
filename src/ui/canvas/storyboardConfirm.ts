import { analyzeStoryboardScript, parseGrid } from '@/domain';

/**
 * 分镜「拆分」前的一次性确认文案。
 *
 * 合成一条而不是连弹两个框：已有产物（全新生成要再花钱）与
 * 行数≠格数（循环复用/丢弃）都是「点下去之前必须知道」的事实。
 * domain 只给机器事实（analyzeStoryboardScript），文案在这里组织。
 * resume / cellIndex 不触发：补格与单格重发在批开始时已确认过语义。
 */
export interface StoryboardConfirmInput {
  derivedCount: number;
  grid: string;
  script: string;
  resume: boolean;
  cellIndex?: number;
}

export function storyboardRunConfirm(input: StoryboardConfirmInput): string | null {
  if (input.resume || input.cellIndex !== undefined) return null;

  const parts: string[] = [];
  const total = parseGrid(input.grid).total;

  if (input.derivedCount > 0) {
    parts.push(
      `这个节点已有 ${input.derivedCount} 格产物。「拆分」将全新生成 ${total} 张（按张计费），已有产物保留在资产库。`,
    );
  }

  const coverage = analyzeStoryboardScript(input.script, input.grid);
  if (coverage.kind === 'reuse') {
    parts.push(
      `剧本 ${coverage.lines} 行、宫格 ${coverage.cells} 格：第 ${coverage.lines + 1}–${coverage.cells} 格将循环复用前 ${coverage.lines} 行（每格单独计费）。`,
    );
  } else if (coverage.kind === 'drop') {
    parts.push(`剧本 ${coverage.lines} 行、宫格 ${coverage.cells} 格：多出的 ${coverage.dropped} 行不会生成。`);
  }

  if (parts.length === 0) return null;
  return `${parts.join('\n')}\n继续吗？`;
}
