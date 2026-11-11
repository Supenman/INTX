import { describe, expect, it } from 'vitest';
import {
  isLongPrompt,
  promptEditorState,
  promptLength,
  PROMPT_LONG_THRESHOLD,
} from './prompt';

describe('promptEditorState', () => {
  it('上游有内容时显示上游、并且只读', () => {
    const s = promptEditorState({ upstreamText: '  雨夜霓虹街口  ', ownPrompt: '自己的草稿' });
    expect(s.text).toBe('雨夜霓虹街口');
    expect(s.fromUpstream).toBe(true);
    // 本地草稿不能"消失"：断开上游后要能回到这段
    expect(s.ownText).toBe('自己的草稿');
  });

  it('上游是空白串时退回本地内容，且可编辑', () => {
    const s = promptEditorState({ upstreamText: '   \n ', ownPrompt: '本地写的' });
    expect(s.text).toBe('本地写的');
    expect(s.fromUpstream).toBe(false);
  });

  it('上游为 null（没连线）时用本地内容', () => {
    const s = promptEditorState({ upstreamText: null, ownPrompt: '本地' });
    expect(s.text).toBe('本地');
    expect(s.fromUpstream).toBe(false);
  });

  it('两边都空时给出空串而不是 undefined', () => {
    const s = promptEditorState({ upstreamText: null, ownPrompt: '' });
    expect(s.text).toBe('');
  });
});

describe('promptLength', () => {
  it('中文按字计，不受编码长度影响', () => {
    expect(promptLength('雨夜街口')).toBe(4);
  });

  it('emoji 算 1 个字（按码点而不是 UTF-16 长度）', () => {
    // '🎨'.length === 2，但用户眼里就是一个
    expect(promptLength('🎨')).toBe(1);
  });

  it('首尾空白不计入', () => {
    expect(promptLength('  街口  ')).toBe(2);
  });

  it('连续换行折叠成一个', () => {
    expect(promptLength('a\n\n\nb')).toBe(3);
  });

  it('空串与纯空白都是 0', () => {
    expect(promptLength('')).toBe(0);
    expect(promptLength(' \n\t ')).toBe(0);
  });
});

describe('isLongPrompt', () => {
  it('刚好等于阈值不算长', () => {
    expect(isLongPrompt('字'.repeat(PROMPT_LONG_THRESHOLD))).toBe(false);
  });

  it('超过阈值算长', () => {
    expect(isLongPrompt('字'.repeat(PROMPT_LONG_THRESHOLD + 1))).toBe(true);
  });

  it('空白不计入，不会因为贴了一堆空格就判长', () => {
    expect(isLongPrompt(`   ${'字'.repeat(10)}   `)).toBe(false);
  });
});
