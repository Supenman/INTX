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

#[derive(serde::Serialize)]
struct AgentConfig {
    url: String,
    token: String,
}

/// 读取本地 Canvas Agent 启动时写入的地址与 token。
///
/// Agent 把这份配置落在 `~/.infinite-canvas/canvas-agent.json`。桌面版必须
/// 自己读它：桌面界面只给「连接」按钮，没有手填地址与 token 的入口（那是
/// 浏览器通道才有的降级路径）。所以缺了这个命令，桌面版永远连不上 Agent，
/// 而界面只会显示「没有发现本地 Agent」——把「没实现」伪装成「没启动」。
///
/// 文件不存在、JSON 坏掉、字段缺失或为空，一律返回 None，让前端给
/// 「请先启动 Canvas Agent」的提示，而不是抛错。
#[tauri::command]
fn read_agent_config() -> Option<AgentConfig> {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
    let path = std::path::PathBuf::from(home)
        .join(".infinite-canvas")
        .join("canvas-agent.json");
    let text = std::fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    let url = value.get("url")?.as_str()?.trim().to_string();
    let token = value.get("token")?.as_str()?.trim().to_string();
    if url.is_empty() || token.is_empty() {
        return None;
    }
    Some(AgentConfig { url, token })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if !cfg!(debug_assertions) && tauri::is_dev() {
        panic!("release 包缺少 custom-protocol：请用 `pnpm tauri:build`，不要裸 cargo build --release");
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![read_agent_config])
        .run(tauri::generate_context!())
        .expect("启动 INTX 窗口失败");
}
