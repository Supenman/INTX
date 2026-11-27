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

mod updater;

use tauri::Manager;

#[derive(serde::Serialize)]
struct AgentConfig {
    url: String,
    token: String,
}

#[derive(Default)]
pub(crate) struct ManagedCanvasAgent(std::sync::Mutex<Option<std::process::Child>>);

impl ManagedCanvasAgent {
    fn start(app: &tauri::AppHandle) -> Self {
        launch_log(app, "[agent] start() begin");
        if let Some(config) = read_agent_config() {
            if agent_is_listening(&config.url) {
                launch_log(app, "[agent] already listening, adopt");
                return Self::default();
            }
        }
        let Some(runtime) = find_agent_runtime(app).map(plain_path) else {
            launch_log(app, "[agent] runtime not found");
            return Self::default();
        };
        launch_log(app, &format!("[agent] runtime={}", runtime.display()));
        let node_dir = runtime.join("node");
        let agent_dir = runtime.join("canvas-agent");
        let node = node_dir.join(if cfg!(windows) { "node.exe" } else { "node" });
        let entry = agent_dir.join("dist").join("index.js");
        if !node.is_file() || !entry.is_file() {
            launch_log(app, &format!("[agent] node={} entry={} missing", node.is_file(), entry.is_file()));
            return Self::default();
        }
        let mut search_paths = vec![node_dir];
        if let Some(path) = std::env::var_os("PATH") {
            search_paths.extend(std::env::split_paths(&path));
        }
        let Ok(path) = std::env::join_paths(search_paths) else { return Self::default() };
        let out = child_log_file(app, "agent-stdout.log");
        let err = child_log_file(app, "agent-stderr.log");
        let mut command = std::process::Command::new(node);
        command
            .arg(entry)
            .current_dir(agent_dir)
            .env("PATH", path)
            .env_remove("PORT")
            .stdin(std::process::Stdio::null());
        if let Some(f) = out { command.stdout(std::process::Stdio::from(f)); }
        if let Some(f) = err { command.stderr(std::process::Stdio::from(f)); }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        match command.spawn() {
            Ok(mut child) => {
                launch_log(app, &format!("[agent] spawned pid={}", child.id()));
                for _ in 0..50 {
                    if read_agent_config().is_some_and(|config| agent_is_listening(&config.url)) || child.try_wait().ok().flatten().is_some() {
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
                Self(std::sync::Mutex::new(Some(child)))
            }
            Err(e) => {
                launch_log(app, &format!("[agent] spawn FAILED: {}", e));
                Self::default()
            }
        }
    }

    pub(crate) fn stop(&self) {
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

/// Tauri 在 Windows 上的 resource_dir()/current_exe() 可能返回 `\\?\C:\...`
/// 形式的扩展长度路径。Node 把这种路径当作脚本入口时会错误解析成盘符本身
/// （EISDIR: lstat 'C:'），导致子进程启动即退出。传给子进程前统一剥掉该前缀。
fn plain_path(path: std::path::PathBuf) -> std::path::PathBuf {
    #[cfg(windows)]
    {
        use std::path::PathBuf;
        let text = path.to_string_lossy();
        if let Some(rest) = text.strip_prefix(r"\\?\") {
            return PathBuf::from(rest);
        }
    }
    #[cfg(not(windows))]
    let _ = &path;
    path
}

/// 把进程拉起的关键决策写到本地日志，便于真机排查网关/Agent 未启动的问题。
/// 日志失败一律忽略，绝不影响主流程。
fn launch_log(app: &tauri::AppHandle, msg: &str) {
    let Ok(dir) = app.path().app_local_data_dir() else { return };
    let _ = std::fs::create_dir_all(&dir);
    use std::io::Write;
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("launch-debug.log"))
    {
        let secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let _ = writeln!(file, "[{}] {}", secs, msg);
    }
}

/// 子进程输出重定向到独立文件，替代 Stdio::null，便于定位启动即退出的原因。
fn child_log_file(app: &tauri::AppHandle, name: &str) -> Option<std::fs::File> {
    let dir = app.path().app_local_data_dir().ok()?;
    let _ = std::fs::create_dir_all(&dir);
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join(name))
        .ok()
}

/// 本地 ComfyUI 网关：把 ComfyUI 的节点协议翻译成 OpenAI 兼容接口，
/// INTX 只需按普通 OpenAI 渠道连它。随 INTX 启动、退出时回收。
#[derive(Default)]
pub(crate) struct ManagedLocalGateway(std::sync::Mutex<Option<std::process::Child>>);

const LOCAL_GATEWAY_URL: &str = "http://127.0.0.1:8190";

#[derive(serde::Serialize)]
struct ComfyConnectionStatus {
    comfy: bool,
    gateway: bool,
}

#[tauri::command]
fn check_comfy_connections() -> ComfyConnectionStatus {
    ComfyConnectionStatus {
        comfy: agent_is_listening("http://127.0.0.1:8188"),
        gateway: agent_is_listening(LOCAL_GATEWAY_URL),
    }
}

impl ManagedLocalGateway {
    fn start(app: &tauri::AppHandle) -> Self {
        launch_log(app, "[gateway] start() begin");
        // 已在运行（用户自己起的，或上次的残留）→ 接管，不重复拉起，退出时也不归我们关
        if agent_is_listening(LOCAL_GATEWAY_URL) {
            launch_log(app, "[gateway] port 8190 already listening, adopt");
            return Self::default();
        }
        let Some(gateway_dir) = find_local_gateway_dir(app).map(plain_path) else {
            launch_log(app, "[gateway] gateway_dir not found");
            return Self::default();
        };
        launch_log(app, &format!("[gateway] gateway_dir={}", gateway_dir.display()));
        let Ok(data_dir) = app.path().app_local_data_dir() else {
            launch_log(app, "[gateway] app_local_data_dir failed");
            return Self::default();
        };
        let data_dir = plain_path(data_dir);
        let entry = gateway_dir.join("src").join("server.js");
        if !entry.is_file() {
            launch_log(app, &format!("[gateway] entry missing: {}", entry.display()));
            return Self::default();
        }
        // 优先复用随包 Node，开发模式回退到系统 PATH。
        let node_name = if cfg!(windows) { "node.exe" } else { "node" };
        let runtime = find_agent_runtime(app).map(plain_path);
        launch_log(app, &format!("[gateway] runtime={:?}", runtime.as_ref().map(|p| p.display().to_string())));
        let node = runtime
            .as_ref()
            .map(|runtime| runtime.join("node").join(node_name))
            .filter(|path| path.is_file())
            .unwrap_or_else(|| node_name.into());
        launch_log(app, &format!("[gateway] node={} is_file={}", node.display(), node.is_file()));
        let out = child_log_file(app, "gateway-stdout.log");
        let err = child_log_file(app, "gateway-stderr.log");
        let mut command = std::process::Command::new(&node);
        command
            .arg(&entry)
            .current_dir(&gateway_dir)
            .env("PORT", "8190")
            .env("HOST", "127.0.0.1")
            .env("COMFY_URL", "http://127.0.0.1:8188")
            .env("DATA_DIR", data_dir.join("comfyui-gateway"))
            .env("WORKFLOW_DIR", data_dir.join("comfyui-gateway").join("workflows"))
            .env("LEGACY_WORKFLOW_DIR", gateway_dir.join("workflows"))
            .env("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
            // 随包节点由网关启动器首次安装；我们直连网关，不需要它再动 ComfyUI
            .env("DISABLE_NODE_BOOTSTRAP", "1")
            .stdin(std::process::Stdio::null());
        if let Some(f) = out { command.stdout(std::process::Stdio::from(f)); }
        if let Some(f) = err { command.stderr(std::process::Stdio::from(f)); }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        match command.spawn() {
            Ok(mut child) => {
                launch_log(app, &format!("[gateway] spawned pid={}", child.id()));
                let mut listened = false;
                for _ in 0..50 {
                    if agent_is_listening(LOCAL_GATEWAY_URL) { listened = true; break; }
                    if child.try_wait().ok().flatten().is_some() {
                        launch_log(app, "[gateway] child exited early");
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
                launch_log(app, &format!("[gateway] waited, listened={}", listened));
                Self(std::sync::Mutex::new(Some(child)))
            }
            Err(e) => {
                launch_log(app, &format!("[gateway] spawn FAILED: {}", e));
                Self::default()
            }
        }
    }

    pub(crate) fn stop(&self) {
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

/// 找到随应用资源打包的网关目录。
fn find_local_gateway_dir(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(resources) = app.path().resource_dir() {
        candidates.push(resources.join("comfyui-gateway"));
        candidates.push(resources.join("resources").join("comfyui-gateway"));
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
        .setup(|app| {
            app.manage(ManagedCanvasAgent::start(app.handle()));
            app.manage(ManagedLocalGateway::start(app.handle()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![read_agent_config, check_comfy_connections, updater::download_and_install_update])
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
