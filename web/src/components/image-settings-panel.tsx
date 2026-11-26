import { type ReactNode, useState } from "react";
import { ConfigProvider, Switch } from "antd";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { computeMediaSize, inferMediaRatio, inferMediaScale, mediaRatioOptions, mediaScaleOptions, readMediaDimensions } from "@/lib/media-size";
import { resolveImageCapabilities, unsupportedImageFields } from "@/domain/provider/imageCapabilities";
import { resolveModelRequestConfig, resolveModelScript, type AiConfig } from "@/stores/use-config-store";

const qualityOptions = [
    { value: "auto", labelKey: "auto" },
    { value: "low", labelKey: "low" },
    { value: "medium", labelKey: "medium" },
    { value: "high", labelKey: "high" },
    { value: "xhigh", labelKey: "xhigh" },
    { value: "max", labelKey: "max" },
];
const DIMENSION_STEP = 16;

export const imageQualityOptions = qualityOptions.map((item) => ({ value: item.value, get label() { return i18n.t(`settingsPanels.common.${item.labelKey}`); } }));
export const imageAspectOptions = mediaRatioOptions.map((item) => ({ value: item.value, label: item.value === "auto" ? i18n.t("settingsPanels.common.auto") : item.value }));
export const imageScaleOptions = mediaScaleOptions.map((value) => ({ value, label: value === "auto" ? i18n.t("settingsPanels.common.auto") : value }));

type ImageSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "quality" | "size" | "count" | "background", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
    maxCount?: number;
    quickCount?: number;
};

export function ImageSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-[var(--r-lg)] px-1 py-0.5", maxCount = 15, quickCount = 10 }: ImageSettingsPanelProps) {
    const { t } = useTranslation();
    const [snapDimensionToStep, setSnapDimensionToStep] = useState(true);
    // 精确像素属于少数场景才改的项，默认收起，避免和比例选择抢位置。
    const [exactSizeOpen, setExactSizeOpen] = useState(false);
    const quality = config.quality || "auto";
    const count = Math.max(1, Math.min(maxCount, Math.floor(Math.abs(Number(config.count)) || 1)));
    const activeSize = config.size || "auto";
    const transparentBackground = config.background === "transparent";
    const selectedScale = inferMediaScale(activeSize);
    const selectedRatio = inferMediaRatio(activeSize);
    const dimensions = readMediaDimensions(activeSize, selectedScale, selectedRatio);
    // 设置面板和请求构建读同一份能力合同：这里置灰的项，请求也不会带出去。
    const requestConfig = resolveModelRequestConfig(config, config.model || config.imageModel);
    const capabilities = resolveImageCapabilities({
        apiFormat: requestConfig.apiFormat,
        baseUrl: requestConfig.baseUrl,
        hasScript: Boolean(resolveModelScript(config, config.model || config.imageModel)),
    });
    const qualityEnabled = capabilities.quality === "supported";
    const sizeEnabled = capabilities.size === "supported";
    const backgroundEnabled = capabilities.background === "supported";
    const unsupportedFields = unsupportedImageFields(capabilities).map((field) => t(`settingsPanels.image.capabilityFields.${field}`));
    const applySize = (scale: string, ratio: string) => onConfigChange("size", computeMediaSize(scale, ratio));
    const selectScale = (scale: string) => applySize(scale, selectedRatio === "auto" ? "1:1" : selectedRatio);
    const selectRatio = (ratio: string) => applySize(selectedScale, ratio);
    const updateDimension = (key: "width" | "height", value: number | null) => {
        const next = Math.max(1, Math.floor(value || dimensions[key] || 1024));
        const width = key === "width" ? next : dimensions.width;
        const height = key === "height" ? next : dimensions.height;
        onConfigChange("size", `${alignDimension(width, snapDimensionToStep)}x${alignDimension(height, snapDimensionToStep)}`);
    };

    return (
        <ImageSettingsTheme theme={theme}>
            <div
                className={className}
                style={{ color: theme.node.text }}
                onMouseDown={(event) => {
                    event.stopPropagation();
                    if (event.target instanceof HTMLInputElement) return;
                    if (document.activeElement instanceof HTMLInputElement && event.currentTarget.contains(document.activeElement)) document.activeElement.blur();
                }}
            >
                {showTitle ? <div className="text-lg font-semibold">{t("settingsPanels.image.title")}</div> : null}
                {unsupportedFields.length ? (
                    <div className="rounded-[var(--r-md)] px-3 py-2 text-[length:var(--fs-caption)] leading-relaxed" style={{ background: theme.node.fill, color: theme.node.muted }}>
                        {t("settingsPanels.image.capabilityHint", { fields: unsupportedFields.join(t("imageReferences.separator")) })}
                    </div>
                ) : null}
                {/* 必填：出图是什么形状。比例、分辨率、精确尺寸写的是同一个 size 字段，
                    之前并列成三块，看着像三个独立参数，实际互相覆盖。 */}
                <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>{t("settingsPanels.image.size")}</SettingTitle>
                    <div className="grid grid-cols-4 gap-2.5">
                        {mediaRatioOptions.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                disabled={!sizeEnabled}
                                aria-disabled={!sizeEnabled}
                                aria-pressed={selectedRatio === item.value}
                                className={`flex h-[72px] flex-col items-center justify-center gap-1.5 rounded-[var(--r-md)] border bg-transparent text-[length:var(--fs-body)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${sizeEnabled ? "cursor-pointer hover:opacity-80" : "cursor-not-allowed opacity-50"}`}
                                style={{ borderColor: selectedRatio === item.value ? theme.node.text : theme.node.stroke, background: "transparent", color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => selectRatio(item.value)}
                            >
                                <AspectIcon width={item.width} height={item.height} color={theme.node.text} />
                                <span>{item.value === "auto" ? t("settingsPanels.common.auto") : item.value}</span>
                            </button>
                        ))}
                    </div>
                    <div className="grid grid-cols-4 gap-2.5">
                        {mediaScaleOptions.map((value) => (
                            <OptionPill key={value} selected={selectedScale === value} disabled={!sizeEnabled} theme={theme} onClick={() => selectScale(value)}>
                                {value === "auto" ? t("settingsPanels.common.auto") : value}
                            </OptionPill>
                        ))}
                    </div>
                    {/* 高级：精确像素。默认收起，标题右侧常显当前值，收起时信息不丢。 */}
                    <button
                        type="button"
                        className="flex w-full cursor-pointer items-center justify-between rounded-[var(--r-md)] px-2.5 py-1.5 text-[length:var(--fs-caption)] transition hover:bg-[var(--surface-card-hover)]"
                        style={{ color: theme.node.muted }}
                        aria-expanded={exactSizeOpen}
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={() => setExactSizeOpen((value) => !value)}
                    >
                        <span className="flex items-center gap-1.5">
                            <ChevronDown className={`size-3.5 transition-transform ${exactSizeOpen ? "" : "-rotate-90"}`} />
                            {t("settingsPanels.image.exactSize")}
                        </span>
                        <span style={{ opacity: 0.8 }}>{dimensions.width} × {dimensions.height}</span>
                    </button>
                    {exactSizeOpen ? (
                        <div className="space-y-2.5">
                            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                                <DimensionInput prefix="W" value={dimensions.width} disabled={!sizeEnabled || selectedRatio === "auto"} theme={theme} alignToStep={snapDimensionToStep} onChange={(value) => updateDimension("width", value)} />
                                <span className="text-lg opacity-45">↔</span>
                                <DimensionInput prefix="H" value={dimensions.height} disabled={!sizeEnabled || selectedRatio === "auto"} theme={theme} alignToStep={snapDimensionToStep} onChange={(value) => updateDimension("height", value)} />
                            </div>
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-[length:var(--fs-caption)] font-medium" style={{ color: theme.node.muted }}>
                                    {t("settingsPanels.image.align16")}
                                </span>
                                <span title={t("settingsPanels.image.align16Hint")} onMouseDown={(event) => event.stopPropagation()}>
                                    <Switch size="small" aria-label={t("settingsPanels.image.align16")} checked={snapDimensionToStep} disabled={!sizeEnabled} onChange={setSnapDimensionToStep} />
                                </span>
                            </div>
                        </div>
                    ) : null}
                </div>
                <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>{t("settingsPanels.image.count")}</SettingTitle>
                    <div className="grid grid-cols-4 gap-2.5">
                        {Array.from({ length: quickCount }, (_, index) => index + 1).map((value) => (
                            <OptionPill key={value} selected={count === value} theme={theme} onClick={() => onConfigChange("count", String(value))}>
                                {t("settingsPanels.image.images", { count: value })}
                            </OptionPill>
                        ))}
                        <CountInput value={count} max={maxCount} label={t("settingsPanels.image.count")} theme={theme} onChange={(value) => onConfigChange("count", String(value || 1))} />
                    </div>
                    {capabilities.separateRequestsForCount ? (
                        <div className="text-[length:var(--fs-caption)] leading-relaxed" style={{ color: theme.node.muted }}>
                            {t("settingsPanels.image.capabilityCountHint")}
                        </div>
                    ) : null}
                </div>
                <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>{t("settingsPanels.image.output")}</SettingTitle>
                    <div className="grid grid-cols-3 gap-2.5">
                        {qualityOptions.map((item) => (
                            <OptionPill key={item.value} selected={quality === item.value} disabled={!qualityEnabled} theme={theme} onClick={() => onConfigChange("quality", item.value)}>
                                {t(`settingsPanels.common.${item.labelKey}`)}
                            </OptionPill>
                        ))}
                    </div>
                    <div className="flex items-center justify-between gap-3">
                        <div className="space-y-0.5">
                            <span className="text-[length:var(--fs-caption)]" style={{ color: theme.node.muted }}>{t("settingsPanels.image.transparent")}</span>
                            <div className="text-[length:var(--fs-caption)]" style={{ color: theme.node.muted, opacity: 0.75 }}>
                                {t("settingsPanels.image.transparentHint")}
                            </div>
                        </div>
                        <span onMouseDown={(event) => event.stopPropagation()}>
                            <Switch size="small" aria-label={t("settingsPanels.image.transparent")} checked={transparentBackground} disabled={!backgroundEnabled} onChange={(checked) => onConfigChange("background", checked ? "transparent" : "")} />
                        </span>
                    </div>
                </div>
            </div>
        </ImageSettingsTheme>
    );
}

export function ImageSettingsTheme({ theme, children }: { theme: CanvasTheme; children: ReactNode }) {
    return (
        <ConfigProvider
            theme={{
                token: { colorBgContainer: theme.toolbar.panel, colorBgElevated: theme.toolbar.panel, colorBorder: theme.node.stroke, colorPrimary: theme.node.activeStroke, colorText: theme.node.text, colorTextLightSolid: theme.node.panel },
                components: {
                    Button: { defaultBg: theme.toolbar.panel, defaultBorderColor: theme.node.stroke, defaultColor: theme.node.text },
                    Slider: { railBg: theme.node.stroke, railHoverBg: theme.node.stroke, trackBg: theme.node.activeStroke, handleColor: theme.node.text, handleActiveColor: theme.node.text },
                },
            }}
        >
            {children}
        </ConfigProvider>
    );
}

export function imageQualityLabel(value: string) {
    return qualityOptions.some((item) => item.value === value) ? i18n.t(`settingsPanels.common.${value}`) : value;
}

export function imageSizeLabel(size: string) {
    const scale = inferMediaScale(size);
    const ratio = inferMediaRatio(size);
    if (ratio === "auto" || size === "auto") return i18n.t("settingsPanels.common.auto");
    if (scale === "auto") return ratio;
    return `${scale} · ${ratio}`;
}

function OptionPill({ selected, theme, onClick, disabled = false, children }: { selected: boolean; theme: CanvasTheme; onClick: () => void; disabled?: boolean; children: ReactNode }) {
    return (
        <button
            type="button"
            disabled={disabled}
            aria-disabled={disabled}
            aria-pressed={selected}
            className={`h-9 rounded-[var(--r-md)] border px-2 text-[length:var(--fs-body)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:opacity-80"}`}
            style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function DimensionInput({ prefix, value, disabled, theme, alignToStep, onChange }: { prefix: string; value: number; disabled: boolean; theme: CanvasTheme; alignToStep: boolean; onChange: (value: number | null) => void }) {
    const commit = (input: HTMLInputElement) => {
        const next = alignDimension(Math.max(1, Math.floor(Number(input.value) || value || 1024)), alignToStep);
        input.value = String(next);
        onChange(next);
    };

    return (
        <label className="flex h-9 overflow-hidden rounded-[var(--r-md)] text-[length:var(--fs-body)]" style={{ background: theme.node.fill, color: theme.node.text, opacity: disabled ? 0.55 : 1 }}>
            <span className="grid w-9 place-items-center" style={{ color: theme.node.muted }}>
                {prefix}
            </span>
            <input
                type="number"
                min={1}
                disabled={disabled}
                className="min-w-0 flex-1 bg-transparent px-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                defaultValue={value || ""}
                key={`${prefix}-${value}`}
                onBlur={(event) => commit(event.currentTarget)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                }}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function CountInput({ value, max, label, theme, onChange }: { value: number; max: number; label: string; theme: CanvasTheme; onChange: (value: number | null) => void }) {
    return (
        <label className="col-span-2 flex h-9 overflow-hidden rounded-[var(--r-md)] border text-[length:var(--fs-body)]" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
            <input
                type="number"
                aria-label={label}
                min={1}
                max={max}
                className="min-w-0 flex-1 bg-transparent px-3 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                style={{ color: theme.node.text, WebkitTextFillColor: theme.node.text }}
                value={value || ""}
                onChange={(event) => onChange(Number(event.target.value) || null)}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function AspectIcon({ width, height, color }: { width: number; height: number; color: string }) {
    if (!width || !height) return null;
    const ratio = width / height;
    const boxWidth = ratio >= 1 ? 24 : Math.max(10, 24 * ratio);
    const boxHeight = ratio >= 1 ? Math.max(10, 24 / ratio) : 24;
    return (
        <span className="grid h-7 w-9 place-items-center">
            <span className="border-2" style={{ width: boxWidth, height: boxHeight, borderColor: color }} />
        </span>
    );
}

function SettingTitle({ children, color }: { children: string; color: string }) {
    return (
        <div className="text-[length:var(--fs-caption)] font-medium" style={{ color }}>
            {children}
        </div>
    );
}

function alignDimension(value: number, enabled: boolean) {
    return enabled ? Math.ceil(value / DIMENSION_STEP) * DIMENSION_STEP : value;
}
