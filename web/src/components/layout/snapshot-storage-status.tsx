import { App, Button } from "antd";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "zustand";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAssetStore } from "@/stores/use-asset-store";

/** 只订阅三类元数据的共同状态字段，项目/素材 store 的结构差异不进入组件。 */
const selectStatus = (state: { hydrated: boolean; loadError: string | null; persistence: { dirty: boolean; saving: boolean; error: { message: string } | null; loadState: string } }) => ({
    hydrated: state.hydrated, loadError: state.loadError, dirty: state.persistence.dirty, saving: state.persistence.saving, error: state.persistence.error, loadState: state.persistence.loadState,
});

/** 订阅实际存储状态；重试只操作本地保存，不调用厂商。 */
export function SnapshotStorageStatus({ kind }: { kind: "projects" | "assets" }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const canvas = useStore(useCanvasStore, useShallow(selectStatus));
    const assets = useStore(useAssetStore, useShallow(selectStatus));
    const status = kind === "projects" ? canvas : assets;
    const editorDirty = useCanvasStore((state) => kind === "projects" && state.editorDirty);
    const error = status.loadError || status.error?.message;
    const retry = async () => {
        const store = kind === "projects" ? useCanvasStore : useAssetStore;
        try {
            const state = store.getState();
            await (status.hydrated ? state.retrySave() : state.load());
        } catch (failure) { message.error(failure instanceof Error ? failure.message : t("storage.failed")); }
    };
    return (
        <div role="status" className="flex min-w-0 items-center gap-2 text-xs" title={error || undefined}>
            <span className="truncate">{error || t(!status.hydrated ? "storage.loading" : status.saving ? "storage.saving" : status.dirty || editorDirty ? "storage.unsaved" : "storage.saved")}</span>
            {error ? <Button type="text" size="small" disabled={status.saving || status.loadState === "loading"} onClick={() => void retry()}>{t(status.hydrated ? "storage.retrySave" : "storage.reload")}</Button> : null}
        </div>
    );
}
