import { APP_VERSION } from "@/constant/env";
import { runtime } from "@/lib/runtime/capabilities";
import { saveFile, type SaveFileOutcome } from "@/lib/runtime/save-file";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAssetStore } from "@/stores/use-asset-store";

export type DiagnosticEntry = {
    time: string;
    source: string;
    message: string;
    stack?: string;
};

const MAX_ENTRIES = 200;
const entries: DiagnosticEntry[] = [];
let installed = false;

function redactSecrets(text: string) {
    return text
        .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
        .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-[REDACTED]");
}

export function recordDiagnosticError(source: string, error: unknown) {
    const rawMessage = error instanceof Error ? error.message : typeof error === "string" ? error : String(error ?? "Unknown error");
    const rawStack = error instanceof Error ? error.stack : undefined;
    entries.push({
        time: new Date().toISOString(),
        source,
        message: redactSecrets(rawMessage).slice(0, 600),
        ...(rawStack ? { stack: redactSecrets(rawStack).slice(0, 2000) } : {}),
    });
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
}

export function installGlobalErrorCapture() {
    if (installed || typeof window === "undefined") return;
    installed = true;
    window.addEventListener("error", (event) => {
        recordDiagnosticError("window.error", event.error ?? event.message);
    });
    window.addEventListener("unhandledrejection", (event) => {
        recordDiagnosticError("window.unhandledrejection", event.reason);
    });
}

export function readDiagnosticEntries(): readonly DiagnosticEntry[] {
    return entries;
}

export async function exportDiagnosticsReport(): Promise<SaveFileOutcome> {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    const payload = {
        app: "INTX",
        version: APP_VERSION,
        runtime,
        exportedAt: now.toISOString(),
        note: "INTX 前端运行诊断日志；已自动脱敏，不含 API Key 与画布内容。",
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
        summary: {
            projects: useCanvasStore.getState().projects.length,
            assets: useAssetStore.getState().assets.length,
            errorCount: entries.length,
        },
        errors: entries,
    };
    return saveFile(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" }), `intx-diagnostics-${stamp}.json`);
}
