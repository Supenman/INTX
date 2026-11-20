import { Button, Checkbox, Modal } from "antd";
import { RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { ToolbarId } from "@/domain";
import { defaultToolbarPrefs, getToolbarTools } from "@/domain";
import { useToolbarPrefs } from "@/hooks/use-toolbar-prefs";

/**
 * 工具栏自定义：只做「显示 / 隐藏」。
 *
 * 排序先不做——注册表的自动分隔线依赖 category 相邻关系，让用户随意拖顺序会让
 * 分隔线乱跳；要做排序得先给 ToolEntry 加显式的分组信息，那是另一件事。
 */

type Props = {
    open: boolean;
    onClose: () => void;
};

const GROUPS: Array<{ id: ToolbarId; titleKey: string }> = [
    { id: "main", titleKey: "toolbarPrefs.groupMain" },
    { id: "selection", titleKey: "toolbarPrefs.groupSelection" },
    { id: "node-hover", titleKey: "toolbarPrefs.groupNodeHover" },
    { id: "node-context-menu", titleKey: "toolbarPrefs.groupContextMenu" },
];

function GroupSection({ id, title }: { id: ToolbarId; title: string }) {
    const { t } = useTranslation();
    const { prefs, setPrefs } = useToolbarPrefs(id);
    const tools = getToolbarTools(id);
    const hidden = new Set(prefs.hidden);

    const toggle = (toolId: string, visible: boolean) => {
        const next = new Set(hidden);
        if (visible) next.delete(toolId);
        else next.add(toolId);
        setPrefs({ ...prefs, hidden: [...next] });
    };

    if (!tools.length) return null;

    return (
        <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
                <h3 className="typ-label text-muted-foreground">{title}</h3>
                <Button size="small" type="text" icon={<RotateCcw className="size-3.5" />} onClick={() => setPrefs(defaultToolbarPrefs(id))}>
                    {t("toolbarPrefs.reset")}
                </Button>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {tools.map((tool) => (
                    <label key={tool.id} className="flex cursor-pointer items-center gap-2 text-sm">
                        <Checkbox checked={!hidden.has(tool.id)} onChange={(event) => toggle(tool.id, event.target.checked)} />
                        <span className="truncate" title={tool.hint}>
                            {tool.labelKey ? t(tool.labelKey) : tool.label}
                        </span>
                        {tool.danger ? <span className="text-xs text-red-500">{t("toolbarPrefs.danger")}</span> : null}
                    </label>
                ))}
            </div>
        </section>
    );
}

export function ToolbarPrefsModal({ open, onClose }: Props) {
    const { t } = useTranslation();
    return (
        <Modal
            open={open}
            onCancel={onClose}
            title={t("toolbarPrefs.title")}
            footer={
                <Button type="primary" onClick={onClose}>
                    {t("common.done")}
                </Button>
            }
            width={640}
        >
            <p className="mb-4 text-xs text-muted-foreground">{t("toolbarPrefs.description")}</p>
            <div className="flex flex-col gap-5">
                {GROUPS.map((group) => (
                    <GroupSection key={group.id} id={group.id} title={t(group.titleKey)} />
                ))}
            </div>
        </Modal>
    );
}
