/**
 * 提示词编辑的纯逻辑。
 *
 * 放大编辑器里既有「显示」也有「能不能改」的判断，两件事都容易写错：
 * 一是把上游连进来的文字当成可编辑内容（改了也没用，生成时会被上游覆盖，
 * 用户会以为「我改了它怎么不生效」）；二是字数统计把换行算进长度导致
 * 计数和自己数的对不上。所以把这两条抽出成纯函数，配单测钉住。
 */

export interface PromptEditorState {
  /** 编辑器里显示出来给用户看的那段文字（可能是上游的，也可能是自己的） */
  text: string;
  /** 这段文字是否来自上游连线。为 true 时编辑器只读——写了也不会被发出去。 */
  fromUpstream: boolean;
  /** 用户自己写在节点 params.prompt 里的内容，用于「断开上游后回退」提示 */
  ownText: string;
}

/**
 * 决定放大编辑器要显示什么、能不能改。
 *
 * 与 `resolvePrompt()` 保持同一套优先级（上游非空即覆盖本地），
 * 但**额外保留 ownText**：上游接上之后本地草稿不能让用户以为丢了，
 * 编辑器里要能看见「断开上游会回到这段」。
 */
export function promptEditorState(input: {
  upstreamText: string | null;
  ownPrompt: string;
}): PromptEditorState {
  const upstream = input.upstreamText?.trim() ?? '';
  const own = input.ownPrompt;
  if (upstream !== '') {
    return { text: upstream, fromUpstream: true, ownText: own };
  }
  return { text: own, fromUpstream: false, ownText: own };
}

/**
 * 提示词字数。
 *
 * 按「用户眼里的字」数：中文一个字算 1，连续换行折叠成 1 个，
 * 首尾空白不算。用 `[...text]` 而不是 `.length`，否则 emoji 和部分
 * 中文标点会被算成 2 个，用户照着数会对不上。
 */
export function promptLength(text: string): number {
  const normalized = text.trim().replace(/\n{2,}/g, '\n');
  return [...normalized].length;
}

/**
 * 提示词是不是「长得该用放大编辑器了」。
 *
 * 节点卡片里只放得下三行左右，超出就该提示用户点开。阈值取得保守：
 * 太早提示会变成噪音，太晚等于没提示。
 */
export const PROMPT_LONG_THRESHOLD = 80;

export function isLongPrompt(text: string): boolean {
  return promptLength(text) > PROMPT_LONG_THRESHOLD;
}
