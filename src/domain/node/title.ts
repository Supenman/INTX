/**
 * 节点标题。
 *
 * 为什么要单独一个字段：`NodeDefinition.title` 是**类型名**（"图片生成"），
 * 十个图片节点全叫这个名字，导出时就是十个 `01_图片生成.png`，人分不出哪张是哪张。
 * 所以实例上要能存一个用户自己起的名字，缺省时才回退到类型名。
 *
 * 这条是从 BeefTV 的 `node-definition.ts` 里学到的：它把 `label`（菜单里显示
 * "文本"）和 `defaultTitle`（新建出来的节点叫 "Note"）分成两个字段，并且实例标题
 * 可编辑。我们原来只有一个 `title`，等于把「类型」和「这个名字」混成了一个。
 */

/** 标题长度上限。够写清"第 3 格 女主特写"，又不至于把卡片和文件名顶爆。 */
export const MAX_NODE_TITLE = 60;

/**
 * 清洗用户输入的标题。
 *
 * 只做三件事，不做得更多：去首尾空白、压掉换行（卡片是单行的，换行会把布局顶开）、
 * 按码点截断。**不删中间的中文标点**——「女主：侧脸」这种是正常写法。
 */
export function sanitizeNodeTitle(value: string): string {
  const flat = value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  const chars = [...flat];
  return chars.length <= MAX_NODE_TITLE ? flat : chars.slice(0, MAX_NODE_TITLE).join('').trim();
}

/** 取节点的显示名：用户起过就用用户的，没起过用类型名。 */
export function nodeTitle(node: { title?: string | null } | undefined, fallback: string): string {
  const custom = typeof node?.title === 'string' ? node.title.trim() : '';
  return custom || fallback;
}

/**
 * 批量重命名的模板展开。
 *
 * 约定：模板里的 `#` 替换成补零序号，宽度按总数定、**最少两位**（10 个是
 * `01..10`，100 个是 `001..100`）。至少两位看着有点正式，但换来的是文件列表里
 * 的顺序不会变成 `1, 10, 11, 2`——这个错位在交付时很难被发现。
 *
 * 模板里没有 `#` 就自动在末尾补一个带空格的序号，否则十个节点会得到十个
 * 一模一样的名字，等于没改。
 *
 * 为什么不做 `##` 补零语法：多一个符号就多一条要记的规则，而宽度本来就该由
 * 总数决定，不需要用户操心。
 */
export function expandBatchTitle(pattern: string, index: number, total: number): string {
  const safeIndex = Number.isFinite(index) ? Math.max(1, Math.floor(index)) : 1;
  const safeTotal = Number.isFinite(total) ? Math.max(safeIndex, Math.floor(total)) : safeIndex;
  const width = Math.max(2, String(safeTotal).length);
  const seq = String(safeIndex).padStart(width, '0');
  const base = pattern.trim();
  if (!base) return seq;
  return base.includes('#') ? base.replace(/#/g, seq) : `${base} ${seq}`;
}
