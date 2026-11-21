import { Button, Modal } from "antd";
import { Check, Star } from "lucide-react";
import { useTranslation } from "react-i18next";

import { previewUrlFor } from "@/services/image-storage";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export function CanvasVersionCompareModal({ open, versions, onClose, onSetPrimary, onFocus }: { open: boolean; versions: CanvasNodeData[]; onClose: () => void; onSetPrimary: (nodeId: string) => void; onFocus: (nodeId: string) => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const width = Math.min(1180, Math.max(560, 112 + versions.length * 340));
    return (
        <Modal title={t("canvas.versionCompare.title")} open={open} onCancel={onClose} footer={null} width={width} destroyOnHidden>
            {versions.length === 0 ? <div className="rounded-lg border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">{t("canvas.versionCompare.empty")}</div> : null}
            <div className="thin-scrollbar flex max-h-[70vh] gap-3 overflow-x-auto pb-2">
                {versions.map((node) => {
                    const primary = Boolean(node.metadata?.versionPrimary);
                    const content = node.metadata?.content || node.metadata?.images?.find((image) => image.content)?.content;
                    const src = node.metadata?.storageKey ? previewUrlFor(node.metadata.storageKey) || content : content;
                    return (
                        <article key={node.id} className="flex w-[328px] shrink-0 flex-col overflow-hidden rounded-lg border" style={{ borderColor: primary ? theme.node.activeStroke : theme.node.stroke, background: theme.node.panel, boxShadow: primary ? `0 0 0 2px ${theme.toolbar.activeBg}` : undefined }}>
                            <div className="flex h-11 items-center justify-between gap-2 border-b px-3" style={{ borderColor: theme.node.stroke }}>
                                <div className="flex min-w-0 items-center gap-2">
                                    <span className="grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold" style={{ background: primary ? theme.toolbar.activeBg : theme.toolbar.itemHover, borderColor: primary ? theme.node.activeStroke : theme.node.stroke, color: primary ? theme.node.activeStroke : theme.node.text }}>{node.metadata?.versionLabel || "-"}</span>
                                    <span className="truncate text-xs font-medium" title={node.title} style={{ color: theme.node.text }}>{node.title}</span>
                                </div>
                                {primary ? <span className="inline-flex shrink-0 items-center gap-1 text-xs" style={{ color: theme.node.activeStroke }}><Check className="size-3" />{t("canvas.versionCompare.currentPrimary")}</span> : null}
                            </div>
                            <button type="button" className="block h-52 w-full overflow-hidden" style={{ background: theme.node.fill }} title={t("canvas.versionCompare.focus")} onClick={() => onFocus(node.id)}>
                                {node.type === CanvasNodeType.Image && src ? <img src={src} alt={node.title || t("canvas.versionCompare.imageAlt")} className="size-full object-contain" /> : node.type === CanvasNodeType.Video && src ? <video src={src} muted preload="metadata" className="size-full object-contain" /> : <span className="grid size-full place-items-center px-4 text-center text-xs text-muted-foreground">{t("canvas.versionCompare.focus")}</span>}
                            </button>
                            <div className="space-y-2 p-3 text-xs">
                                <Info label={t("canvas.versionCompare.model")} value={node.metadata?.model || "—"} />
                                <Info label={t("canvas.versionCompare.size")} value={node.metadata?.size || "—"} />
                                <div><div className="opacity-45">{t("canvas.versionCompare.prompt")}</div><div className="mt-1 line-clamp-5 whitespace-pre-wrap break-words leading-5" style={{ color: theme.node.text }}>{node.metadata?.composerContent || node.metadata?.prompt || "—"}</div></div>
                                <Button block size="small" type={primary ? "default" : "primary"} disabled={primary} icon={<Star className="size-3.5" />} onClick={() => onSetPrimary(node.id)}>{primary ? t("canvas.versionCompare.currentPrimary") : t("canvas.versionCompare.setPrimary")}</Button>
                            </div>
                        </article>
                    );
                })}
            </div>
        </Modal>
    );
}

function Info({ label, value }: { label: string; value: string }) {
    return <div className="flex min-w-0 items-center gap-3"><span className="w-10 shrink-0 opacity-60">{label}</span><span className="min-w-0 flex-1 truncate text-right font-medium" title={value}>{value}</span></div>;
}
