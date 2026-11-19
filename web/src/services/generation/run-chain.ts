import { chainStepDisposition } from "@/domain/node/chain";
import type { GenerationParams } from "@/domain/task/model";
import { commit, type LoggedTask, type TaskLog } from "./taskLog";

export interface ChainRunStep {
    nodeId: string;
    params: GenerationParams;
}

/** Journal a step before submission. Any uncertain failure stops the entire chain. */
export async function runChainSteps<T extends ChainRunStep>(options: {
    steps: readonly T[];
    log: TaskLog;
    check: (step: T) => void;
    prepare: (step: T) => Promise<() => Promise<void>>;
    onProgress?: (completed: number) => void;
}) {
    const { steps, log, check, prepare, onProgress } = options;
    let completed = 0;
    for (const step of steps) {
        try {
            check(step);
            const last = (await log.list()).filter((task) => task.nodeId === step.nodeId)
                .reduce<LoggedTask | undefined>(
                    (latest, task) => !latest || task.createdAt > latest.createdAt ? task : latest, undefined,
                );
            if (chainStepDisposition(false, last) !== "generate") throw new Error("The existing task must be resolved first");
            const generateAndSave = await prepare(step);
            check(step);
            let task = await log.create({ kind: step.params.kind, params: step.params, nodeId: step.nodeId });
            task = await commit(log, task, "running", { phase: "submitting" });
            try {
                check(step);
            } catch (error) {
                await commit(log, task, "canceled");
                throw error;
            }
            try {
                await generateAndSave();
            } catch (error) {
                await commit(log, task, "failed", { error: {
                    code: "submission_uncertain",
                    message: error instanceof Error ? error.message : String(error),
                } });
                throw error;
            }
            await commit(log, task, "succeeded");
            completed += 1;
            onProgress?.(completed);
        } catch (error) {
            return { ok: false as const, completed, nodeId: step.nodeId, error };
        }
    }
    return { ok: true as const, completed };
}
