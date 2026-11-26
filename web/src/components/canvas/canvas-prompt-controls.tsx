import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

const MIN_FONT_SIZE = 12;
const MAX_FONT_SIZE = 28;
const FONT_SIZE_STEP = 2;

export function CanvasPromptFontControl({ value, onChange }: { value: number; onChange: (value: number) => void }) {
    const { t } = useTranslation();
    const setFontSize = (next: number) => {
        const clamped = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, next));
        onChange(clamped);
        window.localStorage.setItem("intx-canvas-prompt-font-size", String(clamped));
    };

    return (
        <div className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-1.5 text-xs" role="group" aria-label={t("canvas.promptPanel.fontSize")} data-canvas-no-zoom>
            <span className="mr-0.5 text-[length:var(--fs-caption)]">{t("canvas.promptPanel.fontSize")}</span>
            <button type="button" className="grid size-6 place-items-center rounded-full transition-colors hover:bg-[var(--surface-card-hover)] disabled:opacity-35" aria-label={t("canvas.promptPanel.decreaseFont")} title={t("canvas.promptPanel.decreaseFont")} disabled={value <= MIN_FONT_SIZE} onClick={() => setFontSize(value - FONT_SIZE_STEP)}>
                <Minus className="size-3" />
            </button>
            <output className="min-w-5 text-center tabular-nums" aria-label={t("canvas.promptPanel.currentFontSize", { size: value })}>{value}</output>
            <button type="button" className="grid size-6 place-items-center rounded-full transition-colors hover:bg-[var(--surface-card-hover)] disabled:opacity-35" aria-label={t("canvas.promptPanel.increaseFont")} title={t("canvas.promptPanel.increaseFont")} disabled={value >= MAX_FONT_SIZE} onClick={() => setFontSize(value + FONT_SIZE_STEP)}>
                <Plus className="size-3" />
            </button>
        </div>
    );
}

export function CanvasPromptResizeHandle({ height, min, max, onResize }: { height: number; min: number; max: number; onResize: (height: number) => void }) {
    const { t } = useTranslation();
    const dragRef = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);
    const resizeBy = (delta: number) => onResize(Math.min(max, Math.max(min, height + delta)));
    const finish = (event: PointerEvent<HTMLButtonElement>) => {
        if (dragRef.current?.pointerId !== event.pointerId) return;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        dragRef.current = null;
    };
    const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
        if (event.key === "ArrowUp") { event.preventDefault(); resizeBy(-8); }
        else if (event.key === "ArrowDown") { event.preventDefault(); resizeBy(8); }
        else if (event.key === "Home") { event.preventDefault(); onResize(min); }
        else if (event.key === "End") { event.preventDefault(); onResize(max); }
    };

    return (
        <button
            type="button"
            role="separator"
            aria-orientation="horizontal"
            aria-label={t("canvas.promptPanel.resizePrompt")}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={Math.round(height)}
            title={t("canvas.promptPanel.resizePromptHint")}
            className="absolute inset-x-0 bottom-0 z-10 mx-auto grid h-4 w-14 touch-none cursor-ns-resize place-items-center rounded-full opacity-45 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
            onKeyDown={onKeyDown}
            onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                dragRef.current = { pointerId: event.pointerId, startY: event.clientY, startHeight: height };
                event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
                const drag = dragRef.current;
                if (!drag || drag.pointerId !== event.pointerId) return;
                if (!event.currentTarget.hasPointerCapture(event.pointerId)) { dragRef.current = null; return; }
                if ((event.buttons & 1) === 0) { finish(event); return; }
                event.stopPropagation();
                onResize(Math.min(max, Math.max(min, drag.startHeight + event.clientY - drag.startY)));
            }}
            onPointerUp={finish}
            onPointerCancel={finish}
            onLostPointerCapture={(event) => { if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null; }}
        >
            <span aria-hidden className="h-1 w-9 rounded-full bg-current" />
        </button>
    );
}
