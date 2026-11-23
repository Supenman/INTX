import { Alert, Button, Input, Modal, Select, Space, Upload } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { importGatewayWorkflow, ProviderTransportError, type WorkflowWriteResult } from "@/services/api/comfyui-gateway";

type WorkflowKind = "image" | "video" | "audio" | "";

/** 导入用户自己的 ComfyUI API 格式工作流。 */
export function ComfyWorkflowImport({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: (id: string) => void }) {
    const { t } = useTranslation();
    const [name, setName] = useState("");
    const [kind, setKind] = useState<WorkflowKind>("");
    const [json, setJson] = useState<unknown>(null);
    const [fileName, setFileName] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [result, setResult] = useState<WorkflowWriteResult | null>(null);

    const reset = useCallback(() => {
        setName("");
        setKind("");
        setJson(null);
        setFileName("");
        setError("");
        setResult(null);
    }, []);

    const readFile = useCallback(
        async (file: File) => {
            setError("");
            setResult(null);
            setFileName(file.name);
            if (!name) setName(file.name.replace(/\.json$/i, ""));
            try {
                const text = await file.text();
                const parsed = JSON.parse(text) as unknown;
                setJson(parsed);
                // UI 格式（有 nodes/links 数组）不能直接用，提前拦截给明确提示。
                const record = parsed as Record<string, unknown>;
                if (Array.isArray(record?.nodes) && Array.isArray(record?.links)) {
                    setError(t("config.comfyWorkflow.uiFormatError"));
                    setJson(null);
                }
            } catch {
                setError(t("config.comfyWorkflow.invalidJson"));
                setJson(null);
            }
            return false;
        },
        [name, t],
    );

    const submit = useCallback(async () => {
        if (!json) {
            setError(t("config.comfyWorkflow.needFile"));
            return;
        }
        setBusy(true);
        setError("");
        setResult(null);
        try {
            const response = await importGatewayWorkflow({ json, name: name.trim() || fileName.replace(/\.json$/i, ""), type: kind });
            setResult(response);
            if (response.workflow) onImported(response.workflow.id);
        } catch (caught) {
            if (caught instanceof ProviderTransportError) {
                const detail = caught.status ? ` (${caught.status})` : caught.message ? ` (${caught.message})` : "";
                setError(`${t("config.comfyWorkflow.importFailed")}${detail}`);
            } else {
                setError(caught instanceof Error ? caught.message : String(caught));
            }
        } finally {
            setBusy(false);
        }
    }, [json, name, fileName, kind, onImported, t]);

    const warnings = result?.warnings || [];

    return (
        <Modal
            open={open}
            title={t("config.comfyWorkflow.importTitle")}
            onCancel={() => {
                reset();
                onClose();
            }}
            footer={null}
            destroyOnClose
            width={560}
        >
            <div className="space-y-4 py-2">
                <p className="text-sm text-[var(--text-secondary)]">{t("config.comfyWorkflow.importDescription")}</p>

                <div className="space-y-1">
                    <label className="text-sm">{t("config.comfyWorkflow.nameLabel")}</label>
                    <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("config.comfyWorkflow.namePlaceholder")} />
                </div>

                <div className="space-y-1">
                    <label className="text-sm">{t("config.comfyWorkflow.typeLabel")}</label>
                    <Select<WorkflowKind>
                        value={kind}
                        onChange={setKind}
                        className="w-full"
                        options={[
                            { value: "", label: t("config.comfyWorkflow.typeAuto") },
                            { value: "image", label: t("config.comfyWorkflow.typeImage") },
                            { value: "video", label: t("config.comfyWorkflow.typeVideo") },
                            { value: "audio", label: t("config.comfyWorkflow.typeAudio") },
                        ]}
                    />
                </div>

                <div className="space-y-1">
                    <label className="text-sm">{t("config.comfyWorkflow.fileLabel")}</label>
                    <Upload accept=".json" beforeUpload={readFile} maxCount={1} showUploadList={false}>
                        <Button icon={<UploadOutlined />}>{fileName || t("config.comfyWorkflow.filePlaceholder")}</Button>
                    </Upload>
                    {json !== null && <p className="text-xs text-[var(--text-success)]">{t("config.comfyWorkflow.fileReady")}</p>}
                </div>

                {error && <Alert type="error" showIcon message={error} />}

                {result?.workflow && (
                    <Alert
                        type={warnings.length ? "warning" : "success"}
                        showIcon
                        message={t("config.comfyWorkflow.importSuccess", { name: result.workflow.label || result.workflow.name })}
                        description={
                            warnings.length ? (
                                <ul className="list-disc pl-4">
                                    {warnings.map((warning, index) => (
                                        <li key={index}>{warning}</li>
                                    ))}
                                </ul>
                            ) : undefined
                        }
                    />
                )}

                <div className="flex justify-end gap-2 pt-2">
                    <Button
                        onClick={() => {
                            reset();
                            onClose();
                        }}
                    >
                        {t("common.cancel")}
                    </Button>
                    <Button type="primary" loading={busy} disabled={!json} onClick={() => void submit()}>
                        {t("config.comfyWorkflow.importButton")}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
