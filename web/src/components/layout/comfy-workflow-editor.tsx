import { Alert, Button, Checkbox, Drawer, Input, InputNumber, Select, Tag } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { fetchWorkflowDetail, updateGatewayWorkflow, type WorkflowBinding, type WorkflowDetail, type WorkflowNode } from "@/services/api/comfyui-gateway";

/** 可新增的绑定字段：值来源的语义 key（含视频类与参考素材数组）。 */
const BINDING_KEYS = [
    "prompt", "negative", "width", "height", "batch", "seed", "steps", "cfg", "sampler", "scheduler", "image", "image2", "denoise",
    "length", "fps", "transition_step", "lowres_scale", "rho", "w_min", "w_max", "refs", "videos", "audios",
] as const;

/** 编辑工作流的参数绑定（把画布输入映射到 ComfyUI 节点）。 */
export function ComfyWorkflowEditor({ id, open, onClose, onSaved }: { id: string | null; open: boolean; onClose: () => void; onSaved: () => void }) {
    const { t } = useTranslation();
    const [detail, setDetail] = useState<WorkflowDetail | null>(null);
    const [nodes, setNodes] = useState<WorkflowNode[]>([]);
    const [bindings, setBindings] = useState<Record<string, WorkflowBinding>>({});
    const [label, setLabel] = useState("");
    const [outputNodes, setOutputNodes] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [warnings, setWarnings] = useState<string[]>([]);

    useEffect(() => {
        if (!open || !id) return;
        setLoading(true);
        setError("");
        setWarnings([]);
        setDetail(null);
        fetchWorkflowDetail(id)
            .then(({ workflow, nodes: nodeList }) => {
                setDetail(workflow);
                setNodes(nodeList || []);
                setBindings(workflow.bindings || {});
                setLabel(workflow.label || workflow.name || "");
                setOutputNodes(workflow.outputNodes || []);
            })
            .catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)))
            .finally(() => setLoading(false));
    }, [open, id]);

    const nodeOptions = useMemo(
        () =>
            nodes.map((node) => ({
                value: node.id,
                label: node.title ? `${node.id} · ${node.title} (${node.classType})` : `${node.id} · ${node.classType}`,
            })),
        [nodes],
    );

    // 选中节点后，输入下拉只列该节点的实际输入，避免手填出错。
    const inputOptionsFor = (nodeId: string) => {
        const node = nodes.find((item) => item.id === nodeId);
        return (node?.inputs || []).map((input) => ({ value: input, label: input }));
    };

    const patchBinding = (key: string, patch: Partial<WorkflowBinding>) => {
        setBindings((current) => ({ ...current, [key]: { ...(current[key] || { node: "", input: "" }), ...patch } }));
    };

    const save = async () => {
        if (!id) return;
        setBusy(true);
        setError("");
        setWarnings([]);
        try {
            const result = await updateGatewayWorkflow(id, { label, bindings, outputNodes, inputContract: true });
            setWarnings(result.warnings || []);
            onSaved();
            onClose();
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : String(caught));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Drawer open={open} title={t("config.comfyWorkflow.editorTitle")} onClose={onClose} width={600} destroyOnClose>
            {loading && <p className="text-sm text-[var(--text-secondary)]">{t("config.comfyWorkflow.loading")}</p>}
            {error && <Alert type="error" showIcon message={error} />}

            {detail && (
                <div className="space-y-4">
                    <div className="space-y-1">
                        <label className="text-sm">{t("config.comfyWorkflow.nameLabel")}</label>
                        <Input value={label} onChange={(event) => setLabel(event.target.value)} />
                    </div>

                    <Alert type="info" showIcon message={t("config.comfyWorkflow.editorHint")} />
                    <p className="text-sm">自动识别仅提供建议。请确认输入位置与结果输出；未修改的参数沿用工作流原值。</p>
                    <div className="space-y-1">
                        <label className="text-sm">结果输出节点（保存图片或视频的节点）</label>
                        <Select className="w-full" value={outputNodes[0]} options={nodeOptions} placeholder="请选择结果输出节点" onChange={(value) => setOutputNodes([value])} />
                    </div>

                    <div className="space-y-3">
                        <div className="flex items-center justify-between gap-2">
                            <h4 className="text-sm font-medium">{t("config.comfyWorkflow.bindingsTitle")}</h4>
                            <Select
                                size="small"
                                className="w-44"
                                value={undefined}
                                placeholder={t("config.comfyWorkflow.addBinding")}
                                options={BINDING_KEYS.filter((key) => bindings[key] === undefined).map((key) => ({ value: key, label: key }))}
                                onSelect={(value) => patchBinding(String(value), { from: bindingSource(String(value)), ...(/^image2?$/.test(String(value)) ? { imageIndex: value === "image2" ? 1 : 0 } : {}) })}
                            />
                        </div>
                        {Object.keys(bindings).map((key) => {
                            const binding = bindings[key];
                            return (
                                <div key={key} className="space-y-1 rounded-lg border border-[var(--border-color)] p-3">
                                    <div className="flex items-center justify-between">
                                        <Tag color="blue">{key}</Tag>
                                        <Button
                                            type="link"
                                            size="small"
                                            danger
                                            onClick={() =>
                                                setBindings((current) => {
                                                    const next = { ...current };
                                                    delete next[key];
                                                    return next;
                                                })
                                            }
                                        >
                                            {t("common.delete")}
                                        </Button>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Input className="!w-44" aria-label="参数来源" value={binding.from || key} onChange={(event) => patchBinding(key, { from: event.target.value })} />
                                        <Select className="w-44" value={binding.transform || ""} onChange={(value) => patchBinding(key, { transform: value || undefined })} options={[
                                            { value: "", label: "原值" }, { value: "snap16", label: "尺寸对齐 16" }, { value: "snap32", label: "尺寸对齐 32" },
                                            { value: "secondsToFrames", label: "秒转帧（4n+1）" }, { value: "secondsToFrames17", label: "秒转帧（17n+5）" },
                                            { value: "int", label: "整数" }, { value: "float", label: "小数" },
                                        ]} />
                                        {binding.transform?.startsWith("secondsToFrames") && <InputNumber aria-label="换算帧率" placeholder="换算帧率" value={typeof binding.fps === "number" ? binding.fps : null} onChange={(fps) => patchBinding(key, { fps: fps ?? undefined })} />}
                                        {(binding.from === "image" || binding.imageIndex !== undefined) && !binding.array && <Checkbox checked={binding.asLink === true} onChange={(event) => patchBinding(key, { asLink: event.target.checked })}>图片节点连线</Checkbox>}
                                        <Checkbox checked={binding.required === true} onChange={(event) => patchBinding(key, { required: event.target.checked })}>必填</Checkbox>
                                    </div>
                                    <div className="flex gap-2">
                                        <Select
                                            className="flex-1"
                                            showSearch
                                            placeholder={t("config.comfyWorkflow.pickNode")}
                                            value={binding?.node || undefined}
                                            options={nodeOptions}
                                            onChange={(value) => patchBinding(key, { node: String(value), input: "" })}
                                        />
                                        {inputOptionsFor(String(binding?.node || "")).length > 0 ? (
                                            <Select
                                                className="flex-1"
                                                placeholder={t("config.comfyWorkflow.inputPlaceholder")}
                                                value={binding?.input || undefined}
                                                options={inputOptionsFor(String(binding?.node || ""))}
                                                onChange={(value) => patchBinding(key, { input: String(value) })}
                                            />
                                        ) : (
                                            <Input className="flex-1" placeholder={t("config.comfyWorkflow.inputPlaceholder")} value={binding?.input || ""} onChange={(event) => patchBinding(key, { input: event.target.value })} />
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {warnings.length > 0 && (
                        <Alert
                            type="warning"
                            showIcon
                            message={t("config.comfyWorkflow.validationTitle")}
                            description={
                                <ul className="list-disc pl-4">
                                    {warnings.map((warning, index) => (
                                        <li key={index}>{warning}</li>
                                    ))}
                                </ul>
                            }
                        />
                    )}

                    <div className="flex justify-end gap-2">
                        <Button onClick={onClose}>{t("common.cancel")}</Button>
                        <Button type="primary" loading={busy} disabled={!outputNodes.length} onClick={() => void save()}>
                            确认并用于画布
                        </Button>
                    </div>
                </div>
            )}
        </Drawer>
    );
}

function bindingSource(key: string) {
    return ({ width: "size.width", height: "size.height", batch: "count", length: "seconds", image2: "image", refs: "image", videos: "video", audios: "audio" } as Record<string, string>)[key] || (["prompt", "negative", "image"].includes(key) ? key : `params.${key}`);
}
