import { describe, expect, it } from 'vitest';
import {
  applyAssetRefs,
  assetQueryAt,
  assetRefToken,
  insertAssetRef,
  parseAssetRefs,
  splitPromptSegments,
  type AssetRefLookup,
} from './ref';

const lookup = (map: Record<string, 'image' | 'video' | 'text' | 'audio'>, texts: Record<string, string> = {}): AssetRefLookup => ({
  kindOf: (id) => map[id] ?? null,
  textOf: (id) => texts[id] ?? null,
});

describe('parseAssetRefs', () => {
  it('取出 id 与位置，不用名字做匹配', () => {
    const text = '照 @[雾夜街头](asset:as_1) 的质感来一张';
    const refs = parseAssetRefs(text);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ assetId: 'as_1', label: '雾夜街头', start: 2 });
    expect(text.slice(refs[0]!.start, refs[0]!.end)).toBe('@[雾夜街头](asset:as_1)');
  });

  it('同一段里多个引用按出现顺序返回', () => {
    const refs = parseAssetRefs('@[A](asset:as_1) 和 @[B](asset:as_2)');
    expect(refs.map((r) => r.assetId)).toEqual(['as_1', 'as_2']);
  });

  it('普通 @ 文字、坏掉的 token 都不算引用', () => {
    expect(parseAssetRefs('用 @ 符号说一句 hello@example.com')).toEqual([]);
    expect(parseAssetRefs('@[没有 id](asset:)')).toEqual([]);
    expect(parseAssetRefs('@[换行\n在里面](asset:as_1)')).toEqual([]);
  });
});

describe('assetRefToken', () => {
  it('名字里的方括号和换行会被剔掉，否则语法自毁', () => {
    expect(assetRefToken('as_1', '图]片\n名')).toBe('@[图 片 名](asset:as_1)');
  });

  it('空名字回退到 id 前缀，不留空壳 label', () => {
    expect(assetRefToken('as_abcdef12', '  ')).toBe('@[as_abcde](asset:as_abcdef12)');
  });
});

describe('applyAssetRefs', () => {
  it('不含引用时原样返回，一个空白都不改', () => {
    const text = '第一行  \n\n\n第三行   有空格';
    expect(applyAssetRefs(text, [], lookup({})).text).toBe(text);
  });

  it('图片引用从文本里剥掉，并作为参考图收集', () => {
    const text = '照 @[雾夜街头](asset:as_img) 的感觉';
    const refs = parseAssetRefs(text);
    const out = applyAssetRefs(text, refs, lookup({ as_img: 'image' }));
    expect(out.text).toBe('照 的感觉');
    expect(out.imageAssetIds).toEqual(['as_img']);
    expect(out.missing).toEqual([]);
  });

  it('同一张图被引用两次只作为一次参考图，但文本里两处都剥掉', () => {
    const text = '@[A](asset:as_img) 与 @[A](asset:as_img)';
    const out = applyAssetRefs(text, parseAssetRefs(text), lookup({ as_img: 'image' }));
    expect(out.imageAssetIds).toEqual(['as_img']);
    expect(out.text).toBe('与');
  });

  it('文本资产把内容内联进提示词', () => {
    const text = '风格：@[旁白稿](asset:as_txt) 完';
    const out = applyAssetRefs(
      text,
      parseAssetRefs(text),
      lookup({ as_txt: 'text' }, { as_txt: '冷静、克制、留白' }),
    );
    expect(out.text).toBe('风格：冷静、克制、留白 完');
    expect(out.imageAssetIds).toEqual([]);
  });

  it('引用已删除的资产：保留原文并报进 missing，绝不静默丢掉', () => {
    const text = '用 @[旧图](asset:as_gone) 做参考';
    const out = applyAssetRefs(text, parseAssetRefs(text), lookup({}));
    expect(out.missing).toHaveLength(1);
    expect(out.missing[0]!.assetId).toBe('as_gone');
    expect(out.text).toContain('@[旧图](asset:as_gone)');
    expect(out.imageAssetIds).toEqual([]);
  });

  it('文本资产读不到内容也算缺失，不能当成空字符串悄悄拼进去', () => {
    const text = '前 @[空稿](asset:as_txt) 后';
    const out = applyAssetRefs(text, parseAssetRefs(text), lookup({ as_txt: 'text' }));
    expect(out.missing.map((m) => m.assetId)).toEqual(['as_txt']);
    expect(out.text).toContain('@[空稿](asset:as_txt)');
  });

  it('音频资产单独归到 unsupported：存在但带不进去，不能说成「不存在」', () => {
    const text = '配 @[环境音](asset:as_aud) 一起';
    const out = applyAssetRefs(text, parseAssetRefs(text), lookup({ as_aud: 'audio' }));
    expect(out.unsupported.map((m) => m.assetId)).toEqual(['as_aud']);
    expect(out.missing).toEqual([]);
    expect(out.text).toContain('@[环境音](asset:as_aud)');
  });

  it('剥离后不留下成排空格和空行', () => {
    const text = '第一句\n@[图](asset:as_img)\n第二句';
    const out = applyAssetRefs(text, parseAssetRefs(text), lookup({ as_img: 'image' }));
    expect(out.text).toBe('第一句\n\n第二句');
    expect(out.text).not.toMatch(/ {2,}/);
  });
});

describe('assetQueryAt', () => {
  it('行首或空白后的 @ 才触发', () => {
    expect(assetQueryAt('@', 1)).toBe('');
    expect(assetQueryAt('画一张 @雾', 6)).toBe('雾');
  });

  it('邮箱和句中 @ 不触发，否则写正文时面板乱弹', () => {
    expect(assetQueryAt('hello@example.com', 9)).toBeNull();
    expect(assetQueryAt('用 @ 符号', 5)).toBeNull();
  });

  it('光标跑到查询词后面（有空白）就不该继续弹', () => {
    expect(assetQueryAt('@雾夜 街头', 6)).toBeNull();
  });

  it('已经在 token 内部时不再触发', () => {
    expect(assetQueryAt('@[雾夜](asset:as_1)', 18)).toBeNull();
  });
});

describe('insertAssetRef', () => {
  it('把已敲的查询词一起替换，不留 `@街@[xxx]`', () => {
    const r = insertAssetRef('画 @雾', 4, 'as_1', '雾夜');
    expect(r.text).toBe('画 @[雾夜](asset:as_1)');
    expect(r.caret).toBe(r.text.length);
  });

  it('没有 @ 时按光标位置直接插入', () => {
    const r = insertAssetRef('前后', 1, 'as_1', '图');
    expect(r.text).toBe('前@[图](asset:as_1)后');
    expect(r.caret).toBe(1 + '@[图](asset:as_1)'.length);
  });
});

describe('splitPromptSegments', () => {
  it('正文与引用交替切分，空文本返回空数组', () => {
    const segs = splitPromptSegments('照 @[A](asset:as_1) 来');
    expect(segs.map((s) => s.type)).toEqual(['text', 'ref', 'text']);
    expect(splitPromptSegments('')).toEqual([]);
  });

  it('没有引用时整段就是一段文字', () => {
    expect(splitPromptSegments('普通提示词')).toEqual([{ type: 'text', text: '普通提示词' }]);
  });
});
