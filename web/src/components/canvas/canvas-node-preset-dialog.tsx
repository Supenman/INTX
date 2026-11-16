import { useMemo } from "react";
import { Button, Modal } from "antd";
import { Camera, LayoutGrid, Package, Smile, UserSquare2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { imagePresetOptions, type ImagePresetId } from "@/lib/canvas/image-presets";

const PRESET_ICONS: Record<ImagePresetId, typeof Camera> = {
    "character-three-view": UserSquare2,
    "face-three-view": Smile,
    "product-three-view": Package,
    storyboard: LayoutGrid,
    "multi-camera": Camera,
};

/**
 * 预设选择：点一项就直接开始生成，不再多一步「确定」。
 * 三视图和分镜的差别（1 张 vs 4 张）写在卡片上，避免用户点完才发现要花四份钱。
 */
export function CanvasNodePresetDialog({ open, dataUrl, onClose, onConfirm }: { open: boolean; dataUrl: string; onClose: () => void; onConfirm: (id: ImagePresetId) => void }) {
    const { t, i18n } = useTranslation();
    // 语言切换后标题和张数文案要跟着变，所以把当前语言作为依赖。
    const options = useMemo(() => imagePresetOptions(), [i18n.language]);

    return (
        <Modal title={null} open={open && Boolean(dataUrl)} onCancel={onClose} footer={null} width={720} centered destroyOnHidden>
            <div className="space-y-5">
                <div className="flex items-start gap-4">
                    {dataUrl ? <img src={dataUrl} alt="" className="size-16 shrink-0 rounded-lg object-cover" draggable={false} /> : null}
                    <div className="min-w-0">
                        <h2 className="typ-heading text-foreground">{t("canvas.imagePresets.title")}</h2>
                        <p className="typ-caption mt-1 text-muted-foreground">{t("canvas.imagePresets.description")}</p>
                    </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                    {options.map((option, index) => {
                        const Icon = PRESET_ICONS[option.id];
                        // 五项是奇数，最后一项横跨两列，避免右边空出一大块。
                        const span = options.length % 2 === 1 && index === options.length - 1 ? "sm:col-span-2" : "";
                        return (
                            <button
                                key={option.id}
                                type="button"
                                className={`surface-card-interactive flex items-center gap-3 px-3 py-3 text-left ${span}`}
                                onClick={() => onConfirm(option.id)}
                            >
                                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-foreground/6">
                                    <Icon className="size-4" />
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block typ-body-compact font-medium text-foreground">{option.title}</span>
                                    <span className="mt-0.5 block typ-caption text-muted-foreground">
                                        {t("canvas.imagePresets.shots", { count: option.count })} · {option.size}
                                    </span>
                                </span>
                            </button>
                        );
                    })}
                </div>
                <div className="flex justify-end">
                    <Button onClick={onClose}>{t("canvas.editors.cancel")}</Button>
                </div>
            </div>
        </Modal>
    );
}
