import { describe, expect, it } from 'vitest';
import { MAX_NODE_TITLE, expandBatchTitle, nodeTitle, sanitizeNodeTitle } from './title';

describe('sanitizeNodeTitle', () => {
  it('去掉首尾空白', () => {
    expect(sanitizeNodeTitle('  封面  ')).toBe('封面');
  });

  it('换行压成空格，卡片是单行的', () => {
    expect(sanitizeNodeTitle('第一行\n第二行')).toBe('第一行 第二行');
  });

  it('保留中文标点——「女主：侧脸」是正常写法', () => {
    expect(sanitizeNodeTitle('女主：侧脸')).toBe('女主：侧脸');
  });

  it('按码点截断，不切坏 emoji', () => {
    const out = sanitizeNodeTitle('🎨'.repeat(100));
    expect([...out]).toHaveLength(MAX_NODE_TITLE);
    expect(out).not.toContain('\ufffd');
  });

  it('空串就是空串，由调用方决定回退', () => {
    expect(sanitizeNodeTitle('   ')).toBe('');
  });
});

describe('nodeTitle', () => {
  it('有自定义名就用自定义名', () => {
    expect(nodeTitle({ title: '封面' }, '图片生成')).toBe('封面');
  });

  it('没起名回退到类型名', () => {
    expect(nodeTitle({}, '图片生成')).toBe('图片生成');
    expect(nodeTitle(undefined, '图片生成')).toBe('图片生成');
  });

  it('只有空白也算没起名', () => {
    expect(nodeTitle({ title: '   ' }, '图片生成')).toBe('图片生成');
  });
});

describe('expandBatchTitle', () => {
  it('# 替换成补零序号，宽度按总数定', () => {
    expect(expandBatchTitle('主图 #', 1, 10)).toBe('主图 01');
    expect(expandBatchTitle('主图 #', 10, 10)).toBe('主图 10');
    expect(expandBatchTitle('主图 #', 1, 100)).toBe('主图 001');
  });

  it('没有 # 就自动补序号，否则十个节点同名等于没改', () => {
    expect(expandBatchTitle('主图', 2, 4)).toBe('主图 02');
  });

  it('模板为空时只留序号，不产生空白名', () => {
    expect(expandBatchTitle('   ', 3, 5)).toBe('03');
  });

  it('多个 # 都替换成同一个序号', () => {
    expect(expandBatchTitle('图#-#', 2, 3)).toBe('图02-02');
  });

  it('序号不合法时退回 1', () => {
    expect(expandBatchTitle('主图 #', 0, 3)).toBe('主图 01');
    expect(expandBatchTitle('主图 #', NaN, 3)).toBe('主图 01');
  });
});
