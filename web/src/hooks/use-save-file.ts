import { App } from "antd";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { saveFile, type SaveFileInput, type SaveFileOutcome } from "@/lib/runtime/save-file";

/**
 * 保存结果提示的唯一入口：取消不提示，失败明确报错，成功才说成功。
 * 桌面端把落盘路径一起显示，用户能自己核对文件到底在哪。
 */
export function useSaveNotice() {
    const { message } = App.useApp();
    const { t } = useTranslation();

    return useCallback(
        (outcome: SaveFileOutcome) => {
            if (outcome.status === "saved") {
                message.success(outcome.path ? t("common.savedTo", { path: outcome.path }) : t("common.saved"));
            } else if (outcome.status === "failed") {
                console.error("保存文件失败", outcome.error);
                message.error(t("common.saveFailed"));
            }
            return outcome;
        },
        [message, t],
    );
}

/** 一步到位的保存：选位置 → 写盘 → 按结果提示。 */
export function useSaveFile() {
    const notice = useSaveNotice();
    return useCallback(async (data: SaveFileInput, fileName: string) => notice(await saveFile(data, fileName)), [notice]);
}
