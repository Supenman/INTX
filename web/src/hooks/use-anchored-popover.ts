import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";
import { notifyCanvasFloatingPopoverOpen, subscribeCanvasFloatingPopoverOpen } from "@/lib/canvas/canvas-floating-popover";
import { canvasOverlayLayer } from "@/lib/canvas/canvas-overlay-layer";

type UseAnchoredPopoverOptions = {
    /** 触发按钮所属的容器；水平避让以它为界，默认是节点里的生成面板。 */
    anchorSelector?: string;
    onOpenChange?: (open: boolean) => void;
    /** 浮层标题。给了就给容器补上 dialog 语义，读屏打开后能听到这是什么设置。 */
    label?: string;
};

export type AnchoredPopover = {
    buttonRef: RefObject<HTMLSpanElement | null>;
    panelRef: RefObject<HTMLDivElement | null>;
    /** 容器语义与焦点落点：portal 挂在 body 末尾，不主动接管焦点的话 Tab 会绕到画布工具栏。 */
    panelProps: { role: "dialog"; "aria-label": string | undefined; tabIndex: number };
    open: boolean;
    setOpen: (open: boolean) => void;
    /** 首帧可能还没测量到按钮位置；为 null 时先不渲染浮层。 */
    buttonRect: DOMRect | null;
    anchorRect: DOMRect | null;
    buttonWidth: number | null;
    layer: number;
};

/**
 * 画布设置浮层的开合与跟随定位。
 *
 * 画布平移/缩放只改容器的 CSS transform，不触发 resize/scroll，所以只挂这两个
 * 事件会让浮层停在旧位置（实测缩放 5 档后按钮上移 209px，浮层原地不动）。
 * 这里在打开期间逐帧测量，位置真变了才写 state，避免无意义重渲染。
 */
export function useAnchoredPopover({ anchorSelector = "[data-canvas-prompt-panel]", onOpenChange, label }: UseAnchoredPopoverOptions = {}): AnchoredPopover {
    const buttonRef = useRef<HTMLSpanElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const popoverId = useId();
    const [open, setOpenState] = useState(false);
    const [buttonRect, setButtonRect] = useState<DOMRect | null>(null);
    const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
    const [buttonWidth, setButtonWidth] = useState<number | null>(null);
    // 键盘打开才把焦点送进浮层：鼠标点击后立刻跳焦点会让按钮看起来「失焦」，也没必要。
    const keyboardOpenRef = useRef(false);

    const setOpen = useCallback((next: boolean) => {
        if (next) {
            notifyCanvasFloatingPopoverOpen(popoverId);
            setButtonWidth(buttonRef.current?.getBoundingClientRect().width ?? null);
        } else {
            setButtonWidth(null);
        }
        setOpenState(next);
        onOpenChange?.(next);
    }, [buttonRef, onOpenChange, popoverId]);

    useEffect(() => {
        const markKeyboard = () => { keyboardOpenRef.current = true; };
        const markPointer = () => { keyboardOpenRef.current = false; };
        window.addEventListener("keydown", markKeyboard, true);
        window.addEventListener("pointerdown", markPointer, true);
        return () => {
            window.removeEventListener("keydown", markKeyboard, true);
            window.removeEventListener("pointerdown", markPointer, true);
        };
    }, []);

    useEffect(() => subscribeCanvasFloatingPopoverOpen(popoverId, () => setOpen(false)), [popoverId, setOpen]);

    // 浮层要先测量到按钮位置才挂载，所以等 buttonRect 就绪后的这次渲染再把焦点送进去。
    const focusedRef = useRef(false);
    useEffect(() => {
        if (!open) {
            focusedRef.current = false;
            return;
        }
        if (!buttonRect || focusedRef.current || !keyboardOpenRef.current) return;
        focusedRef.current = true;
        panelRef.current?.focus({ preventScroll: true });
    }, [buttonRect, open]);

    useEffect(() => {
        if (!open) {
            // 清掉旧坐标，避免下次打开首帧用上一处按钮的位置闪一下。
            setButtonRect(null);
            setAnchorRect(null);
            return;
        }

        const keyOf = (rect: DOMRect | null) => (rect ? `${rect.x.toFixed(1)},${rect.y.toFixed(1)},${rect.width.toFixed(1)},${rect.height.toFixed(1)}` : "");
        let lastKey = "";
        let frame = 0;

        const measure = () => {
            const button = buttonRef.current;
            const nextButtonRect = button?.getBoundingClientRect() ?? null;
            const anchorEl = button?.closest(anchorSelector);
            const nextAnchorRect = anchorEl instanceof HTMLElement ? anchorEl.getBoundingClientRect() : null;
            const key = `${keyOf(nextButtonRect)}|${keyOf(nextAnchorRect)}`;
            if (key === lastKey) return;
            lastKey = key;
            setButtonRect(nextButtonRect);
            setAnchorRect(nextAnchorRect);
        };

        const tick = () => {
            if (document.visibilityState === "visible") measure();
            frame = requestAnimationFrame(tick);
        };

        const closeOnOutsidePointer = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
            if (document.activeElement instanceof HTMLElement && panelRef.current?.contains(document.activeElement)) document.activeElement.blur();
            setOpen(false);
        };

        // 浮层开着时 Esc 只关浮层，并把焦点还给触发按钮；不冒泡给画布，
        // 否则画布会顺手清空选中节点，用户得先重新选一次才能继续。
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || event.isComposing) return;
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            buttonRef.current?.querySelector("button")?.focus();
        };

        measure();
        frame = requestAnimationFrame(tick);
        window.addEventListener("resize", measure);
        window.addEventListener("scroll", measure, true);
        window.addEventListener("pointerdown", closeOnOutsidePointer, true);
        window.addEventListener("keydown", closeOnEscape, true);
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener("resize", measure);
            window.removeEventListener("scroll", measure, true);
            window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
            window.removeEventListener("keydown", closeOnEscape, true);
            onOpenChange?.(false);
        };
    }, [anchorSelector, open, setOpen]);

    return { buttonRef, panelRef, panelProps: { role: "dialog" as const, "aria-label": label, tabIndex: -1 }, open, setOpen, buttonRect, anchorRect, buttonWidth, layer: canvasOverlayLayer(buttonRef.current) };
}
