import { modelWorkflowOf, type AiConfig } from "@/stores/use-config-store";

/** 只发送当前模型明确声明且用户修改过的参数，模型间的参数互不串用。 */
export function comfyWorkflowRequest(config: AiConfig, model = config.model) {
    const workflow = modelWorkflowOf(config, model);
    if (!workflow) return undefined;
    const values = config.workflowValues?.[model] || {};
    const fields = new Set(workflow.fields.filter((field) => !field.media && field.from !== "prompt").map((field) => field.key));
    return { workflow_values: Object.fromEntries(Object.entries(values).filter(([key]) => fields.has(key))) };
}

export const workflowFieldLabels: Record<string, string> = {
    prompt: "提示词", negative: "负面提示词", width: "宽度", height: "高度", seed: "种子", steps: "步数", cfg: "引导系数",
    sampler: "采样器", scheduler: "调度器", denoise: "降噪强度", length: "时长（秒）", fps: "帧率",
};
