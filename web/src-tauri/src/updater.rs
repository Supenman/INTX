//! INTX 自研免密码更新器（方案 A）：
//! 通过 HTTPS 流式下载安装包、实时推送下载进度、本地校验 SHA-256，
//! 校验通过后回收本地子进程并拉起 NSIS 安装程序覆盖升级（无需 minisign 私钥与密码）。

use std::io::Write;
use tauri::{Emitter, Manager};

use crate::{ManagedCanvasAgent, ManagedLocalGateway};

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgressEvent {
    pub stage: String,
    pub downloaded: u64,
    pub total: u64,
    pub percent: u8,
}

#[tauri::command]
pub async fn download_and_install_update(
    app: tauri::AppHandle,
    url: String,
    expected_sha256: String,
    mirrors: Option<Vec<String>>,
) -> Result<(), String> {
    let expected = expected_sha256.trim().to_ascii_lowercase();
    if expected.len() != 64 || !expected.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("更新清单缺少有效的 SHA-256 校验值".to_string());
    }

    let mut candidates = Vec::new();
    if url.trim().starts_with("https://") {
        candidates.push(url.trim().to_string());
    }
    if let Some(extra) = mirrors {
        for item in extra {
            let trimmed = item.trim();
            if trimmed.starts_with("https://") && !candidates.iter().any(|u| u == trimmed) {
                candidates.push(trimmed.to_string());
            }
        }
    }
    if candidates.is_empty() {
        return Err("更新下载地址必须使用 HTTPS 协议".to_string());
    }

    let temp_dir = std::env::temp_dir();
    let installer_path = temp_dir.join(format!("INTX-update-{}.exe", &expected[..12]));
    let client = tauri_plugin_http::reqwest::Client::builder()
        .redirect(tauri_plugin_http::reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("初始化下载客户端失败: {e}"))?;

    let mut last_error = String::new();
    let mut downloaded_ok = false;

    for candidate in &candidates {
        match stream_download_and_hash(&app, &client, candidate, &installer_path).await {
            Ok(actual_sha256) => {
                if actual_sha256 == expected {
                    downloaded_ok = true;
                    break;
                }
                let _ = std::fs::remove_file(&installer_path);
                last_error = format!(
                    "安装包 SHA-256 校验失败（期望 {}，实际 {}）",
                    &expected[..12],
                    &actual_sha256[..12]
                );
            }
            Err(err) => {
                let _ = std::fs::remove_file(&installer_path);
                last_error = err;
            }
        }
    }

    if !downloaded_ok {
        return Err(if last_error.is_empty() {
            "所有更新源均下载失败".to_string()
        } else {
            last_error
        });
    }

    let _ = app.emit(
        "intx-update-progress",
        UpdateProgressEvent {
            stage: "launching".to_string(),
            downloaded: 0,
            total: 0,
            percent: 100,
        },
    );

    // 启动安装器前回收本地 sidecar 子进程，避免文件占用导致覆盖安装失败。
    if let Some(agent) = app.try_state::<ManagedCanvasAgent>() {
        agent.stop();
    }
    if let Some(gateway) = app.try_state::<ManagedLocalGateway>() {
        gateway.stop();
    }

    #[cfg(windows)]
    {
        std::process::Command::new(&installer_path)
            .spawn()
            .map_err(|e| format!("启动安装程序失败: {e}"))?;
        app.exit(0);
        Ok(())
    }

    #[cfg(not(windows))]
    {
        let _ = installer_path;
        Err("当前仅支持 Windows NSIS 安装包自动升级".to_string())
    }
}

async fn stream_download_and_hash(
    app: &tauri::AppHandle,
    client: &tauri_plugin_http::reqwest::Client,
    url: &str,
    dest: &std::path::Path,
) -> Result<String, String> {
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("请求更新包失败: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("下载失败（HTTP {}）", response.status().as_u16()));
    }

    let total = response.content_length().unwrap_or(0);
    let mut file =
        std::fs::File::create(dest).map_err(|e| format!("创建临时安装包失败: {e}"))?;
    let mut hasher = Sha256::new();
    let mut downloaded: u64 = 0;
    let mut last_percent: u8 = 0;

    let _ = app.emit(
        "intx-update-progress",
        UpdateProgressEvent {
            stage: "downloading".to_string(),
            downloaded: 0,
            total,
            percent: 0,
        },
    );

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("读取安装包数据失败: {e}"))?
    {
        file.write_all(&chunk)
            .map_err(|e| format!("写入临时安装包失败: {e}"))?;
        hasher.update(&chunk);
        downloaded = downloaded.saturating_add(chunk.len() as u64);

        let percent = if total > 0 {
            ((downloaded.saturating_mul(100)) / total).min(99) as u8
        } else {
            0
        };
        if percent != last_percent || total == 0 {
            last_percent = percent;
            let _ = app.emit(
                "intx-update-progress",
                UpdateProgressEvent {
                    stage: "downloading".to_string(),
                    downloaded,
                    total,
                    percent,
                },
            );
        }
    }
    file.flush()
        .map_err(|e| format!("刷新临时安装包失败: {e}"))?;

    let _ = app.emit(
        "intx-update-progress",
        UpdateProgressEvent {
            stage: "verifying".to_string(),
            downloaded,
            total,
            percent: 99,
        },
    );

    Ok(hasher.finalize_hex())
}

/// 零外部依赖的标准 FIPS 180-4 SHA-256 实现，避免新增 Cargo crate 依赖。
struct Sha256 {
    state: [u32; 8],
    buffer: [u8; 64],
    buffer_len: usize,
    total_len: u64,
}

impl Sha256 {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];

    fn new() -> Self {
        Self {
            state: [
                0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
                0x1f83d9ab, 0x5be0cd19,
            ],
            buffer: [0; 64],
            buffer_len: 0,
            total_len: 0,
        }
    }

    fn update(&mut self, mut input: &[u8]) {
        self.total_len = self.total_len.wrapping_add(input.len() as u64);
        if self.buffer_len > 0 {
            let take = (64 - self.buffer_len).min(input.len());
            self.buffer[self.buffer_len..self.buffer_len + take].copy_from_slice(&input[..take]);
            self.buffer_len += take;
            input = &input[take..];
            if self.buffer_len == 64 {
                let block = self.buffer;
                self.compress(&block);
                self.buffer_len = 0;
            }
        }
        while input.len() >= 64 {
            let mut block = [0u8; 64];
            block.copy_from_slice(&input[..64]);
            self.compress(&block);
            input = &input[64..];
        }
        if !input.is_empty() {
            self.buffer[..input.len()].copy_from_slice(input);
            self.buffer_len = input.len();
        }
    }

    fn finalize_hex(mut self) -> String {
        let bit_len = self.total_len.wrapping_mul(8);
        self.update(&[0x80]);
        let pad_zero = if self.buffer_len <= 56 {
            56 - self.buffer_len
        } else {
            120 - self.buffer_len
        };
        let zeros = [0u8; 64];
        let mut remaining = pad_zero;
        while remaining > 0 {
            let step = remaining.min(64);
            self.update(&zeros[..step]);
            remaining -= step;
        }
        self.update(&bit_len.to_be_bytes());
        let mut out = String::with_capacity(64);
        for word in self.state {
            out.push_str(&format!("{word:08x}"));
        }
        out
    }

    fn compress(&mut self, block: &[u8; 64]) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            let o = i * 4;
            w[i] = u32::from_be_bytes([block[o], block[o + 1], block[o + 2], block[o + 3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = self.state;
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = h
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(Self::K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);

            h = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }
        for (slot, delta) in self.state.iter_mut().zip([a, b, c, d, e, f, g, h]) {
            *slot = slot.wrapping_add(delta);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Sha256;

    #[test]
    fn matches_nist_sha256_vectors() {
        let mut h1 = Sha256::new();
        h1.update(b"abc");
        assert_eq!(
            h1.finalize_hex(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );

        let mut h2 = Sha256::new();
        h2.update(b"");
        assert_eq!(
            h2.finalize_hex(),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }
}
