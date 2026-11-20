export const APP_VERSION = __APP_VERSION__ || "dev";

export const DOCS_URL = import.meta.env.VITE_DOC_URL || "https://docs.canvas.best";

// Official plugin registry URL: CI publishes to plugins-dist for jsDelivr delivery; an environment variable may override it for self-hosting.
// 默认指向本仓库自己的 plugins-dist 分支（产物由 plugins/canvas/registry 构建，
// CI 在打 tag 时刷新）。原来指向上游 basketikun 的清单 —— 那会让用户装上别人的插件。
//
// 注意：jsDelivr 只服务公开仓库。仓库转公开前这里会 404，插件市场显示
// 「清单拉取失败 (404)」，这是有意的：报错比静默装上游插件安全。
// 部署时可用 VITE_PLUGIN_REGISTRY_URL 覆盖。
export const PLUGIN_REGISTRY_URL = import.meta.env.VITE_PLUGIN_REGISTRY_URL || "https://cdn.jsdelivr.net/gh/Supenman/INTX@plugins-dist/official-plugins.json";

export const REPO_URL = "https://github.com/Supenman/INTX";
