/**
 * 内容哈希 —— 资产去重的基础。
 *
 * 旧代码把生成结果以 URL 字符串塞进节点，同一张图被两个节点引用就存两份，
 * 换个引用就重新下载一遍。这里按内容寻址：同样的字节只落一个文件。
 *
 * 用 SHA-256 而不是简单的长度+时间戳，因为后者在批量生成同尺寸图时
 * 碰撞概率高得离谱——旧代码就有这个问题，导致偶发"图变成了别的图"。
 */

/** Node fallback 的最小形状。自己声明而不是 `typeof import('node:crypto')`，避免 lint 规则报错。 */
interface HasherLike {
  update(data: Uint8Array): HasherLike;
  digest(encoding: 'hex'): string;
}
interface NodeCryptoLike {
  createHash(algorithm: string): HasherLike;
}

/** 纯字节的十六进制哈希。浏览器用 WebCrypto，Node 用 node:crypto。 */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest('SHA-256', bytes);
    return toHex(new Uint8Array(digest));
  }
  // 测试环境（node 且未注入 webcrypto）才会走到这里。模块名用变量 +
  // @vite-ignore，避免打包器把 node:crypto 打进浏览器产物并刷一条警告。
  const name = 'node:crypto';
  const mod = (await import(/* @vite-ignore */ name)) as NodeCryptoLike;
  return mod.createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/**
 * 内容寻址的相对路径：`assets/<前两位>/<hash>.<ext>`。
 *
 * 分两级目录是为了以后资产上千时不至于一个目录里塞几千个文件；
 * 前两位取哈希前缀，天然均匀分布。
 */
export function contentPath(hash: string, ext: string): string {
  const safeExt = ext.replace(/^\./, '').toLowerCase() || 'bin';
  return `assets/${hash.slice(0, 2)}/${hash}.${safeExt}`;
}

/** 从 mime 推断落盘扩展名。不认识就返回 bin，宁可难看也不猜错。 */
const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'application/json': 'json',
};

export function extFromMime(mime: string): string {
  return MIME_EXT[mime.toLowerCase().split(';')[0]!.trim()] ?? 'bin';
}
