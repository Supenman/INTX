import { useRef, useState, type PointerEvent } from "react";

export function usePanelResize(width: number, min: number, max: number, direction: 1 | -1, setWidth: (width: number) => void, storageKey: string) {
    const [resizing, setResizing] = useState(false);
    const drag = useRef<{ id: number; x: number; width: number; latest: number } | null>(null);

    return {
        resizing,
        resizeHandle: {
            onPointerDown(event: PointerEvent<HTMLButtonElement>) {
                if (event.button !== 0 || drag.current) return;
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                drag.current = { id: event.pointerId, x: event.clientX, width, latest: width };
                setResizing(true);
            },
            onPointerMove(event: PointerEvent<HTMLButtonElement>) {
                const start = drag.current;
                if (!start || start.id !== event.pointerId) return;
                start.latest = Math.min(max, Math.max(min, start.width + direction * (event.clientX - start.x)));
                setWidth(start.latest);
            },
            onLostPointerCapture(event: PointerEvent<HTMLButtonElement>) {
                const start = drag.current;
                if (!start || start.id !== event.pointerId) return;
                drag.current = null;
                setResizing(false);
                localStorage.setItem(storageKey, String(start.latest));
            },
        },
    };
}
