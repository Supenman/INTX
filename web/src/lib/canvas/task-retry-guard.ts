import { GenerationTaskError } from "@/services/generation";

/**
 * 失败落到画布节点上时，先问这一单还允不允许直接重发。
 *
 * `readTaskOutcome()` 判成 `confirm`（上游可能已收单，或必须先改条件）的，
 * 画布不给「重试」入口——那张卡片点一下就是新提交一单、再扣一次钱。
 * 旧单只能去任务中心拿任务号到厂商后台核对。
 */
export function retryBlockedByError(error: unknown): boolean {
    return error instanceof GenerationTaskError && error.outcome?.regenerate === "confirm";
}
