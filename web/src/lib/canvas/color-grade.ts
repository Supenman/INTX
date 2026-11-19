import type { CanvasNodeMetadata } from "@/types/canvas";

export const COLOR_GRADES = ["original", "warm", "cool", "monochrome", "vivid", "faded"] as const;
export type CanvasColorGrade = (typeof COLOR_GRADES)[number];

const FILTERS: Record<CanvasColorGrade, string> = {
    original: "none",
    warm: "sepia(0.22) saturate(1.15)",
    cool: "hue-rotate(175deg) saturate(0.72)",
    monochrome: "grayscale(1)",
    vivid: "saturate(1.4) contrast(1.08)",
    faded: "saturate(0.72) contrast(0.86) brightness(1.04)",
};

export function colorGradeFilter(grade?: CanvasNodeMetadata["colorGrade"]) {
    return FILTERS[grade || "original"];
}
