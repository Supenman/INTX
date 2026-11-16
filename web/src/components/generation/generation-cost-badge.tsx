import { useTranslation } from "react-i18next";

import { estimateGenerationCost } from "@/domain";
import { findChannelModelPricing, type AiConfig } from "@/stores/use-config-store";

/**
 * 生成前费用预估。
 *
 * 只按渠道里登记的本地单价 × 数量估算，没有单价就明说「未配置单价」——
 * 绝不编一个 0 假装免费（与审计台账口径一致）。
 */
export function GenerationCostBadge({ config, model, count, kind = "image" }: { config: AiConfig; model: string; count: number; kind?: "image" | "video" }) {
    const { t } = useTranslation();
    const safeCount = Math.max(1, Math.floor(count) || 1);
    const cost = estimateGenerationCost({ pricing: findChannelModelPricing(config, model), kind, outputCount: safeCount, modelId: model });
    const hint = t("costEstimate.hint");
    if (!cost) return <span className="typ-caption text-muted-foreground" title={hint}>{t("costEstimate.missing")}</span>;
    return (
        <span className="typ-caption text-muted-foreground" title={hint}>
            {t("costEstimate.estimated", { currency: cost.currency, amount: cost.amount, count: safeCount })}
        </span>
    );
}
