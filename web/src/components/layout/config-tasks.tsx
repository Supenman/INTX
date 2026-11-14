import { App, Button } from "antd";
import dayjs from "dayjs";
import { ClipboardCheck, Copy, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Task } from "@/domain/task/model";
import { useCopyText } from "@/hooks/use-copy-text";
import { browserModelScopeTransport } from "@/services/api/modelscope-transport";
import { pollVideoGenerationTask, storeGeneratedVideo } from "@/services/api/video";
import { browserTaskLog, commitRecovered, forgetPendingCommit, forgetRecoveredAssets, loadTaskLog, recoveredAssetIds, rememberPendingCommit, rememberRecoveredAssets, retryTaskSave, pollModelScopeTask, resumableTasks, useTaskLogStore, videoHandleFromTask } from "@/services/generation";
import { pickModelScopeChannel, recoveryAction, type RecoveryChannelView } from "@/services/generation/taskRecovery";
import { uploadImage } from "@/services/image-storage";
import { useAssetStore } from "@/stores/use-asset-store";
import { useConfigStore } from "@/stores/use-config-store";

/**
 * 待核实任务：上游已收单、本地没拿到产物的单子。
 *
 * 这里只有「查单」和「复制任务号」，**没有重发**——旧单去厂商后台按任务号核对，
 * 重新提交就是再买一张。主台账已确认的任务号刷新后仍在；主台账写失败时，
 * 2.2b 的本机证据会在重启后还原成「只重试本地保存」，同样不允许重发。
 * 2.2c-1：产物已取回并确认保存后落盘证据，任务核销前重启只会「补写任务记录」，
 * 不重新查单、不下载、不重复创建素材。
 */
export function ConfigTasks() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const copyText = useCopyText();
    const tasks = useTaskLogStore((state) => state.tasks);
    const unsaved = useTaskLogStore((state) => state.unsaved);
    const loading = useTaskLogStore((state) => state.loading);
    const hydrated = useTaskLogStore((state) => state.hydrated);
    const loadError = useTaskLogStore((state) => state.loadError);
    const pendingCommits = useTaskLogStore((state) => state.pendingCommits);
    useTaskLogStore((state) => state.inFlightIds);
    useEffect(() => { void loadTaskLog(); }, []);
    const config = useConfigStore((state) => state.config);
    const addAsset = useAssetStore((state) => state.addAsset);
    const [busyId, setBusyId] = useState("");
    const modelscopeChannel = pickModelScopeChannel(config.channels);
    const pending = resumableTasks(tasks).filter((task) => !unsaved[task.id]);
    const savePending = async (id: string) => {
        if (busyId) return;
        setBusyId(id);
        try { await retryTaskSave(id); }
        catch (error) { message.error(error instanceof Error ? error.message : t("config.tasks.queryFailed")); }
        finally { setBusyId(""); }
    };

    const titleOf = (task: Task) => task.params.prompt.slice(0, 32) || task.params.model;

    const saveImageAssets = async (task: Task, images: readonly { dataUrl: string }[]) => {
        const assetIds: string[] = [];
        for (const image of images) {
            const uploaded = await uploadImage(image.dataUrl);
            assetIds.push(
                addAsset({
                    kind: "image",
                    title: titleOf(task),
                    coverUrl: uploaded.url,
                    tags: [],
                    source: t("config.tasks.source"),
                    // 和画布「保存到素材」一致：有 storageKey 就不把 blob 地址再写进 dataUrl。
                    data: { dataUrl: uploaded.storageKey ? "" : uploaded.url, storageKey: uploaded.storageKey, width: uploaded.width, height: uploaded.height, bytes: uploaded.bytes, mimeType: uploaded.mimeType },
                    metadata: { source: "task-recovery", taskId: task.id, upstreamRef: task.upstreamRef },
                }),
            );
        }
        return assetIds;
    };

    const recoverImage = async (task: Task, channel: RecoveryChannelView | null) => {
        if (!channel || !task.upstreamRef) return null;
        const images = await pollModelScopeTask(browserModelScopeTransport, { baseUrl: channel.baseUrl, apiKey: channel.apiKey }, task.upstreamRef);
        return saveImageAssets(task, images);
    };

    const recoverVideo = async (task: Task) => {
        const handle = videoHandleFromTask(task);
        if (!handle) return null;
        const state = await pollVideoGenerationTask(config, handle);
        if (state.status === "pending") {
            message.info(t("config.tasks.stillRunning"));
            return null;
        }
        if (state.status === "failed") throw new Error(state.error);
        const stored = await storeGeneratedVideo(state.result);
        const assetId = addAsset({
            kind: "video",
            title: titleOf(task),
            coverUrl: "",
            tags: [],
            source: t("config.tasks.source"),
            data: { url: stored.url, storageKey: stored.storageKey, width: stored.width || 0, height: stored.height || 0, bytes: stored.bytes, mimeType: stored.mimeType },
            metadata: { source: "task-recovery", taskId: task.id, upstreamRef: task.upstreamRef },
        });
        return [assetId];
    };

    const query = async (task: Task) => {
        const action = recoveryAction(task, modelscopeChannel);
        if (busyId || unsaved[task.id]) return;
        const pendingCommit = pendingCommits[task.id];
        const commitOnly = Boolean(pendingCommit && pendingCommit.upstreamRef === (task.upstreamRef ?? ""));
        // 补写任务记录不需要查单协议，所以 manual 只在没有落盘证据时才拦住。
        if (!commitOnly && action === "manual") return;
        setBusyId(task.id);
        try {
            if (commitOnly && pendingCommit) {
                // 2.2c-1：产物已取回并确认落盘，只补写任务记录，不查单、不下载、不创建素材。
                await useAssetStore.getState().load();
                const assets = useAssetStore.getState().assets;
                if (pendingCommit.assetIds.some((id) => !assets.some((asset) => asset.id === id))) {
                    message.error(t("config.tasks.recoveredAssetsMissing"));
                    return;
                }
                const fresh = await browserTaskLog.get(task.id);
                if (!fresh || fresh.upstreamRef !== pendingCommit.upstreamRef) throw new Error(t("config.tasks.queryFailed"));
                await commitRecovered(browserTaskLog, fresh, pendingCommit.assetIds);
                forgetPendingCommit(task.id);
                message.success(t("config.tasks.recovered", { count: pendingCommit.assetIds.length }));
                return;
            }
            const known = recoveredAssetIds(task.id, task.upstreamRef);
            const reusable = known.length > 0 && known.every((id) => useAssetStore.getState().assets.some((asset) => asset.id === id));
            if (known.length && !reusable) forgetRecoveredAssets(task.id);
            const assetIds = reusable ? known : action === "modelscope" ? await recoverImage(task, modelscopeChannel) : await recoverVideo(task);
            if (!assetIds) return;
            if (!reusable) rememberRecoveredAssets(task.id, task.upstreamRef, assetIds);
            try {
                await useAssetStore.getState().confirmSave();
            } catch (error) {
                message.error(t("config.tasks.assetSaveFailed", { message: error instanceof Error ? error.message : t("config.tasks.queryFailed") }));
                return;
            }
            // 2.2c-1：素材元数据已确认，落盘「产物已取回」证据；写失败只退回进程内存，不中断。
            await rememberPendingCommit({ taskId: task.id, upstreamRef: task.upstreamRef ?? "", assetIds: [...assetIds], savedAt: Date.now() });
            try {
                const fresh = await browserTaskLog.get(task.id);
                if (!fresh) throw new Error(t("config.tasks.queryFailed"));
                await commitRecovered(browserTaskLog, fresh, assetIds);
                // 任务已核销：清内存证据并清磁盘证据，下次启动不会重复补写。
                forgetPendingCommit(task.id);
            } catch (error) {
                message.error(t("config.tasks.taskSaveFailed", { message: error instanceof Error ? error.message : t("config.tasks.queryFailed") }));
                return;
            }
            message.success(t("config.tasks.recovered", { count: assetIds.length }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("config.tasks.queryFailed"));
        } finally {
            setBusyId("");
        }
    };

    return (
        <div>
            <div className="mb-4 text-xs text-stone-500">{t("config.tasks.description")}</div>
            {loadError ? (
                <div role="alert" className="mb-3 text-sm">
                    {loadError} <Button size="small" onClick={() => void loadTaskLog()}>{t("config.tasks.reload")}</Button>
                </div>
            ) : null}
            {Object.values(unsaved).map(({ evidence: task, error }) => (
                <div key={task.id} role="alert" className="mb-2 rounded-lg border border-stone-200 px-4 py-3 dark:border-stone-800">
                    <div className="text-sm font-semibold">{task.params.model} · {t("config.tasks.unsaved")}</div>
                    <div className="mt-1 text-xs">{error} · {task.error?.message}</div>
                    <div className="mt-2 flex gap-2">
                        {task.upstreamRef ? <Button size="small" onClick={() => copyText(task.upstreamRef!)}>{task.upstreamRef}</Button> : null}
                        <Button size="small" disabled={Boolean(busyId)} onClick={() => void savePending(task.id)}>{t("config.tasks.retrySave")}</Button>
                    </div>
                </div>
            ))}
            {pending.length ? (
                <div className="space-y-2">
                    {pending.map((task) => {
                        const action = recoveryAction(task, modelscopeChannel);
                        const pendingCommit = pendingCommits[task.id];
                        const commitOnly = Boolean(pendingCommit && pendingCommit.upstreamRef === (task.upstreamRef ?? ""));
                        return (
                            <div key={task.id} className="rounded-lg border border-stone-200 px-4 py-3 dark:border-stone-800">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="truncate text-sm font-semibold">
                                            {t(`config.tasks.kind.${task.kind}`)} · {task.params.model || t("config.tasks.unknownModel")}
                                        </div>
                                        <div className="mt-1 truncate text-xs text-stone-500">{task.params.prompt || "—"}</div>
                                        <div className="mt-1 text-xs text-stone-500">
                                            {dayjs(task.createdAt).format("MM-DD HH:mm")} · {task.error?.message || t("config.tasks.runningHint")}
                                        </div>
                                        {commitOnly ? (
                                            <div className="mt-1 text-xs text-stone-500">{t("config.tasks.recoveredHint")}</div>
                                        ) : null}
                                    </div>
                                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                                        <Button size="small" icon={<Copy className="size-3.5" />} onClick={() => copyText(task.upstreamRef || "", t("config.tasks.copied"))}>
                                            {task.upstreamRef || "—"}
                                        </Button>
                                        <Button size="small" type="primary" icon={commitOnly ? <ClipboardCheck className="size-3.5" /> : <RefreshCw className="size-3.5" />} disabled={(action === "manual" && !commitOnly) || Boolean(busyId) || !hydrated || Boolean(loadError)} loading={busyId === task.id} onClick={() => void query(task)}>
                                            {commitOnly ? t("config.tasks.commitOnly") : t("config.tasks.query")}
                                        </Button>
                                    </div>
                                </div>
                                {action === "manual" && !commitOnly ? (
                                    <div className="mt-2 text-xs text-stone-500">
                                        {task.params.extras?.endpoint === "modelscope" ? t("config.tasks.noModelscopeChannel") : t("config.tasks.manual")}
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}
                </div>
            ) : hydrated && !loading && !loadError && !Object.keys(unsaved).length ? (
                <div className="rounded-lg border border-dashed border-stone-300 px-4 py-8 text-center text-sm text-stone-500 dark:border-stone-700">
                    <ClipboardCheck className="mx-auto mb-2 size-5" />
                    {t("config.tasks.empty")}
                </div>
            ) : loading ? <div>{t("config.tasks.loading")}</div> : null}
            <div className="mt-4 text-xs text-stone-500">{t("config.tasks.footer")}</div>
        </div>
    );
}
