//! INTX 桌面壳。
//!
//! 只做一件事：开一个窗口加载嵌入的前端资源。画布、任务台账、素材
//! 全部由前端落到 IndexedDB / localforage，Rust 侧不重复实现存储，
//! 也不代理厂商请求。
//!
//! Release 包必须带 custom-protocol：缺了它 tauri::is_dev() 恒为 true，
//! WebView 会去连 devUrl(http://localhost:3000) 而不是嵌入的前端资源，
//! 装到真机上就是 ERR_CONNECTION_REFUSED（旧 INTX 2026-11-13 真机踩过）。
//!
//! 不能用 cfg(feature = "custom-protocol") 做编译期门禁：Tauri CLI 传的是
//! `--features tauri/custom-protocol`（依赖的 feature），我们自己的 feature
//! 不会被打开，门禁会把正常打包挡掉。改成启动前检查，裸 cargo build
//! --release 打出来的包一运行就会给出明确报错。

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if !cfg!(debug_assertions) && tauri::is_dev() {
        panic!("release 包缺少 custom-protocol：请用 `pnpm tauri:build`，不要裸 cargo build --release");
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("启动 INTX 窗口失败");
}
