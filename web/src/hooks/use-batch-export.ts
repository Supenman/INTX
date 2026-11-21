/**
 * 批量导出的执行层：取字节 → 打成一个 zip → 走「另存为」落盘。
 *
 * 为什么是 zip 而不是逐个文件下载：
 *  - 桌面版是唯一对外产品，`saveFile` 每调一次弹一次系统对话框，10 张图就是
 *    10 次确认，没人会用；
 *  - 浏览器那种「连续 a.click() 间隔 120ms」的写法在 Tauri WebView 里没有保险，
 *    也不受下载管理器管；
 *  - 打包成一个文件只弹一次对话框、只写一次盘，正好复用已经真机验过的
 *    「另存为」链路（dialog + fs:allow-write-file），不新增任何权限。
 *
 * 交付方拿到 zip 解开就是 `01_封面.png`、`02_…`，顺序与画布一致。
 */
import { App } from "antd";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { collectBatchExportFiles, planBatchExport, type BatchExportNode } from "@/domain/asset/batch-export";
import { saveFile } from "@/lib/runtime/save-file";
import { createZip } from "@/lib/zip";

/** 导出包的默认名：`canvas-export-20261121-1412.zip`，只含数字，不依赖界面语言。 */
function timestamp(date = new Date()) {
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

async function readMedia(url: string) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.blob();
}

export function useBatchExport() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [busy, setBusy] = useState(false);

    const run = useCallback(
        async (nodes: readonly BatchExportNode[]) => {
            if (busy) return;
            const items = planBatchExport(nodes);
            if (!items.length) {
                message.warning(t("canvas.batchExport.empty"));
                return;
            }

            setBusy(true);
            const hide = message.loading(t("canvas.batchExport.running", { count: items.length }), 0);
            try {
                const { files, failed } = await collectBatchExportFiles(items, readMedia);
                if (!files.length) {
                    message.error(t("canvas.batchExport.allFailed"));
                    return;
                }

                // 只剩一张能读时直接存图片本体，不套一层压缩包——用户要的就是那张图。
                const single = files.length === 1;
                const payload = single ? new Blob([files[0].data]) : await createZip(files);
                const outcome = await saveFile(payload, single ? files[0].name : `canvas-export-${timestamp()}.zip`);

                // 取消不提示：用户在系统对话框里主动放弃，不该被弹一句「已导出」。
                if (outcome.status === "saved") {
                    message.success(
                        failed.length
                            ? t("canvas.batchExport.partial", { ok: files.length, failed: failed.length })
                            : t("canvas.batchExport.done", { count: files.length }),
                    );
                } else if (outcome.status === "failed") {
                    console.error("批量导出失败", outcome.error);
                    message.error(t("canvas.batchExport.failed"));
                }
                if (failed.length) console.warn("批量导出：以下文件读取失败", failed);
            } catch (error) {
                console.error("批量导出异常", error);
                message.error(t("canvas.batchExport.failed"));
            } finally {
                hide();
                setBusy(false);
            }
        },
        [busy, message, t],
    );

    return { busy, run };
}
