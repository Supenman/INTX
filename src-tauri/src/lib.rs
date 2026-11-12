//! INTX 桌面壳。
//!
//! 只做两件事：开一个窗口、挂上 fs 插件。业务数据（画布、任务、产物）
//! 全部由前端的 `ProjectRepository` / `TaskLog` / `BlobStore` 落到
//! `$APPDATA` 下，Rust 侧不重复实现一套存储，也不碰厂商请求。
//!
//! 权限不是全开：capabilities/default.json 只放行代码实际调用到的 7 个
//! fs 命令，scope 收在 `$APPDATA` 内。新增 fs 调用必须同步那里，
//! `pnpm test` 里的 tauriConfig.test.ts 会校验二者是否对齐。

// Release 包必须带 custom-protocol：缺了它 tauri::is_dev() 恒为 true，
// WebView 会去连 devUrl(http://127.0.0.1:7351) 而不是嵌入的前端资源，
// 装到真机上就是「嗯… 无法访问此页面 / ERR_CONNECTION_REFUSED」。
// Tauri CLI 的 `tauri build` 会自动加这个 feature，裸 cargo / cargo-xwin
// 不会（2026-11-13 真机踩过）。这里设编译期门禁，谁再漏就直接编不过。
#[cfg(all(not(debug_assertions), not(feature = "custom-protocol")))]
compile_error!(
    "release 构建必须启用 custom-protocol：cargo xwin build --release --features custom-protocol"
);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("启动 INTX 窗口失败");
}
