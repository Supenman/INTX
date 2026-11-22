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

/// 本地 ComfyUI 网关：把 ComfyUI 的节点协议翻译成 OpenAI 兼容接口，
/// INTX 只需按普通 OpenAI 渠道连它。随 INTX 启动、退出时回收。
#[derive(Default)]
struct ManagedLocalGateway(std::sync::Mutex<Option<std::process::Child>>);

const LOCAL_GATEWAY_URL: &str = "http://127.0.0.1:8190";

impl ManagedLocalGateway {
    fn start() -> Self {
        // 已在运行（用户自己起的，或上次的残留）→ 接管，不重复拉起，退出时也不归我们关
        if agent_is_listening(LOCAL_GATEWAY_URL) {
            return Self::default();
        }
        let Some(gateway_dir) = find_local_gateway_dir() else { return Self::default() };
        let entry = gateway_dir.join("src").join("server.js");
        if !entry.is_file() {
            return Self::default();
        }
        // 用系统 node：网关的 node_modules 由用户用系统 node 安装，版本必须一致
        let mut command = std::process::Command::new(if cfg!(windows) { "node.exe" } else { "node" });
        command
            .arg(&entry)
            .current_dir(&gateway_dir)
            .env("PORT", "8190")
            .env("HOST", "127.0.0.1")
            .env("COMFY_URL", "http://127.0.0.1:8188")
            .env("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
            // 随包节点由网关启动器首次安装；我们直连网关，不需要它再动 ComfyUI
            .env("DISABLE_NODE_BOOTSTRAP", "1")
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
                    if agent_is_listening(LOCAL_GATEWAY_URL) || child.try_wait().ok().flatten().is_some() {
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

/// 找网关目录：优先环境变量指定，其次安装目录旁与 resources 下。
/// 自用时把网关放在 INTX 安装目录旁边即可，无需任何配置。
fn find_local_gateway_dir() -> Option<std::path::PathBuf> {
    let mut candidates = Vec::new();
    if let Some(dir) = std::env::var_os("INTX_COMFY_GATEWAY_DIR") {
        candidates.push(std::path::PathBuf::from(dir));
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(parent) = executable.parent() {
            candidates.push(parent.join("comfyui-gateway"));
            candidates.push(parent.join("resources").join("comfyui-gateway"));
        }
    }
    candidates.into_iter().find(|dir| dir.join("src").join("server.js").is_file())
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            app.manage(ManagedCanvasAgent::start(app.handle()));
            app.manage(ManagedLocalGateway::start());
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
                if let Some(gateway) = app.try_state::<ManagedLocalGateway>() {
                    gateway.stop();
                }
            }
        });
}
