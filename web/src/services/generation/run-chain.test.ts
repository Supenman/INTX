import { describe, expect, it, vi } from "vitest";
import { readTaskOutcome } from "@/domain/task/outcome";
import { createMemoryTaskLog } from "./taskLog";
import { runChainSteps, type ChainRunStep } from "./run-chain";

const steps: ChainRunStep[] = ["shot-1", "shot-2", "shot-3"].map((nodeId) => ({
    nodeId,
    params: { kind: "video", prompt: nodeId, model: "test", providerId: "test", inputAssetIds: [] },
}));

describe("runChainSteps", () => {
    it("journals each submission, preserves the first result, and stops at the first failure without resubmitting it", async () => {
        const log = createMemoryTaskLog();
        const saved: string[] = [];
        const submit = vi.fn(async (step: ChainRunStep) => {
            expect((await log.list()).find((task) => task.nodeId === step.nodeId)?.status).toBe("running");
            if (step.nodeId === "shot-2") throw new Error("Response lost after submission");
            saved.push(step.nodeId);
        });
        const options = { steps, log, check: () => {}, prepare: async (step: ChainRunStep) => () => submit(step) };
        expect(await runChainSteps(options)).toMatchObject({ ok: false, completed: 1, nodeId: "shot-2" });
        expect(saved).toEqual(["shot-1"]);
        const tasks = await log.list();
        expect(tasks).toHaveLength(2);
        expect(tasks.find((task) => task.nodeId === "shot-1")?.status).toBe("succeeded");
        expect(readTaskOutcome(tasks.find((task) => task.nodeId === "shot-2"))?.regenerate).toBe("confirm");
        expect(await runChainSteps({ ...options, steps: steps.slice(1) })).toMatchObject({ ok: false, completed: 0, nodeId: "shot-2" });
        expect(submit).toHaveBeenCalledTimes(2);
    });

    it("does not journal or submit when local input preparation fails", async () => {
        const log = createMemoryTaskLog();
        const result = await runChainSteps({
            steps, log, check: () => {}, prepare: async () => { throw new Error("Missing input"); },
        });
        expect(result).toMatchObject({ ok: false, completed: 0, nodeId: "shot-1" });
        expect(await log.list()).toEqual([]);
    });
});
