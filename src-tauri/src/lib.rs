//! INTX 桌面壳。
//!
//! 只做两件事：开一个窗口、挂上 fs 插件。业务数据（画布、任务、产物）
//! 全部由前端的 `ProjectRepository` / `TaskLog` / `BlobStore` 落到
//! `$APPDATA` 下，Rust 侧不重复实现一套存储，也不碰厂商请求。
//!
//! 权限不是全开：capabilities/default.json 只放行代码实际调用到的 7 个
//! fs 命令，scope 收在 `$APPDATA` 内。新增 fs 调用必须同步那里，
//! `pnpm test` 里的 tauriConfig.test.ts 会校验二者是否对齐。

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("启动 INTX 窗口失败");
}
