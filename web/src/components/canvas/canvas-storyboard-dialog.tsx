import { useEffect, useMemo, useState } from "react";
import { Button, Input, Modal } from "antd";
import { useTranslation } from "react-i18next";

import { storyboardLines } from "@/domain/node/storyboard";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

export function CanvasStoryboardDialog({ open, initialScript, referenceCount, onClose, onCreate }: {
    open: boolean;
    initialScript: string;
    referenceCount: number;
    onClose: () => void;
    onCreate: (script: string) => void;
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [script, setScript] = useState("");
    const lines = useMemo(() => storyboardLines(script), [script]);

    useEffect(() => {
        if (open) setScript(initialScript);
    }, [initialScript, open]);

    return <Modal
        destroyOnHidden
        open={open}
        onCancel={onClose}
        title={t("canvas.storyboard.entry")}
        width="min(680px, 92vw)"
        centered
        footer={<div className="flex items-center justify-between gap-3"><span className="text-xs opacity-60">{t("canvas.storyboard.shotCount", { count: lines.length })}</span><span className="flex gap-2"><Button onClick={onClose}>{t("common.cancel")}</Button><Button type="primary" disabled={!lines.length} onClick={() => onCreate(script)}>{t("canvas.storyboard.createShots", { count: lines.length })}</Button></span></div>}
    >
        <div className="space-y-3" style={{ color: theme.node.text }}>
            <p className="text-sm opacity-65">{t("canvas.storyboard.description")}</p>
            <Input.TextArea
                autoFocus
                value={script}
                onChange={(event) => setScript(event.target.value)}
                autoSize={{ minRows: 8, maxRows: 16 }}
                placeholder={t("canvas.storyboard.placeholder")}
            />
            <div className="flex flex-wrap justify-between gap-2 text-xs opacity-60">
                <span>{t("canvas.storyboard.lineRule")}</span>
                <span>{t("canvas.storyboard.referenceCount", { count: referenceCount })}</span>
            </div>
        </div>
    </Modal>;
}
