/**
 * 「待核实任务」的判定：哪些单能查、走哪条协议查。
 *
 * 纯函数，不读 store、不发请求。红线：这里只决定「怎么查」，不提供任何
 * 「重发」入口——旧单拿任务号去厂商后台查，重新提交就是再扣一次钱。
 */
import { isModelScopeEndpoint } from '@/domain/provider/endpoints';
import type { Task } from '@/domain/task/model';

export interface RecoveryChannelView {
  name?: string;
  baseUrl: string;
  apiKey: string;
  /** 出网方式；缺省按 system（跟随全局本地代理开关）处理。 */
  proxyMode?: 'system' | 'direct';
}

/**
 * 能真正查单的 ModelScope 渠道：地址是官方端点、且配了 Key。
 * 社区网页域名和仿冒域名都不算——拿错地址去查只会得到 404。
 */
export function pickModelScopeChannel<T extends RecoveryChannelView>(channels: readonly T[]): T | null {
  return channels.find((channel) => channel.apiKey.trim().length > 0 && isModelScopeEndpoint(channel.baseUrl)) ?? null;
}

export type RecoveryAction = 'modelscope' | 'video' | 'manual';

/**
 * - `video`：视频单按视频协议查；
 * - `modelscope`：ModelScope 异步出图单，且当前配了可用的 ModelScope 渠道；
 * - `manual`：没有任务号，或查不了——只能复制任务号去厂商后台核对。
 */
export function recoveryAction(task: Task, modelscopeChannel: RecoveryChannelView | null): RecoveryAction {
  if (!task.upstreamRef) return 'manual';
  if (task.kind === 'video') {
    const provider = task.params.providerId;
    return provider === 'openai' || provider === 'gemini' || provider === 'plugin' || provider === 'runninghub' ? 'video' : 'manual';
  }
  if (task.kind === 'image' && task.params.extras?.endpoint === 'modelscope' && modelscopeChannel) return 'modelscope';
  return 'manual';
}
