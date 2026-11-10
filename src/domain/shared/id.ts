/**
 * 轻量 id 生成器。
 *
 * 设计目标：
 * - 不依赖 crypto.randomUUID（Tauri WebView / 老 Safari 上不一定有）
 * - 时间前缀保证字典序约等于创建顺序，便于调试时按 id 排序
 * - 同一毫秒内用随机后缀避免碰撞
 *
 * 注意：这不是 ULID，不保证跨进程唯一性理论上限，但在单机单用户场景下足够。
 */
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

let counter = 0;

export function createId(prefix = ''): string {
  const time = Date.now().toString(36);
  counter = (counter + 1) % 1296; // 36^2
  const seq = counter.toString(36).padStart(2, '0');
  let rand = '';
  for (let i = 0; i < 6; i += 1) {
    rand += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
 return prefix ? `${prefix}_${time}${seq}${rand}` : `${time}${seq}${rand}`;
}

/** 仅用于测试：重置内部计数器，让 id 可预测。 */
export function __resetIdCounter(): void {
  counter = 0;
}
