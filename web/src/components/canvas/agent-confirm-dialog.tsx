import type { ReactNode } from "react";
import { Modal } from "antd";
import { AlertTriangle, Coins, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { AgentPlanVerdict } from "@/lib/canvas/agent-permissions";

/**
 * Agent 操作确认卡。
 *
 * 只说两件用户真正关心的事：**要做几件会花钱的事**、**会不会删东西**。
 * 不列 op 的 JSON——那是给我们看的，用户看不懂；但条数和金额必须给准，
 * 因为这是扣钱前最后一道关。
 *
 * 金额拿不准时（渠道没填单价）明说「未配置单价」，不显示 0——
 * 显示 0 会让用户以为免费。
 */
export function AgentConfirmDialog({ plan, open, costText, onCancel, onConfirm }: { plan: AgentPlanVerdict | null; open: boolean; costText: string | null; onCancel: () => void; onConfirm: () => void }) {
    const { t } = useTranslation();
    if (!plan) return null;

    const spend = plan.pending.filter((verdict) => verdict.reason === "costs_money");
    const destroy = plan.pending.filter((verdict) => verdict.reason === "destructive");
    // request 模式下普通改动的 reason 是 any_change，不能只认 reversible，
    // 否则那种模式下弹出来的卡一行内容都没有。
    const others = plan.pending.filter((verdict) => verdict.reason !== "costs_money" && verdict.reason !== "destructive");

    return (
        <Modal title={null} open={open} onCancel={onCancel} centered width={460} okText={t("canvas.agentPermission.confirmRun")} cancelText={t("canvas.agentPermission.cancel")} onOk={onConfirm} okButtonProps={{ danger: true }}>
            <div className="space-y-4">
                <div>
                    <h2 className="typ-heading text-foreground">{t("canvas.agentPermission.title")}</h2>
                    <p className="typ-caption mt-1 text-muted-foreground">{t("canvas.agentPermission.description")}</p>
                </div>

                <div className="space-y-2">
                    {spend.length ? <Row icon={<Coins className="size-4" />} title={t("canvas.agentPermission.spendTitle", { count: spend.length })} detail={costText ?? t("canvas.agentPermission.costUnknown")} strong /> : null}
                    {destroy.length ? <Row icon={<Trash2 className="size-4" />} title={t("canvas.agentPermission.destroyTitle", { count: destroy.length })} detail={t("canvas.agentPermission.destroyDetail")} /> : null}
                    {others.length ? <Row icon={<AlertTriangle className="size-4" />} title={t("canvas.agentPermission.changeTitle", { count: others.length })} detail={t("canvas.agentPermission.changeDetail")} /> : null}
                </div>

                {spend.length ? <p className="typ-caption text-muted-foreground">{t("canvas.agentPermission.spendWarning")}</p> : null}
            </div>
        </Modal>
    );
}

function Row({ icon, title, detail, strong = false }: { icon: ReactNode; title: string; detail: string; strong?: boolean }) {
    return (
        <div className="surface-card flex items-start gap-3 px-3 py-2.5">
            <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
            <div className="min-w-0">
                <p className={strong ? "typ-body-compact font-medium text-foreground" : "typ-body-compact text-foreground"}>{title}</p>
                <p className="typ-caption mt-0.5 text-muted-foreground">{detail}</p>
            </div>
        </div>
    );
}
