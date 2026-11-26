const BASE_CANVAS_OVERLAY_LAYER = 1200;

/** Keep portaled canvas controls above the modal that owns their trigger. */
export function canvasOverlayLayer(anchor: HTMLElement | null) {
    if (typeof window === "undefined" || !anchor) return BASE_CANVAS_OVERLAY_LAYER;
    const modal = anchor.closest<HTMLElement>(".ant-modal-wrap");
    if (!modal) return BASE_CANVAS_OVERLAY_LAYER;
    const modalLayer = Number.parseInt(window.getComputedStyle(modal).zIndex, 10);
    return Number.isFinite(modalLayer) ? Math.max(BASE_CANVAS_OVERLAY_LAYER, modalLayer + 1) : BASE_CANVAS_OVERLAY_LAYER;
}
