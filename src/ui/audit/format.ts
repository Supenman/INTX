/**
 * 审计台账的时间格式。
 *
 * 不用 toLocaleString()：它跟系统 locale 走。WebKitGTK（Linux 桌面壳）默认 en-US，
 * 会输出 "11/11/2026, 3:22:32 PM"——又长又是 12 小时制；十列挤在同一张表里，
 * 开头的日期直接被裁掉，真机截图里只剩 "326, 3:22:32 PM"。
 * 自己拼 YYYY-MM-DD HH:mm，三端输出一致，长度也可预测。
 */
export function formatTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
