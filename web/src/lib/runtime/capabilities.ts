/**
 * 运行平台判断的唯一入口（M2.5 第②项）。
 *
 * 业务代码不要直接读 `__TAURI_INTERNALS__`；需要区分桌面/浏览器时从这里取。
 * 桌面版是唯一对外交付形态，浏览器只用于开发与自动检查。
 */
export type RuntimeTarget = "desktop" | "browser";

/** 桌面壳注入的标记；浏览器里不存在。模块加载时求值一次。 */
export const runtime: RuntimeTarget = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window ? "desktop" : "browser";

export const isDesktopApp = () => runtime === "desktop";
