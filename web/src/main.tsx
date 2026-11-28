import React from "react";
import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";
import "streamdown/styles.css";
import "./styles/globals.css";
import { RouterProvider } from "react-router-dom";

import { AppProviders } from "@/components/layout/app-providers";
import { installBuiltinTools } from "@/domain";
import "@/i18n";
import { initAnalytics } from "@/lib/analytics";
import { hydrateChannelSecrets, syncChannelSecrets } from "@/lib/channel-secrets";
import { useConfigStore } from "@/stores/use-config-store";
import { router } from "@/router";

initAnalytics();
// 同步安装：解析成空的注册表会让首帧工具栏消失，必须赶在 render 之前。
installBuiltinTools();
void hydrateChannelSecrets();
useConfigStore.subscribe((state, prev) => {
    if (state.config.channels !== prev.config.channels) {
        void syncChannelSecrets(state.config.channels);
    }
});

document.body.style.fontFamily = '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif';

createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <AppProviders>
            <RouterProvider router={router} />
        </AppProviders>
    </React.StrictMode>,
);
