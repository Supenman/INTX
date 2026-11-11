import { describe, expect, it } from 'vitest';
import { formatTime } from './format';

/**
 * 锁住真机上暴露的缺陷：审计台账原用 toLocaleString()，在 WebKitGTK 的 en-US
 * locale 下输出 "11/11/2026, 3:22:32 PM"，被列宽裁成 "326, 3:22:32 PM"。
 * 固定格式后长度稳定在 16 字符，列宽可预测。
 */
describe('formatTime', () => {
  it('输出 YYYY-MM-DD HH:mm，24 小时制，不出现 AM/PM', () => {
    const ts = new Date(2026, 10, 11, 15, 22, 32).getTime();
    expect(formatTime(ts)).toBe('2026-11-11 15:22');
    expect(formatTime(ts)).not.toMatch(/AM|PM|\//);
  });

  it('长度固定 16 字符，保证列宽可预测', () => {
    const samples = [
      new Date(2026, 0, 1, 0, 0).getTime(),
      new Date(2026, 11, 31, 23, 59).getTime(),
      new Date(2025, 5, 7, 9, 5).getTime(),
    ];
    for (const ts of samples) expect(formatTime(ts)).toHaveLength(16);
  });

  it('个位数月/日/时/分都补零', () => {
    expect(formatTime(new Date(2026, 2, 5, 7, 8).getTime())).toBe('2026-03-05 07:08');
  });
});
