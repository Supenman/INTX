const CANVAS_FLOATING_POPOVER_EVENT = "canvas-floating-popover-open";

export function notifyCanvasFloatingPopoverOpen(popoverId: string) {
    window.dispatchEvent(new CustomEvent(CANVAS_FLOATING_POPOVER_EVENT, { detail: popoverId }));
}

export function subscribeCanvasFloatingPopoverOpen(popoverId: string, onClose: () => void) {
    const handleOpen = (event: Event) => {
        if ((event as CustomEvent<string>).detail !== popoverId) onClose();
    };
    window.addEventListener(CANVAS_FLOATING_POPOVER_EVENT, handleOpen);
    return () => window.removeEventListener(CANVAS_FLOATING_POPOVER_EVENT, handleOpen);
}
