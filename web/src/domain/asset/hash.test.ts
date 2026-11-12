import { describe, expect, it } from 'vitest';
import { contentPath, extFromMime, sha256Hex } from './hash';

/**
 * 哈希是去重的地基：算错一个字节，同一张图就会存成两份；
 * 碰撞一次，用户就会看到"图变成了别的图"。
 */

function bytes(s: string): ArrayBuffer {
  const enc = new TextEncoder().encode(s);
  return enc.buffer.slice(enc.byteOffset, enc.byteOffset + enc.byteLength) as ArrayBuffer;
}

describe('内容哈希', () => {
  it('同样的内容得到同样的哈希', async () => {
    const a = await sha256Hex(bytes('hello'));
    const b = await sha256Hex(bytes('hello'));
    expect(a).toBe(b);
  });

  it('差一个字节哈希就完全不同', async () => {
    const a = await sha256Hex(bytes('hello'));
    const b = await sha256Hex(bytes('hellp'));
    expect(a).not.toBe(b);
  });

  it('输出是标准 SHA-256（对照已知值）', async () => {
    // "abc" 的 SHA-256，公开标准值
    expect(await sha256Hex(bytes('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('路径按哈希前两位分目录', () => {
    const hash = 'ab' + 'c'.repeat(62);
    expect(contentPath(hash, 'png')).toBe(`assets/ab/${hash}.png`);
  });

  it('扩展名带点或大写都能归一', () => {
    expect(contentPath('x'.repeat(64), '.PNG')).toBe(`assets/xx/${'x'.repeat(64)}.png`);
  });
});

describe('mime → 扩展名', () => {
  it('常见图片类型', () => {
    expect(extFromMime('image/png')).toBe('png');
    expect(extFromMime('image/jpeg')).toBe('jpg');
    expect(extFromMime('image/webp')).toBe('webp');
  });

  it('带 charset 也能取到主类型', () => {
    expect(extFromMime('text/plain; charset=utf-8')).toBe('txt');
  });

  it('不认识的类型给 bin，不瞎猜', () => {
    expect(extFromMime('application/x-weird')).toBe('bin');
  });
});
