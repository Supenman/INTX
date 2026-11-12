import { describe, expect, it } from 'vitest';
import { buildExportFileName, sanitizeFileNamePart, sortForExport } from './export';

describe('sanitizeFileNamePart', () => {
  it('把路径分隔符换成空格而不是删掉——删了就读不出来', () => {
    expect(sanitizeFileNamePart('a/b\\c')).toBe('a b c');
  });

  it('Windows 非法字符全部清掉', () => {
    expect(sanitizeFileNamePart('x:y*z?"<>|')).toBe('x y z');
  });

  it('开头的点去掉，避免变成隐藏文件', () => {
    expect(sanitizeFileNamePart('...hidden')).toBe('hidden');
  });

  it('结尾的点和空格去掉——Windows 会静默丢弃它们，留着必然对不上', () => {
    expect(sanitizeFileNamePart('草稿. ')).toBe('草稿');
    expect(sanitizeFileNamePart('草稿...')).toBe('草稿');
  });

  it('Windows 保留设备名加前缀，否则文件根本创建不出来', () => {
    expect(sanitizeFileNamePart('CON')).toBe('未命名_CON');
    expect(sanitizeFileNamePart('nul')).toBe('未命名_nul');
    expect(sanitizeFileNamePart('COM1')).toBe('未命名_COM1');
    // 不是保留名的相似词不能误伤
    expect(sanitizeFileNamePart('CONSOLE')).toBe('CONSOLE');
    expect(sanitizeFileNamePart('COM10')).toBe('COM10');
  });

  it('全空时给兜底名，不返回空串', () => {
    expect(sanitizeFileNamePart('   ')).toBe('未命名');
    expect(sanitizeFileNamePart('///')).toBe('未命名');
  });

  it('按码点截断，不把 emoji 切成半个', () => {
    const out = sanitizeFileNamePart('🎨'.repeat(100));
    expect([...out]).toHaveLength(80);
    // 没有替换字符说明代理对完整
    expect(out).not.toContain('\ufffd');
  });
});

describe('buildExportFileName', () => {
  it('补零宽度按总数算：10 张是 01..10，100 张是 001..100', () => {
    expect(buildExportFileName({ title: '封面', index: 1, total: 10, ext: 'png' })).toBe('01_封面.png');
    expect(buildExportFileName({ title: '封面', index: 10, total: 10, ext: 'png' })).toBe('10_封面.png');
    expect(buildExportFileName({ title: '封面', index: 1, total: 100, ext: 'png' })).toBe('001_封面.png');
  });

  it('至少两位，个位数批次也整齐', () => {
    expect(buildExportFileName({ title: 'a', index: 1, total: 3, ext: 'png' })).toBe('01_a.png');
  });

  it('标题自带同名扩展名时剥掉，不导出成 .png.png', () => {
    expect(buildExportFileName({ title: '封面.PNG', index: 1, total: 1, ext: 'png' })).toBe('01_封面.png');
  });

  it('扩展名带前导点也认', () => {
    expect(buildExportFileName({ title: 'a', index: 1, total: 1, ext: '.jpg' })).toBe('01_a.jpg');
  });

  it('没有扩展名时落 bin，不猜', () => {
    expect(buildExportFileName({ title: 'a', index: 1, total: 1, ext: '' })).toBe('01_a.bin');
  });

  it('序号非法时退回 1，不产生 00 或 NaN', () => {
    expect(buildExportFileName({ title: 'a', index: 0, total: 2, ext: 'png' })).toBe('01_a.png');
    expect(buildExportFileName({ title: 'a', index: NaN, total: 2, ext: 'png' })).toBe('01_a.png');
  });

  it('总数小于序号时按序号补宽，不出现宽度不足', () => {
    expect(buildExportFileName({ title: 'a', index: 12, total: 5, ext: 'png' })).toBe('12_a.png');
  });
});

describe('sortForExport', () => {
  it('按上到下、左到右，符合眼睛扫画布的顺序', () => {
    const items = [
      { id: 'd', ...{}, p: { x: 300, y: 200 } },
      { id: 'b', p: { x: 300, y: 10 } },
      { id: 'a', p: { x: 10, y: 10 } },
      { id: 'c', p: { x: 10, y: 200 } },
    ];
    const sorted = sortForExport(items, (i) => i.p);
    expect(sorted.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('同一行带内轻微的高低差不算换行', () => {
    const items = [
      { id: 'b', p: { x: 10, y: 20 } },
      { id: 'a', p: { x: 10, y: 0 } },
    ];
    // 20px 差在 48px 带内，按 x 排——两者 x 相同，靠 id 兜底
    expect(sortForExport(items, (i) => i.p).map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('坐标完全相同时按 id 排，保证两次导出顺序一致', () => {
    const items = [
      { id: 'z', p: { x: 5, y: 5 } },
      { id: 'm', p: { x: 5, y: 5 } },
      { id: 'a', p: { x: 5, y: 5 } },
    ];
    expect(sortForExport(items, (i) => i.p).map((i) => i.id)).toEqual(['a', 'm', 'z']);
  });

  it('不改入参', () => {
    const items = [
      { id: 'b', p: { x: 100, y: 0 } },
      { id: 'a', p: { x: 0, y: 0 } },
    ];
    sortForExport(items, (i) => i.p);
    expect(items.map((i) => i.id)).toEqual(['b', 'a']);
  });
});
