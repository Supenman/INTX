import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Tag } from "antd";
import { useTranslation } from "react-i18next";

import { useConfigStore, type ModelCapability } from "@/stores/use-config-store";
import {
    fetchGatewayHealth,
    fetchGatewayModels,
    fetchSetupStatus,
    fetchWorkflows,
    ProviderTransportError,
    rescanGateway,
    type GatewayHealth,
    type GatewaySetupStatus,
    type GatewayWorkflow,
} from "@/services/api/comfyui-gateway";

/** 网关 type（image/video/…）到画布能力的映射，未知按 image 兜底。 */
function toCapability(type: string | undefined): ModelCapability {
    if (type === "video") return "video";
    if (type === "text") return "text";
    if (type === "audio") return "audio";
    return "image";
}

/** 把网关扫描结果规整成设置页要显示的工作流列表。 */
function workflowRows(workflows: GatewayWorkflow[]): GatewayWorkflow[] {
    return workflows.filter((workflow) => workflow.enabled !== false);
}

/** 从工作流 / availability 中挑出要展示的缺失描述（最多几条，避免刷屏）。 */
function problemLines(workflow: GatewayWorkflow): string[] {
    const problems = workflow.availability?.problems || [];
    return problems.map((problem) => problem.message).filter(Boolean).slice(0, 3);
}

type ViewPhase = "loading" | "gatewayDown" | "comfyDown" | "scanning" | "readyEmpty" | "ready";

export function ConfigComfyUI() {
    const { t } = useTranslation();
    const syncLocalComfyChannel = useConfigStore((state) => state.syncLocalComfyChannel);

    const [phase, setPhase] = useState<ViewPhase>("loading");
    const [health, setHealth] = useState<GatewayHealth | null>(null);
    const [setup, setSetup] = useState<GatewaySetupStatus | null>(null);
    const [workflows, setWorkflows] = useState<GatewayWorkflow[]>([]);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [lastSyncedCount, setLastSyncedCount] = useState<number | null>(null);
    const pollTimer = useRef<number | null>(null);
    const pollCount = useRef(0);

    const load = useCallback(
        async (options?: { rescan?: boolean }) => {
            setBusy(true);
            setError("");
            try {
                if (options?.rescan) await rescanGateway();
                const [healthResult, statusResult, workflowList] = await Promise.all([fetchGatewayHealth(), fetchSetupStatus(), fetchWorkflows()]);

                const models = await fetchGatewayModels()
                    .then((list) => list.map((model) => ({ name: model.id, capability: toCapability(model.metadata?.type) })))
                    // 模型列表拿不到不算致命：设置页仍可展示工作流与缺失项。
                    .catch(() => []);

                setHealth(healthResult);
                setSetup(statusResult);
                setWorkflows(workflowRows(workflowList));

                const comfyReachable = healthResult.comfy?.reachable !== false;
                const scanning = statusResult.scanning === true || statusResult.phase === "scanning" || statusResult.phase === "idle";

                if (!comfyReachable) setPhase("comfyDown");
                else if (scanning) setPhase("scanning");
                else if ((statusResult.counts?.available || 0) === 0) setPhase("readyEmpty");
                else setPhase("ready");

                // 只有拿到确定性结果才同步渠道，避免扫描中把渠道清空。
                if (!scanning && comfyReachable) {
                    syncLocalComfyChannel(models);
                    setLastSyncedCount(models.length);
                }
            } catch (caught) {
                if (caught instanceof ProviderTransportError) {
                    setPhase("gatewayDown");
                    setError(t("config.comfyui.gatewayUnreachable"));
                } else {
                    setPhase("gatewayDown");
                    setError(caught instanceof Error ? caught.message : String(caught));
                }
            } finally {
                setBusy(false);
            }
        },
        [syncLocalComfyChannel, t],
    );

    // 首屏加载，并在扫描未完成时轮询直到有确定性结果。
    useEffect(() => {
        void load();
        return () => {
            if (pollTimer.current) window.clearTimeout(pollTimer.current);
        };
        // 仅首屏触发；重扫走按钮。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const phaseValue = setup?.phase;
        // idle：网关刚起还没扫过；scanning：扫描中。两种都要继续等。
        const waiting = setup?.scanning === true || phaseValue === "scanning" || phaseValue === "idle";
        if (!waiting) return;
        // 通常几秒内完成；限 20 次（约 50 秒）兜底，防止网关异常时无限轮询。
        if (pollCount.current >= 20) return;
        pollCount.current += 1;
        // idle 说明网关没自己在扫，下一次主动触发一次，避免一直停在 idle。
        const needRescan = phaseValue === "idle" && pollCount.current === 1;
        pollTimer.current = window.setTimeout(() => void load({ rescan: needRescan }), 2500);
        return () => {
            if (pollTimer.current) window.clearTimeout(pollTimer.current);
        };
    }, [setup, load]);

    const counts = setup?.counts;
    const availableRows = useMemo(() => workflows.filter((workflow) => workflow.availability?.available === true), [workflows]);

    const statusText = useMemo(() => {
        switch (phase) {
            case "loading":
                return t("config.comfyui.status.loading");
            case "gatewayDown":
                return t("config.comfyui.status.gatewayDown");
            case "comfyDown":
                return t("config.comfyui.status.comfyDown");
            case "scanning":
                return t("config.comfyui.status.scanning");
            case "readyEmpty":
                return t("config.comfyui.status.readyEmpty");
            case "ready":
                return t("config.comfyui.status.ready", { available: counts?.available ?? availableRows.length, total: counts?.total ?? workflows.length });
            default:
                return "";
        }
    }, [phase, counts, workflows.length, availableRows.length, t]);

    const statusColor = phase === "ready" ? "success" : phase === "scanning" || phase === "loading" ? "processing" : "warning";

    return (
        <section className="surface-card mt-5 space-y-3 p-5" aria-label={t("config.comfyui.title")}>
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h2 className="text-base font-semibold">{t("config.comfyui.title")}</h2>
                    <p className="mt-1 text-sm text-[var(--text-secondary)]">{t("config.comfyui.description")}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                    <Button
                        disabled={busy}
                        onClick={() => {
                            pollCount.current = 0;
                            void load();
                        }}
                    >
                        {t("config.comfyui.refresh")}
                    </Button>
                    <Button
                        type="primary"
                        disabled={busy}
                        onClick={() => {
                            pollCount.current = 0;
                            void load({ rescan: true });
                        }}
                    >
                        {t("config.comfyui.rescan")}
                    </Button>
                </div>
            </div>

            <div className="flex items-center gap-2 text-sm">
                <Tag color={statusColor}>{statusText}</Tag>
                {health?.comfy?.url && <span className="text-[var(--text-secondary)]">ComfyUI: {health.comfy.url}</span>}
            </div>

            {error && <Alert type="error" showIcon message={error} />}

            {phase === "gatewayDown" && <p className="text-sm text-[var(--text-secondary)]">{t("config.comfyui.gatewayHint")}</p>}
            {phase === "comfyDown" && <p className="text-sm text-[var(--text-secondary)]">{t("config.comfyui.comfyHint")}</p>}
            {phase === "readyEmpty" && (
                <div className="space-y-2">
                    <Alert type="warning" showIcon message={t("config.comfyui.emptyTitle")} description={t("config.comfyui.emptyDescription")} />
                    {setup?.missing && (
                        <p className="text-xs text-[var(--text-secondary)]">
                            {t("config.comfyui.missingSummary", {
                                models: setup.missing.models?.length || 0,
                                nodes: setup.missing.nodes?.length || 0,
                            })}
                        </p>
                    )}
                </div>
            )}
            {phase === "ready" && lastSyncedCount !== null && (
                <p className="text-xs text-[var(--text-secondary)]">{t("config.comfyui.synced", { count: lastSyncedCount })}</p>
            )}

            {workflows.length > 0 && (
                <div className="space-y-2">
                    <h3 className="text-sm font-medium">{t("config.comfyui.workflowList")}</h3>
                    <ul className="divide-y divide-[var(--border-color)]">
                        {workflows.map((workflow) => {
                            const checking = workflow.availability?.checking === true;
                            const ok = workflow.availability?.available === true;
                            return (
                                <li key={workflow.id} className="space-y-1 py-2">
                                    <div className="flex items-center gap-2">
                                        <Tag color={checking ? "processing" : ok ? "success" : "default"}>
                                            {checking ? t("config.comfyui.checking") : ok ? t("config.comfyui.available") : t("config.comfyui.unavailable")}
                                        </Tag>
                                        <span className="text-sm">{workflow.name}</span>
                                        {workflow.type && <span className="text-xs text-[var(--text-secondary)]">({workflow.type})</span>}
                                    </div>
                                    {!ok && !checking && problemLines(workflow).length > 0 && (
                                        <ul className="ml-1 list-disc space-y-0.5 pl-4 text-xs text-[var(--text-secondary)]">
                                            {problemLines(workflow).map((line, index) => (
                                                <li key={index}>{line}</li>
                                            ))}
                                        </ul>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}

            <p className="text-xs text-[var(--text-secondary)]">{t("config.comfyui.footer")}</p>
        </section>
    );
}
