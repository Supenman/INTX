import type { AiConfig } from "@/stores/use-config-store";
import { comfyWorkflowRequest } from "@/lib/comfy-workflow";

export function imageEditFormData(config: AiConfig, fields: Record<string, string | number | undefined>, files: File[]) {
    const workflow = comfyWorkflowRequest(config);
    const body = new FormData();
    for (const [key, value] of Object.entries(fields)) {
        if (value === undefined || workflow && ["size", "quality", "background"].includes(key)) continue;
        body.set(key, String(value));
    }
    if (workflow) {
        body.set("n", "1");
        body.set("workflow_values", JSON.stringify(workflow.workflow_values));
    }
    files.forEach((file) => body.append(files.length > 1 ? "image[]" : "image", file));
    return body;
}
