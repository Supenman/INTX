import type { AssetKind } from './model';

/**
 * 提示词里的 `@资产` 引用。
 *
 * 为什么要有它：现在想把一张图带进生成，唯一办法是「在画布上找到那个素材
 * 节点 → 拖一条线到参考素材口」。图一多就得先在画布里翻找，而且连线会
 * 越拖越乱。写提示词时本来就会说「照这张的质感」，`@` 就是把这个动作
 * 直接写在句子里。
 *
 * 三条设计取舍：
 *
 * 1. **token 里带 id，不带名字。** `@[雾夜街头](asset:as_xxx)` —— 名字只
 *    给人看，解析只认 id。按名字解析迟早出事：两个资产同名、用户手改了
 *    名字、机器上换了个语言……按 id 就只有「在」和「不在」两种结果。
 *
 * 2. **图片引用从文本里剥掉，文本引用内联进去。** 厂商不认识 `@[...]`
 *    这种语法，把 token 原样发过去只会污染提示词。图片是作为参考图传的，
 *    文字里不该再留一段指针；文本资产则本来就是文字，直接摊平。
 *
 * 3. **找不到的引用绝不静默丢弃。** 保留原文并报进 `missing`，由调用方
 *    拦下来告诉用户「这张图没了」。静默跳过是这类功能最常见的坑：用户
 *    以为用上了参考图，结果厂商只收到一段被删空的提示词。
 */

const REF_SOURCE = '@\\[([^\\]\\n]{0,80})\\]\\(asset:([A-Za-z0-9_-]{1,64})\\)';

export interface AssetRef {
  assetId: string;
  /** 人看的名字，只用于展示与日志，解析不依赖它 */
  label: string;
  /** 在原文中的起止位置（左闭右开），用于插入/高亮 */
  start: number;
  end: number;
  /** 原文片段，报错时让用户能认出是哪一段 */
  raw: string;
}

const KIND_LABEL: Record<AssetKind, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  text: '文本',
};

/**
 * 资产在人眼里的名字。
 *
 * 资产本身没有命名（只有 `assets/d1/d1dd…png` 这种路径），但引用面板里
 * 总得有个能认的称呼。不用「图 1 / 图 2」是因为那会随资产增删而漂移：
 * 用户昨天记住的「图 3」今天变成了另一张。用哈希前缀虽然技术味重，
 * 但它**永远指向同一张图**。
 */
export function assetRefLabel(kind: AssetKind, hash: string): string {
  return `${KIND_LABEL[kind]} ${hash.slice(0, 6)}`;
}

/** 生成可插入文本的引用 token。名字里的方括号和换行会把语法弄坏，先剔掉。 */
export function assetRefToken(assetId: string, label: string): string {
  const safe = label.replace(/[[\]\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
  const shown = safe === '' ? assetId.slice(0, 8) : safe;
  return `@[${shown}](asset:${assetId})`;
}

/** 按出现顺序取出所有引用。用于「这段提示词引用了哪些资产」。 */
export function parseAssetRefs(text: string): AssetRef[] {
  const re = new RegExp(REF_SOURCE, 'g');
  const out: AssetRef[] = [];
  let m: RegExpExecArray | null = re.exec(text);
  while (m !== null) {
    out.push({
      assetId: m[2]!,
      label: m[1]!.trim(),
      start: m.index,
      end: m.index + m[0].length,
      raw: m[0],
    });
    m = re.exec(text);
  }
  return out;
}

export interface AssetRefLookup {
  /** 资产当前是什么类型；不存在（已删或没导入）返回 null */
  kindOf: (assetId: string) => AssetKind | null;
  /** 文本类资产的内容；读不到返回 null */
  textOf?: (assetId: string) => string | null;
}

export interface AssetRefResolution {
  /** 真正发给厂商的文本 */
  text: string;
  /** 需要作为参考图附上的资产 id，按出现顺序去重 */
  imageAssetIds: string[];
  /** 找不到或读不到的引用。非空时调用方应当直接拦下，不要带病发请求。 */
  missing: AssetRef[];
  /** 资产确实存在，但这类引用用不了（例如音频）。要单独说清，别混进「不存在」。 */
  unsupported: AssetRef[];
}

/**
 * 把引用摊平成最终提示词。
 *
 * `refs` 由 `parseAssetRefs()` 给出。之所以不在这里自己解析一遍，是因为
 * UI 需要同一份位置信息做 chip 高亮——两处各解析一次，迟早不一致。
 */
export function applyAssetRefs(
  text: string,
  refs: readonly AssetRef[],
  lookup: AssetRefLookup,
): AssetRefResolution {
  // 没有引用就原样返回。这条很重要：**不含引用的提示词一个字都不能被改动**，
  // 否则用户精心排的换行会在第一次生成时被悄悄吃掉。
  if (refs.length === 0) return { text, imageAssetIds: [], missing: [], unsupported: [] };

  let out = '';
  let cursor = 0;
  const imageAssetIds: string[] = [];
  const missing: AssetRef[] = [];
  const unsupported: AssetRef[] = [];

  for (const ref of refs) {
    out += text.slice(cursor, ref.start);
    cursor = ref.end;

    const kind = lookup.kindOf(ref.assetId);
    if (kind === null) {
      missing.push(ref);
      out += ref.raw;
      continue;
    }
    if (kind === 'image' || kind === 'video') {
      if (!imageAssetIds.includes(ref.assetId)) imageAssetIds.push(ref.assetId);
      continue;
    }
    if (kind !== 'text') {
      // 音频之类：资产在，但这种生成流程带不进去。保留原文，交给上层说清楚。
      unsupported.push(ref);
      out += ref.raw;
      continue;
    }
    // 文本资产：内联内容。读不到内容也算缺失——引用了一个空壳比报错更糟。
    const body = lookup.textOf?.(ref.assetId) ?? null;
    if (body === null) {
      missing.push(ref);
      out += ref.raw;
      continue;
    }
    out += body;
  }
  out += text.slice(cursor);

  return { text: tidyAfterRemoval(out), imageAssetIds, missing, unsupported };
}

/**
 * 剥离 token 后收拾空白。
 *
 * 只在**确实剥离过**时才调用，所以不用担心误伤普通提示词。规则故意保守：
 * 折叠行内连续空格、去掉行尾空格、把 3 个以上连续换行收到 2 个。
 * 不做「整段重排」，用户的分行是有意义的。
 */
function tidyAfterRemoval(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export type PromptSegment = { type: 'text'; text: string } | { type: 'ref'; ref: AssetRef };

/** 把提示词切成「普通文字 / 引用」两种段落，供卡片和审计台账渲染 chip。 */
export function splitPromptSegments(text: string): PromptSegment[] {
  const refs = parseAssetRefs(text);
  if (refs.length === 0) return text === '' ? [] : [{ type: 'text', text }];

  const out: PromptSegment[] = [];
  let cursor = 0;
  for (const ref of refs) {
    if (ref.start > cursor) out.push({ type: 'text', text: text.slice(cursor, ref.start) });
    out.push({ type: 'ref', ref });
    cursor = ref.end;
  }
  if (cursor < text.length) out.push({ type: 'text', text: text.slice(cursor) });
  return out;
}

/**
 * 光标前是不是刚敲了一个 `@`，该弹资产面板。
 *
 * 条件收得比「只要前面有 @」严：`@` 必须在开头或紧跟空白，且到光标之间
 * 不能再有空白——否则写邮箱 `a@b.com`、或写「用 @ 符号」这种句子时，
 * 面板会在地铁上反复弹出来打断人。
 */
export function assetQueryAt(text: string, caret: number): string | null {
  const head = text.slice(0, Math.max(0, Math.min(caret, text.length)));
  const at = head.lastIndexOf('@');
  if (at < 0) return null;
  const before = at === 0 ? '' : head[at - 1]!;
  if (before !== '' && !/\s/.test(before)) return null;
  const query = head.slice(at + 1);
  if (/[\s\n]/.test(query)) return null;
  // 已经在 token 里了：`@[名字](asset:xxx)` 中间不该再弹面板
  if (query.startsWith('[') || query.includes('](') || query.includes(')')) return null;
  return query;
}

/** 在光标处插入 token，返回新文本与新光标位置。 */
export function insertAssetRef(
  text: string,
  caret: number,
  assetId: string,
  label: string,
): { text: string; caret: number } {
  const head = text.slice(0, caret);
  const at = head.lastIndexOf('@');
  // 把已经敲的 `@查询词` 一起替换掉，否则会留下 `@街@[xxx](asset:...)`
  const start = at >= 0 && assetQueryAt(text, caret) !== null ? at : caret;
  const token = assetRefToken(assetId, label);
  const next = `${text.slice(0, start)}${token}${text.slice(caret)}`;
  return { text: next, caret: start + token.length };
}
