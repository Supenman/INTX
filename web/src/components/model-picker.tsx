import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Cpu } from "lucide-react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { notifyCanvasFloatingPopoverOpen, subscribeCanvasFloatingPopoverOpen } from "@/lib/canvas/canvas-floating-popover";
import { canvasOverlayLayer } from "@/lib/canvas/canvas-overlay-layer";
import { decodeChannelModel, modelOptionLabel, modelOptionName, selectableModelsByCapability, type AiConfig, type ModelCapability } from "@/stores/use-config-store";

type ModelPickerProps = {
    config: AiConfig;
    value?: string;
    onChange: (model: string) => void;
    capability?: ModelCapability;
    className?: string;
    fullWidth?: boolean;
    placeholder?: string;
    onMissingConfig?: () => void;
};

export function ModelPicker({ config, value, onChange, capability, className, fullWidth = false, placeholder, onMissingConfig }: ModelPickerProps) {
    const { t } = useTranslation();
    const pickerId = useId();
    const [open, setOpen] = useState(false);
    const [popoverLayer, setPopoverLayer] = useState(1200);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const lastPointerTypeRef = useRef<string>("mouse");
    const options = useMemo(() => Array.from(new Set([...(config.channelMode === "local" && !capability ? [value] : []), ...selectableModelsByCapability(config, capability)].filter((model): model is string => Boolean(model)))), [capability, config, value]);
    const channelGroups = useMemo(() => {
        const assigned = new Set<string>();
        const groups = config.channels.map((channel) => {
            const models = options.filter((model) => {
                const decoded = decodeChannelModel(model);
                const belongsToChannel = decoded ? decoded.channelId === channel.id : channel.models.some((item) => item.name === model);
                if (belongsToChannel) assigned.add(model);
                return belongsToChannel;
            });
            return { id: channel.id, name: channel.name, models };
        }).filter((group) => group.models.length > 0);
        const unassigned = options.filter((model) => !assigned.has(model));
        if (unassigned.length) groups.push({ id: "other", name: t("settingsPanels.model.otherChannel", { defaultValue: "其他渠道" }), models: unassigned });
        return groups;
    }, [config.channels, options, t]);
    const current = value || "";
    const pickerPlaceholder = placeholder || t("settingsPanels.model.select");

    useEffect(() => {
        const closeOtherPicker = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== pickerId) setOpen(false);
        };
        window.addEventListener("model-picker-open", closeOtherPicker);
        const unsubscribeCanvasPopover = subscribeCanvasFloatingPopoverOpen(pickerId, () => setOpen(false));
        return () => {
            window.removeEventListener("model-picker-open", closeOtherPicker);
            unsubscribeCanvasPopover();
        };
    }, [pickerId]);

    return (
        <Select
            open={open}
            value={current}
            onOpenChange={(nextOpen) => {
                if (nextOpen && !options.length && config.channelMode === "local") onMissingConfig?.();
                if (nextOpen) {
                    setPopoverLayer(canvasOverlayLayer(triggerRef.current));
                    window.dispatchEvent(new CustomEvent("model-picker-open", { detail: pickerId }));
                    notifyCanvasFloatingPopoverOpen(pickerId);
                }
                setOpen(nextOpen);
            }}
            onValueChange={onChange}
        >
            <SelectTrigger
                ref={triggerRef}
                className={cn(
                    // 画布内选择器与相邻参数控件保持同一视觉层级：方块圆角、填充底、无描边。
                    // 药丸 + 描边会在面板里显得比参数控件更"重要"，抢走生成按钮的焦点。
                    "canvas-composer-model-picker h-8 w-fit max-w-full gap-2 border border-transparent bg-[var(--surface-card-hover)] px-2.5 text-[length:var(--fs-body)] font-normal transition-colors",
                    fullWidth ? "rounded-[var(--r-md)]" : "rounded-full",
                    fullWidth ? "w-full min-w-0 justify-start" : "min-w-[9rem] justify-start",
                    "[&_.canvas-select-chevron]:transition-transform data-[state=open]:[&_.canvas-select-chevron]:rotate-180",
                    "data-[state=open]:border-ring data-[state=open]:ring-2 data-[state=open]:ring-ring/20",
                    className,
                )}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => {
                    event.stopPropagation();
                    lastPointerTypeRef.current = event.pointerType;
                    if (open && event.pointerType === "mouse" && event.button === 0 && !event.ctrlKey) {
                        event.preventDefault();
                        setOpen(false);
                    }
                }}
                onClick={(event) => {
                    // Radix Select opens on pointerdown for mouse and on click for touch/pen.
                    // It does not toggle closed when its trigger is activated while open.
                    if (event.detail === 0 || lastPointerTypeRef.current === "mouse") return;
                    if (open) {
                        event.preventDefault();
                        setOpen(false);
                    }
                }}
                onKeyDown={(event) => {
                    if (open && (event.key === "Enter" || event.key === " ")) {
                        event.preventDefault();
                        setOpen(false);
                    }
                }}
                title={current ? modelOptionLabel(config, current) : pickerPlaceholder}
                // 触发器里只有图标和模型名，读屏念到的是名称；补一个说明这是「选择模型」。
                aria-label={t("settingsPanels.model.select")}
                aria-description={current ? modelOptionLabel(config, current) : pickerPlaceholder}
            >
                <ModelIcon model={current} />
                <span className="canvas-model-picker-text min-w-0 flex-1 truncate text-left">{current ? modelOptionLabel(config, current) : pickerPlaceholder}</span>
            </SelectTrigger>
            <SelectContent
                data-canvas-no-zoom
                className="z-[1200] w-80 max-w-[calc(100vw-24px)] rounded-xl border border-border/70 bg-popover p-1 shadow-xl"
                style={{ zIndex: popoverLayer }}
                position="popper"
                align="start"
                side="bottom"
                sideOffset={6}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
            >
                {channelGroups.length ? (
                    channelGroups.map((group) => (
                        <SelectGroup key={group.id}>
                            <SelectLabel className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{group.name || t("config.channels.unnamed", { defaultValue: "未命名渠道" })}</SelectLabel>
                            {group.models.map((model) => (
                                <SelectItem key={model} value={model} textValue={modelOptionLabel(config, model)}>
                                    <ModelLabel config={config} model={model} />
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    ))
                ) : (
                    <SelectItem value="__empty__" disabled>
                        {emptyModelLabel(config, capability)}
                    </SelectItem>
                )}
            </SelectContent>
        </Select>
    );
}

function emptyModelLabel(config: AiConfig, capability?: ModelCapability) {
    const label = capability ? i18n.t(`settingsPanels.model.capabilities.${capability}`) : "";
    if (capability && config.models.length) return i18n.t("settingsPanels.model.assign", { capability: label });
    return config.models.length ? i18n.t("settingsPanels.model.noMatch", { capability: label }) : i18n.t("settingsPanels.model.addFirst");
}

function ModelLabel({ config, model }: { config: AiConfig; model: string }) {
    const decoded = decodeChannelModel(model);
    const channelModel = decoded && config.channels.find((channel) => channel.id === decoded.channelId)?.models.find((item) => item.name === decoded.model);
    const label = channelModel?.label || modelOptionName(model);
    return (
        <span className="flex min-w-0 items-center gap-2">
            <ModelIcon model={model} />
            <span className="truncate">{label}</span>
        </span>
    );
}

function ModelIcon({ model }: { model: string }) {
    const icon = resolveModelIcon(modelOptionName(model));
    return icon ? <img src={icon} alt="" className="size-4 shrink-0 dark:invert" /> : <Cpu className="size-4 shrink-0 opacity-70" />;
}

function resolveModelIcon(model: string) {
    const name = model.toLowerCase();
    if (name.includes("claude") || name.includes("anthropic")) return "/icons/claude.svg";
    if (name.includes("gemini") || name.includes("google")) return "/icons/gemini.svg";
    if (name.includes("gpt") || name.includes("openai")) return "/icons/openai.svg";
    if (name.includes("grok") || name.includes("grok")) return "/icons/grok.svg";
    if (name.includes("deepseek") || name.includes("deepseek")) return "/icons/deepseek.svg";
    if (name.includes("glm") || name.includes("glm")) return "/icons/glm.svg";
    return "";
}
