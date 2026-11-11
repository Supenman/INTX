import { describe, expect, it } from 'vitest';
import { hashCandidatePaths, parentDir } from './tauriStores';
import { contentPath } from '@/domain';

/**
 * 这些用例锁的是一个真机才暴露的缺陷：桌面端把内容哈希直接当相对路径去 writeFile，
 * ensure() 里 `slice(0, lastIndexOf('/'))` 对不含 '/' 的哈希返回 slice(0,-1)，
 * 在 $APPDATA 根目录建出一个 63 字符的空目录，产物则写成无扩展名的 64 字符文件，
 * 与 asset.path（assets/ab/<hash>.png）完全对不上——超分读源图会失败。
 */
describe('parentDir', () => {
  it('正常路径取父目录', () => {
    expect(parentDir('assets/ab/abc.png')).toBe('assets/ab');
    expect(parentDir('assets/abc.png')).toBe('assets');
  });

  it('不含斜杠时返回 null，绝不返回砍掉末字符的结果', () => {
    const hash = 'd1ddc13def42cff87a338257c433f11abef522a80f6bc5d0dcc0538504cbf219';
    expect(parentDir(hash)).toBeNull();
    expect(parentDir('')).toBeNull();
    expect(parentDir('/abs')).toBeNull(); // 前导斜杠视为「无父目录」，不允许写到根
  });
});

describe('hashCandidatePaths', () => {
  it('第一条候选必须与 contentPath 完全一致，否则元数据和磁盘对不上', () => {
    const hash = 'a'.repeat(64);
    expect(hashCandidatePaths(hash)[0]).toBe(contentPath(hash, 'png'));
  });

  it('按哈希前两位分桶，避免单目录堆几万个文件', () => {
    const hash = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    for (const p of hashCandidatePaths(hash)) {
      expect(p.startsWith('assets/ba/')).toBe(true);
      expect(p).toContain(hash);
    }
  });

  it('覆盖图片、视频、音频与兜底 bin', () => {
    const list = hashCandidatePaths('c'.repeat(64));
    for (const ext of ['png', 'webp', 'mp4', 'mp3', 'bin']) {
      expect(list.some((p) => p.endsWith(`.${ext}`))).toBe(true);
    }
  });
});
