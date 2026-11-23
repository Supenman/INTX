import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import wasm from "vite-plugin-wasm";

import { parseChangelog } from "./src/lib/release";

const webDir = dirname(fileURLToPath(import.meta.url));
const localVersion = readFileSync(resolve(webDir, "../VERSION"), "utf8").trim() || "dev";
const localChangelog = readFileSync(resolve(webDir, "../CHANGELOG.md"), "utf8");

// Expose /plugins/index.json with local plugin files from public/plugins.
// The frontend can discover and list them when enabled; development reads the directory live, while builds emit a static registry.
function localPluginsManifest(): Plugin {
    const pluginsDir = resolve(webDir, "public/plugins");
    const listLocalPlugins = () => {
        try {
            return readdirSync(pluginsDir)
                .filter((file) => file.endsWith(".js"))
                .sort()
                .map((file) => `/plugins/${file}`);
        } catch {
            return [];
        }
    };
    return {
        name: "local-plugins-manifest",
        configureServer(server) {
            server.middlewares.use("/plugins/index.json", (_req, res) => {
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify(listLocalPlugins()));
            });
        },
        generateBundle() {
            this.emitFile({ type: "asset", fileName: "plugins/index.json", source: JSON.stringify(listLocalPlugins()) });
        },
    };
}

function windowsDesktopStyles(): Plugin {
    return {
        name: "windows-desktop-styles",
        apply: "build",
        transformIndexHtml: {
            order: "post",
            handler(html, { bundle }) {
                if (!bundle) return html;
                // WebView2 can render the app without its external stylesheet when loaded from Tauri's asset origin.
                let inlined = false;
                const result = html.replace(/<link\s+[^>]*>/gi, (tag) => {
                    if (!/\brel="stylesheet"/i.test(tag)) return tag;
                    const href = /\bhref="([^"]+)"/i.exec(tag)?.[1];
                    if (!href) return tag;
                    const asset = Object.values(bundle).find((item) => href.endsWith(`/${item.fileName}`));
                    if (asset?.type !== "asset" || typeof asset.source !== "string" || !asset.fileName.endsWith(".css")) return tag;
                    inlined = true;
                    return `<style>${asset.source.replace(/<\/style/gi, "<\\/style")}</style>`;
                });
                if (!inlined) throw new Error("Windows desktop build could not embed the app stylesheet");
                return result;
            },
        },
    };
}

export default defineConfig({
    base: process.env.VITE_BASE || "/",
    plugins: [react(), wasm(), localPluginsManifest(), ...(process.env.TAURI_ENV_PLATFORM === "windows" ? [windowsDesktopStyles()] : [])],
    // 允许通过反向代理域名访问 dev server（仅开发期生效，不影响生产构建）。
    server: {
        host: "0.0.0.0",
        allowedHosts: true,
        // 部署平台会注入 PORT；本地开发没有该变量时回落到 5173。
        port: Number(process.env.PORT) || 5173,
    },
    resolve: {
        alias: {
            "@": resolve(webDir, "src"),
        },
    },
    define: {
        __APP_VERSION__: JSON.stringify(localVersion),
        __APP_RELEASES__: JSON.stringify(parseChangelog(localChangelog)),
    },
    build: { target: "esnext" },
});
