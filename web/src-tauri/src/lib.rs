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
//!
//! 唯一的数据读取是本地 Agent 的连接配置：桌面版要自己连上 canvas-agent，
//! 不能让用户每次填地址和 token，配置由 Agent 写在 `~/.infinite-canvas/canvas-agent.json`。

use std::path::PathBuf;

#[derive(serde::Serialize)]
struct LocalAgentConfig {
    url: String,
    token: String,
}

/// 读取本地 Canvas Agent 配置；文件不存在时返回 null，前端按「没有 Agent」处理。
#[tauri::command]
fn read_agent_config() -> Option<LocalAgentConfig> {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))?;
    let raw = std::fs::read_to_string(PathBuf::from(home).join(".infinite-canvas").join("canvas-agent.json")).ok()?;
    let value: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let url = value.get("url")?.as_str()?.to_string();
    let token = value.get("token")?.as_str()?.to_string();
    (!url.is_empty() && !token.is_empty()).then_some(LocalAgentConfig { url, token })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if !cfg!(debug_assertions) && tauri::is_dev() {
        panic!("release 包缺少 custom-protocol：请用 `pnpm tauri:build`，不要裸 cargo build --release");
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![read_agent_config])
        .run(tauri::generate_context!())
        .expect("启动 INTX 窗口失败");
}
