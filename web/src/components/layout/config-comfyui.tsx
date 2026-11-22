import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "antd";

export function ConfigComfyUI() {
    const [checked, setChecked] = useState(false);
    const [status, setStatus] = useState("");
    const [busy, setBusy] = useState(false);

    async function run(action: () => Promise<void>) {
        setBusy(true);
        setChecked(true);
        setStatus("");
        try {
            await action();
        } catch (error) {
            setStatus(String(error));
        } finally {
            setBusy(false);
        }
    }

    return (
        <section className="surface-card mt-5 space-y-3 p-5" aria-label="本地 ComfyUI">
            <h2 className="text-base font-semibold">本地 ComfyUI</h2>
            <p>INTX 会自动连接本机 ComfyUI（127.0.0.1:8188）并启动内置网关。</p>
            <Button
                disabled={busy}
                onClick={() =>
                    void run(async () => {
                        const result = await invoke<{ comfy: boolean; gateway: boolean }>("check_comfy_connections");
                        setStatus(`ComfyUI：${result.comfy ? "可连接" : "连接失败"}。INTX 网关：${result.gateway ? "可连接" : "连接失败"}。`);
                    })
                }
            >
                测试连接
            </Button>
            {checked && <p role="status">{status}</p>}
        </section>
    );
}
