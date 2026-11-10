/**
 * 宫格布局的唯一真相。
 *
 * 之前 grid 字符串在三个地方被各自解析：生成用例算格数、提示词拼方位描述、
 * CSS 写死 repeat(n)。三处对 `1x4` 的理解不一致（CSS 是 1 行 4 列，
 * 提示词却写成「4 行 1 列」）。这里统一成 **RxC = 行 x 列**，
 * 生成、提示词、导出拼图都问这一个函数。
 */

/** 单个分镜最多 16 格。再大拼图会撑爆内存，UI 也不该给这个选项。 */
export const MAX_GRID_CELLS = 16;

export interface GridShape {
  rows: number;
  cols: number;
  total: number;
}

function clampDim(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(MAX_GRID_CELLS, Math.floor(n)));
}

/**
 * 解析 `2x2` / `1x4` 这类规格。非法输入退回单格，绝不抛错——
 * 用户手改过项目文件里的 param 也要能打开画布。
 * 超出 16 格时优先削较大的那个维度，保持原有比例感。
 */
export function parseGrid(spec: string): GridShape {
  const m = /^(\d+)x(\d+)$/.exec(spec.trim().toLowerCase());
  let rows = m ? clampDim(Number(m[1])) : 1;
  let cols = m ? clampDim(Number(m[2])) : 1;

  while (rows * cols > MAX_GRID_CELLS) {
    if (cols >= rows) cols -= 1;
    else rows -= 1;
  }
  return { rows, cols, total: rows * cols };
}

export interface GridCellRect {
  index: number;
  row: number;
  col: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GridLayout extends GridShape {
  /** 拼图画布总尺寸（含格间距） */
  width: number;
  height: number;
  /** 按行优先排列，与 `derivedAssetIds` 的顺序一一对应 */
  cells: GridCellRect[];
}

/**
 * 计算每格在拼图里的像素位置。纯数学，不碰 Canvas，
 * 所以能在 node 环境里单测，也能被 Tauri 侧复用。
 */
export function gridLayout(spec: string, cellWidth: number, cellHeight: number, gap = 0): GridLayout {
  const shape = parseGrid(spec);
  const w = Math.max(1, Math.round(cellWidth));
  const h = Math.max(1, Math.round(cellHeight));
  const g = Math.max(0, Math.round(gap));

  const cells: GridCellRect[] = [];
  for (let index = 0; index < shape.total; index += 1) {
    const row = Math.floor(index / shape.cols);
    const col = index % shape.cols;
    cells.push({ index, row, col, x: col * (w + g), y: row * (h + g), width: w, height: h });
  }

  return {
    ...shape,
    width: shape.cols * w + (shape.cols - 1) * g,
    height: shape.rows * h + (shape.rows - 1) * g,
    cells,
  };
}
