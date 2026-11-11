/**
 * 导出交付时的文件命名与排序。
 *
 * 这一块是照 BeefTV 的 `canvas-batch-download.ts` 的做法补的，但只吸收**结论**，
 * 不搬代码。它解决的是同一件事：画布上的产物本来是按内容哈希存的
 * （`assets/d1/d1ddc13d….png`），交给运营时那串哈希不能用，必须换成人能读的名字，
 * 而且同一批里的顺序要跟人在画布上看到的顺序一致。
 *
 * 三条约束来自真机与操作系统，不是审美：
 *  1. **前缀补零按总数算宽度**。10 张时 `01..10`，100 张时 `001..100`。
 *     如果按单张的位数补，10 张里会出现 `1_…` 和 `10_…` 混排。
 *  2. **Windows 保留设备名**。`CON.png` 在 Windows 上创建失败——不是重名，是
 *     这个名字永远不能当文件名。公司用的是 Windows，这条必须拦。
 *  3. **结尾的点和空格会被 Windows 静默丢弃**。`草稿. ` 存下去变成 `草稿`，
 *     再按原名找就找不到了。
 *
 * 排序按画布坐标而不是创建时间：人看画布是从左上往右下扫的，导出顺序必须跟
 * 眼睛一致，否则「第 3 张」在两边指的不是同一张。
 */

/** 单个名字段的字符上限。长提示词当标题时会把路径顶爆，必须在客户端先截。 */
const MAX_NAME_PART = 80;

/** 判定「同一行」的纵向容差。48px 是 BeefTV 实测值，约等于一张缩略图行距的一半。 */
export const EXPORT_ROW_BAND_PX = 48;

/** Windows 保留设备名（含带扩展名的形式，`con.png` 同样非法）。 */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * 按码点截断。用 `slice` 会把 emoji 的代理对切一半，落盘成一个替换字符——
 * 和提示词字数统计同一个理由。
 */
function truncateByCodePoint(value: string, max: number): string {
  const chars = [...value];
  return chars.length <= max ? value : chars.slice(0, max).join('');
}

/** 标题本身已带同名扩展名时剥掉，避免导出成 `封面.png.png`。 */
function stripMatchingExtension(title: string, ext: string): string {
  if (!ext) return title;
  const suffix = `.${ext}`;
  return title.toLowerCase().endsWith(suffix) ? title.slice(0, title.length - suffix.length) : title;
}

/**
 * 把一个任意字符串变成可落盘的文件名段。
 *
 * 非法字符替换为空格而不是删除：`a/b` 变 `a b` 还能读，变 `ab` 就读不出来了。
 */
export function sanitizeFileNamePart(value: string, fallback = '未命名'): string {
  const cleaned = value
    // 路径分隔符、Windows 非法字符、C0/C1 控制字符（用 \p{Cc} 而不是码点区间，
    // 后者会被 lint 判成"正则里塞控制字符"，读起来也更费劲）
    .replace(/[\\/:*?"<>|\p{Cc}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // 开头的点会在类 Unix 上变成隐藏文件
    .replace(/^\.+/, '')
    // 结尾的点和空格 Windows 会静默丢弃
    .replace(/[. ]+$/, '');

  const capped = truncateByCodePoint(cleaned, MAX_NAME_PART);
  if (!capped) return fallback;
  // 保留名加前缀而不是替换掉，用户还能认出自己起过这个名字
  if (WINDOWS_RESERVED.test(capped.split('.')[0] ?? '')) return `${fallback}_${capped}`;
  return capped;
}

export interface ExportNameInput {
  /** 节点标题，用户可读的东西 */
  title: string;
  /** 这一批里的序号，**从 1 开始** */
  index: number;
  /** 这一批的总数，决定补零宽度 */
  total: number;
  /** 扩展名，可带前导点 */
  ext: string;
}

/**
 * 生成导出文件名：`01_封面.png`。
 *
 * `index` 从 1 开始是刻意的——外面传 `i + 1` 比传 `i` 之后再在内部加一更不容易错，
 * 而序号错位的后果是交付的图整体错开一位，很难被发现。
 */
export function buildExportFileName({ title, index, total, ext }: ExportNameInput): string {
  const safeExt = ext.replace(/^\./, '').toLowerCase() || 'bin';
  const safeIndex = Number.isFinite(index) ? Math.max(1, Math.floor(index)) : 1;
  const safeTotal = Number.isFinite(total) ? Math.max(safeIndex, Math.floor(total)) : safeIndex;

  const padWidth = Math.max(2, String(safeTotal).length);
  const prefix = String(safeIndex).padStart(padWidth, '0');
  const base = sanitizeFileNamePart(stripMatchingExtension(title, safeExt));
  return `${prefix}_${base}.${safeExt}`;
}

/**
 * 按画布位置排序：先按行带（y 落在同一个 48px 带里算同一行），行内按 x，最后按 id 兜底。
 *
 * 加 id 兜底是为了**结果稳定**：两个节点坐标完全相同时，没有兜底键的排序在不同
 * 引擎上可能给出不同顺序，同一批图两次导出会错位。
 */
export function sortForExport<T extends { id: string }>(
  items: readonly T[],
  position: (item: T) => { x: number; y: number },
  band = EXPORT_ROW_BAND_PX,
): T[] {
  return [...items].sort((a, b) => {
    const pa = position(a);
    const pb = position(b);
    const rowA = Math.round(pa.y / band);
    const rowB = Math.round(pb.y / band);
    if (rowA !== rowB) return rowA - rowB;
    if (pa.x !== pb.x) return pa.x - pb.x;
    return a.id.localeCompare(b.id);
  });
}
