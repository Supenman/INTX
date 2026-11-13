/**
 * 端点识别：纯字符串规则，零 IO。
 *
 * 放在 domain 是因为「这个 baseUrl 属于哪种协议」是业务事实，设置面板、
 * 请求构建和恢复逻辑都必须读同一份判定，不能各写一遍正则。
 */

/** ModelScope 官方 API-Inference 域名。前缀必须是 api-inference，社区网页域名不算。 */
export function isModelScopeEndpoint(baseUrl: string): boolean {
  let host = '';
  try {
    host = new URL(baseUrl.trim()).hostname.toLowerCase();
  } catch {
    return false;
  }
  return /^api-inference\.modelscope\.(cn|ai)$/.test(host);
}
