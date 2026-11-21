//! INTX 桌面壳与本地 Canvas Agent 进程管理。
//!
//! 画布、任务台账和素材由前端落到 IndexedDB / localforage。桌面壳负责
//! 加载嵌入的前端资源，并启动、回收随应用打包的本地 Canvas Agent；不代理厂商请求。
//!
//! Release 包必须带 custom-protocol：缺了它 tauri::is_dev() 恒为 true，
//! WebView 会去连 devUrl(http://localhost:3000) 而不是嵌入的前端资源，
//! 装到真机上就是 ERR_CONNECTION_REFUSED（旧 INTX 2026-11-13 真机踩过）。
//!
//! 不能用 cfg(feature = "custom-protocol") 做编译期门禁：Tauri CLI 传的是
//! `--features tauri/custom-protocol`（依赖的 feature），我们自己的 feature
//! 不会被打开，门禁会把正常打包挡掉。改成启动前检查，裸 cargo build
//! --release 打出来的包一运行就会给出明确报错。

use tauri::Manager;

#[derive(serde::Serialize)]
struct AgentConfig {
    url: String,
    token: String,
}

#[derive(Default)]
struct ManagedCanvasAgent(std::sync::Mutex<Option<std::process::Child>>);

impl ManagedCanvasAgent {
    fn start(app: &tauri::AppHandle) -> Self {
        if let Some(config) = read_agent_config() {
            if agent_is_listening(&config.url) {
                return Self::default();
            }
        }
        let Some(runtime) = find_agent_runtime(app) else { return Self::default() };
        let node_dir = runtime.join("node");
        let agent_dir = runtime.join("canvas-agent");
        let node = node_dir.join(if cfg!(windows) { "node.exe" } else { "node" });
        let entry = agent_dir.join("dist").join("index.js");
        if !node.is_file() || !entry.is_file() {
            return Self::default();
        }
        let mut search_paths = vec![node_dir];
        if let Some(path) = std::env::var_os("PATH") {
            search_paths.extend(std::env::split_paths(&path));
        }
        let Ok(path) = std::env::join_paths(search_paths) else { return Self::default() };
        let mut command = std::process::Command::new(node);
        command
            .arg(entry)
            .current_dir(agent_dir)
            .env("PATH", path)
            .env_remove("PORT")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        match command.spawn() {
            Ok(mut child) => {
                for _ in 0..50 {
                    if read_agent_config().is_some_and(|config| agent_is_listening(&config.url)) || child.try_wait().ok().flatten().is_some() {
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
                Self(std::sync::Mutex::new(Some(child)))
            }
            Err(_) => Self::default(),
        }
    }

    fn stop(&self) {
        let Ok(mut process) = self.0.lock() else { return };
        let Some(mut child) = process.take() else { return };
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let _ = std::process::Command::new("taskkill")
                .args(["/PID", &child.id().to_string(), "/T", "/F"])
                .creation_flags(0x08000000)
                .status();
        }
        #[cfg(not(windows))]
        {
            let _ = child.kill();
        }
        let _ = child.wait();
    }
}

fn find_agent_runtime(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(resources) = app.path().resource_dir() {
        candidates.push(resources.join("canvas-agent-runtime"));
        candidates.push(resources.join("resources").join("canvas-agent-runtime"));
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(parent) = executable.parent() {
            candidates.push(parent.join("resources").join("canvas-agent-runtime"));
            candidates.push(parent.join("canvas-agent-runtime"));
        }
    }
    candidates.push(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/canvas-agent-runtime"));
    candidates.into_iter().find(|runtime| {
        runtime.join("canvas-agent").join("dist").join("index.js").is_file()
            && runtime.join("node").join(if cfg!(windows) { "node.exe" } else { "node" }).is_file()
    })
}

/// 读取本地 Canvas Agent 启动时写入的地址与 token。
///
/// Agent 把这份配置落在 `~/.infinite-canvas/canvas-agent.json`。桌面版启动时
/// 管理本地 Agent 进程，并读取该配置连接服务；浏览器通道仍可手动填写地址与 token。
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

fn agent_is_listening(url: &str) -> bool {
    use std::net::{TcpStream, ToSocketAddrs};
    let Some(authority) = url.strip_prefix("http://").and_then(|value| value.split('/').next()) else { return false };
    let Ok(address) = authority.to_socket_addrs() else { return false };
    address.into_iter().any(|address| TcpStream::connect_timeout(&address, std::time::Duration::from_millis(150)).is_ok())
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
        .setup(|app| {
            app.manage(ManagedCanvasAgent::start(app.handle()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![read_agent_config])
        .build(tauri::generate_context!())
        .expect("启动 INTX 窗口失败")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(agent) = app.try_state::<ManagedCanvasAgent>() {
                    agent.stop();
                }
            }
        });
}
