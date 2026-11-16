import { describe, expect, it } from "vitest";

import type { ErrorCode, Task } from "@/domain/task/model";
import { readTaskOutcome } from "@/domain/task/outcome";
import { GenerationTaskError } from "@/services/generation";

import { retryBlockedByError } from "./task-retry-guard";

/** 三态推导只看这几个字段，其余与判定无关。 */
function failedTask(code: ErrorCode, upstreamRef: string | null = null) {
    return { id: "task-1", status: "failed", error: { code, message: "" }, upstreamRef } as unknown as Task;
}

function errorFor(task: Task) {
    return new GenerationTaskError({
        message: task.error?.message ?? "",
        task,
        outcome: readTaskOutcome(task),
        code: task.error?.code ?? "unknown",
    });
}

describe("retryBlockedByError", () => {
    it("提交不确定：可能已收单，画布不给重试", () => {
        expect(retryBlockedByError(errorFor(failedTask("submission_uncertain")))).toBe(true);
    });

    it("本地保存失败：图已出、钱已扣，重试等于再买一张", () => {
        expect(retryBlockedByError(errorFor(failedTask("local_save_failed")))).toBe(true);
    });

    it("有任务号却没拿到产物：先去厂商后台查，别直接再买", () => {
        expect(retryBlockedByError(errorFor(failedTask("timeout", "upstream-1")))).toBe(true);
    });

    it("限流 / 5xx 这类没被收单的失败照常可以重试", () => {
        expect(retryBlockedByError(errorFor(failedTask("rate_limited")))).toBe(false);
        expect(retryBlockedByError(errorFor(failedTask("upstream_5xx")))).toBe(false);
    });

    it("不是任务错误（如上传失败的普通 Error）不拦重试", () => {
        expect(retryBlockedByError(new Error("upload failed"))).toBe(false);
        expect(retryBlockedByError(null)).toBe(false);
    });
});
