import { createPortal } from "react-dom";
import { Button, Input, InputNumber, Select } from "antd";
import { Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { resolvePopoverPosition } from "@/lib/canvas/popover-position";
import { useAnchoredPopover } from "@/hooks/use-anchored-popover";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { modelWorkflowOf, type AiConfig } from "@/stores/use-config-store";
import type { WorkflowValues, WorkflowValue } from "@/types/comfy-workflow";

export function CanvasWorkflowSettings({ config, onChange, onOpenChange }: { config: AiConfig; onChange: (values: WorkflowValues) => void; onOpenChange?: (open: boolean) => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { buttonRef, panelRef, panelProps, open, setOpen, buttonRect, anchorRect } = useAnchoredPopover({ onOpenChange, label: t("settingsPanels.workflow.title") });
    const workflow = modelWorkflowOf(config, config.model);
    const values = config.workflowValues?.[config.model] || {};
    const fields = workflow?.fields.filter((field) => !field.media && field.from !== "prompt" && field.from !== "count") || [];
    const activeFieldKeys = new Set(fields.map((field) => field.key));
    const activeValueCount = Object.keys(values).filter((key) => activeFieldKeys.has(key)).length;
    const summary = activeValueCount ? t("settingsPanels.workflow.summary", { count: activeValueCount }) : "";
    const update = (key: string, value: WorkflowValue | null | undefined) => {
        const next = { ...values };
        if (value === null || value === undefined) delete next[key];
        else next[key] = value;
        onChange({ ...config.workflowValues, [config.model]: next });
    };
    const position = buttonRect ? resolvePopoverPosition({ buttonRect, anchorRect, placement: "topLeft", width: 320, viewport: { width: window.innerWidth, height: window.innerHeight } }) : null;
    const panel = open && position ? createPortal(
        <div
            ref={panelRef}
            {...panelProps}
            data-canvas-no-zoom
            data-node-settings-panel
            className="fixed z-[1200] space-y-3 overflow-y-auto rounded-[var(--r-xl)] p-4 shadow-[var(--shadow-lg)]"
            style={{ ...position, background: theme.toolbar.panel, color: theme.node.text, boxShadow: "var(--shadow-lg), var(--hairline)", overscrollBehavior: "contain" }}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <p className="text-xs" style={{ color: theme.node.muted }}>{t("settingsPanels.workflow.hint")}</p>
            {workflow?.fields.filter((field) => field.media).map((field) => {
                const index = field.media === "video" ? field.videoIndex : field.imageIndex;
                const inputName = index === undefined ? field.key : `${index + 1}`;
                const requirement = field.required || (field.array && (field.min ?? 0) > 0)
                    ? "required"
                    : field.array
                        ? "optionalArray"
                        : "optionalDefault";
                return <p key={field.key} className="text-xs" style={{ color: theme.node.muted }}>{t(`settingsPanels.workflow.media.${field.media === "video" ? "video" : field.media === "audio" ? "audio" : "image"}`)} {t("settingsPanels.workflow.input", { name: inputName })}: {t(`settingsPanels.workflow.${requirement}`)}</p>;
            })}
            {fields.map((field) => (
                <label key={field.key} className="block space-y-1 text-sm">
                    <span>{t(`settingsPanels.workflow.fieldLabels.${field.key}`, { defaultValue: field.key })}</span>
                    {field.type === "number" ? (
                        <InputNumber className="!w-full" value={typeof values[field.key] === "number" ? values[field.key] as number : null} placeholder={field.default === undefined ? t("settingsPanels.workflow.defaultValue") : String(field.default)} onChange={(value) => update(field.key, value)} />
                    ) : field.type === "boolean" ? (
                        <Select className="w-full" allowClear placeholder={t("settingsPanels.workflow.defaultValue")} value={values[field.key] === undefined ? undefined : String(values[field.key])} options={[{ value: "true", label: t("settingsPanels.workflow.enabled") }, { value: "false", label: t("settingsPanels.workflow.disabled") }]} onChange={(value) => update(field.key, value === undefined ? undefined : value === "true")} />
                    ) : (
                        <Input allowClear value={String(values[field.key] ?? "")} placeholder={field.default === undefined ? t("settingsPanels.workflow.defaultValue") : String(field.default)} onChange={(event) => update(field.key, event.target.value || undefined)} />
                    )}
                </label>
            ))}
            {!fields.length && <p className="text-sm">{t("settingsPanels.workflow.noFields")}</p>}
        </div>,
        document.body,
    ) : null;

    return (
        <>
            <span ref={buttonRef} className="inline-flex min-w-0">
                <Button type="text" aria-expanded={open} aria-label={`${t("settingsPanels.workflow.title")}${summary ? `: ${summary}` : ""}`} title={`${t("settingsPanels.workflow.title")}${summary ? ` · ${summary}` : ""}`} className="!h-[var(--control-h-sm)] !max-w-[170px] !rounded-[var(--r-md)] !bg-transparent !px-2.5" style={{ background: open ? theme.toolbar.activeBg : "transparent", color: theme.node.text }} icon={<Settings2 className="size-3.5" />} onClick={() => setOpen(!open)}><span className="truncate">{summary ? `${t("settingsPanels.workflow.title")} · ${summary}` : t("settingsPanels.workflow.title")}</span></Button>
            </span>
            {panel}
        </>
    );
}
