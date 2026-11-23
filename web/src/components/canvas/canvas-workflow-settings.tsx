import { Button, Input, InputNumber, Popover, Select } from "antd";
import { Settings2 } from "lucide-react";
import { modelWorkflowOf, type AiConfig } from "@/stores/use-config-store";
import { workflowFieldLabels } from "@/lib/comfy-workflow";
import type { WorkflowValues, WorkflowValue } from "@/types/comfy-workflow";

export function CanvasWorkflowSettings({ config, onChange }: { config: AiConfig; onChange: (values: WorkflowValues) => void }) {
    const workflow = modelWorkflowOf(config, config.model);
    const values = config.workflowValues?.[config.model] || {};
    const fields = workflow?.fields.filter((field) => !field.media && field.from !== "prompt" && field.from !== "count") || [];
    const update = (key: string, value: WorkflowValue | null | undefined) => {
        const next = { ...values };
        if (value === null || value === undefined) delete next[key];
        else next[key] = value;
        onChange({ ...config.workflowValues, [config.model]: next });
    };
    return (
        <Popover trigger="click" placement="topLeft" content={
            <div data-canvas-no-zoom className="max-h-[50vh] w-64 space-y-3 overflow-y-auto" onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
                <p className="text-xs text-muted-foreground">留空沿用工作流原值。每次生成执行一次工作流。</p>
                {workflow?.fields.filter((field) => field.media).map((field) => <p key={field.key} className="text-xs text-muted-foreground">{field.media === "video" ? "视频" : field.media === "audio" ? "音频" : "图片"}输入 {field.imageIndex === undefined ? field.key : field.imageIndex + 1}：{field.required || field.min ? "必填，请连接参考素材" : field.array ? "可选，未连接时不使用该参考素材" : "可选，未连接时沿用工作流原输入"}</p>)}
                {fields.map((field) => (
                    <label key={field.key} className="block space-y-1 text-sm">
                        <span>{workflowFieldLabels[field.key] || field.key}</span>
                        {field.type === "number" ? (
                            <InputNumber className="!w-full" value={typeof values[field.key] === "number" ? values[field.key] as number : null} placeholder={field.default === undefined ? "工作流默认" : String(field.default)} onChange={(value) => update(field.key, value)} />
                        ) : field.type === "boolean" ? (
                            <Select className="w-full" allowClear placeholder="工作流默认" value={values[field.key] === undefined ? undefined : String(values[field.key])} options={[{ value: "true", label: "开启" }, { value: "false", label: "关闭" }]} onChange={(value) => update(field.key, value === undefined ? undefined : value === "true")} />
                        ) : (
                            <Input allowClear value={String(values[field.key] ?? "")} placeholder={field.default === undefined ? "工作流默认" : String(field.default)} onChange={(event) => update(field.key, event.target.value || undefined)} />
                        )}
                    </label>
                ))}
                {!fields.length && <p className="text-sm">此工作流使用原有参数。</p>}
            </div>
        }>
            <Button type="text" className="!h-9 !max-w-[170px] !rounded-full !bg-transparent !px-3" icon={<Settings2 className="size-3.5" />}><span className="truncate">工作流参数</span></Button>
        </Popover>
    );
}
