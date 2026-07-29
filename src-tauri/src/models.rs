use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use futures_util::StreamExt;
use image::{imageops, load_from_memory, DynamicImage, RgbaImage};
use ort::{self, ep, inputs, session::Session, value::Tensor};
use serde::Serialize;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};
use tokio::fs;

const UPSCALE_MODEL: &str = "realesrgan-x4.onnx";
const MATTING_MODEL: &str = "rmbg-1.4.onnx";

/// Expected minimum file sizes in bytes (90% of actual) to detect truncated downloads.
const MIN_UPSCALE_BYTES: u64 = 60_000_000;
const MIN_MATTING_BYTES: u64 = 40_000_000;

fn min_model_bytes(name: &str) -> u64 {
    match name {
        UPSCALE_MODEL => MIN_UPSCALE_BYTES,
        MATTING_MODEL => MIN_MATTING_BYTES,
        _ => 10_000_000,
    }
}

fn model_url(name: &str) -> &'static str {
    match name {
        "realesrgan-x4.onnx" => "https://huggingface.co/imgdesignart/realesrgan-x4-onnx/resolve/main/onnx/model.onnx",
        "rmbg-1.4.onnx" => "https://huggingface.co/briaai/RMBG-1.4/resolve/main/onnx/model_quantized.onnx",
        _ => "",
    }
}

fn models_dir(_app: &AppHandle) -> PathBuf {
    local_models_dir()
}

fn local_models_dir() -> PathBuf {
    // Force project root models/ — never src-tauri/models/ to avoid Tauri watch restart
    let cwd = std::env::current_dir().unwrap_or_default();
    for dir in &[cwd.join("../models"), cwd.join("../../models")] {
        let d = dir.canonicalize().unwrap_or_else(|_| dir.clone());
        if d.exists() && !d.to_string_lossy().contains("src-tauri") {
            return d;
        }
    }
    // Create in project root (parent of src-tauri/)
    let project_root = cwd.join("..");
    let dir = project_root.join("models");
    std::fs::create_dir_all(&dir).ok();
    dir
}

async fn ensure_model(app: &AppHandle, model_name: &str) -> Result<PathBuf, String> {
    // 1. App data dir (downloaded cache) — validate file is not truncated
    let model_path = models_dir(app).join(model_name);
    log::info!("Checking model at: {:?}", model_path);
    let min_size = min_model_bytes(model_name);
    if let Ok(meta) = std::fs::metadata(&model_path) {
        let len = meta.len();
        if len >= min_size {
            log::info!("Model found cached: {:?} ({} bytes)", model_path, len);
            return Ok(model_path);
        } else {
            log::warn!("Model truncated ({} bytes, need {}), re-downloading", len, min_size);
            let _ = std::fs::remove_file(&model_path);
        }
    }

    // 2. Project ./models/ (manual download)
    let local_dir = local_models_dir();
    let local_path = local_dir.join(model_name);
    if let Ok(meta) = std::fs::metadata(&local_path) {
        if meta.len() >= min_size {
            std::fs::create_dir_all(&models_dir(app)).ok();
            let _ = std::fs::copy(&local_path, &model_path);
            return Ok(local_path);
        } else {
            log::warn!("Local model truncated ({} bytes, need {}), removing", meta.len(), min_size);
            let _ = std::fs::remove_file(&local_path);
        }
    }

    // 3. Remote download with progress events
    let url = model_url(model_name);
    if url.is_empty() {
        return Err(format!("Unknown model: {}", model_name));
    }
    log::info!("Downloading model {} ...", model_name);
    let app_handle = app.clone();
    let model_name_owned = model_name.to_string();
    let dest = models_dir(app).join(model_name);
    std::fs::create_dir_all(&models_dir(app)).ok();
    download_with_progress(&app_handle, &model_name_owned, &url, &dest).await?;
    log::info!("Model downloaded: {}", model_name);
    Ok(dest)
}

#[derive(Serialize, Clone)]
struct DownloadProgress {
    model: String,
    received: u64,
    total: u64,
    phase: String, // "start" | "progress" | "done" | "error"
}

async fn download_with_progress(
    app: &AppHandle,
    model_name: &str,
    url: &str,
    dest: &Path,
) -> Result<(), String> {
    let _ = app.emit("model-download-progress", DownloadProgress {
        model: model_name.to_string(),
        received: 0, total: 0, phase: "start".into(),
    });

    let client = reqwest::Client::builder()
        .user_agent("BeastTV/0.1")
        .build()
        .map_err(|e| e.to_string())?;

    let response = client.get(url).send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("HTTP {}", status));
    }

    let content_type = response.headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    if content_type.contains("text/html") {
        return Err(format!("URL 返回 HTML 而非模型文件，可能已失效"));
    }

    let total = response.content_length().unwrap_or(0);
    let mut received: u64 = 0;
    let mut stream = response.bytes_stream();
    let mut file = std::fs::File::create(dest).map_err(|e| format!("Create file: {}", e))?;
    use std::io::Write;

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("Download: {}", e))?;
        file.write_all(&chunk).map_err(|e| format!("Write: {}", e))?;
        received += chunk.len() as u64;
        let _ = app.emit("model-download-progress", DownloadProgress {
            model: model_name.to_string(),
            received, total, phase: "progress".into(),
        });
    }

    let _ = app.emit("model-download-progress", DownloadProgress {
        model: model_name.to_string(),
        received, total, phase: "done".into(),
    });
    Ok(())
}

async fn resolve_image_input(path: &str, app: &AppHandle) -> Result<PathBuf, String> {
    if path.starts_with("data:") {
        let base64_data = path.split(',').nth(1).ok_or("Invalid data URL")?;
        let bytes = BASE64.decode(base64_data).map_err(|e| format!("Base64: {}", e))?;
        let dir = app.path().app_data_dir().unwrap_or_default().join("temp");
        std::fs::create_dir_all(&dir).ok();
        let tmp_path = dir.join(format!("input_{}.bin", std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_millis()));
        fs::write(&tmp_path, &bytes).await.map_err(|e| e.to_string())?;
        Ok(tmp_path)
    } else {
        let p = PathBuf::from(path);
        if !p.exists() {
            return Err(format!("File not found: {}", path));
        }
        Ok(p)
    }
}

fn image_to_data_url(img: &RgbaImage) -> Result<String, String> {
    let mut buf = Cursor::new(Vec::new());
    img.write_to(&mut buf, image::ImageFormat::Png).map_err(|e| e.to_string())?;
    let b64 = BASE64.encode(buf.into_inner());
    Ok(format!("data:image/png;base64,{}", b64))
}

/// Load image file → (original_img, rgba_raw, orig_w, orig_h)
fn load_image(path: &Path) -> Result<(DynamicImage, Vec<u8>, usize, usize), String> {
    let bytes = std::fs::read(path).map_err(|e| format!("Read: {}", e))?;
    let img = load_from_memory(&bytes).map_err(|e| format!("Decode ({} bytes): {}", bytes.len(), e))?;
    let (ow, oh) = (img.width() as usize, img.height() as usize);
    let rgba = img.to_rgba8().into_raw();
    Ok((img, rgba, ow, oh))
}

fn rgb_to_nchw(pixels: &[u8], w: usize, h: usize) -> Vec<f32> {
    let n = w * h;
    let mut data = vec![0.0f32; n * 3];
    for i in 0..n {
        data[i] = pixels[i * 4] as f32 / 255.0;
        data[n + i] = pixels[i * 4 + 1] as f32 / 255.0;
        data[2 * n + i] = pixels[i * 4 + 2] as f32 / 255.0;
    }
    data
}

fn nchw_to_rgba(data: &[f32], w: usize, h: usize) -> RgbaImage {
    let n = w * h;
    let mut pixels = vec![0u8; w * h * 4];
    for i in 0..n {
        pixels[i * 4] = (data[i].clamp(0.0, 1.0) * 255.0) as u8;
        pixels[i * 4 + 1] = (data[n + i].clamp(0.0, 1.0) * 255.0) as u8;
        pixels[i * 4 + 2] = (data[2 * n + i].clamp(0.0, 1.0) * 255.0) as u8;
        pixels[i * 4 + 3] = 255;
    }
    RgbaImage::from_raw(w as u32, h as u32, pixels).unwrap()
}

// ── HD Upscale ───────────────────────────────

fn run_upscale(model_path: &Path, input: &Path, app: &AppHandle) -> Result<String, String> {
    ort::init().with_name("BeastTV-upscale").commit();

    let mut session = Session::builder()
        .map_err(|e| format!("Build: {}", e))?
        .with_execution_providers([ep::CPU::default().build()])
        .map_err(|e| format!("EP: {}", e))?
        .commit_from_file(model_path)
        .map_err(|e| format!("Model: {}", e))?;

    // Load as RGB (discard alpha)
    let bytes = std::fs::read(input).map_err(|e| format!("Read: {}", e))?;
    let dyn_img = load_from_memory(&bytes).map_err(|e| format!("Decode: {}", e))?;
    let src = dyn_img.to_rgb8();
    let (w, h) = src.dimensions();

    // Tiling constants (matching Real-ESRGAN tile approach)
    const TILE: u32 = 64;
    const PAD: u32 = 8;
    const STEP: u32 = TILE - 2 * PAD;

    let mut scale = 0u32;
    let mut dst: Option<image::RgbImage> = None;
    let cols = (w + STEP - 1) / STEP;
    let rows = (h + STEP - 1) / STEP;
    let total_tiles = rows * cols;

    for row in 0..rows {
        for col in 0..cols {
            let tile_idx = row * cols + col;

            // Emit progress every 5 tiles
            if tile_idx % 5 == 0 {
                let _ = app.emit("model-progress", serde_json::json!({
                    "current": tile_idx,
                    "total": total_tiles,
                    "phase": "inference"
                }));
            }

            let x = col * STEP;
            let y = row * STEP;

            // Extract 64x64 tile with clamped padding
            let mut tile = image::RgbImage::new(TILE, TILE);
            for ty in 0..TILE {
                for tx in 0..TILE {
                    let sx = (x as i64 + tx as i64 - PAD as i64).clamp(0, w as i64 - 1) as u32;
                    let sy = (y as i64 + ty as i64 - PAD as i64).clamp(0, h as i64 - 1) as u32;
                    tile.put_pixel(tx, ty, *src.get_pixel(sx, sy));
                }
            }

            // Tile → NCHW f32 tensor
            let (tw, th) = tile.dimensions();
            let plane = (tw * th) as usize;
            let mut data = vec![0.0f32; plane * 3];
            for (i, px) in tile.pixels().enumerate() {
                data[i] = px[0] as f32 / 255.0;
                data[plane + i] = px[1] as f32 / 255.0;
                data[2 * plane + i] = px[2] as f32 / 255.0;
            }

            let tensor = Tensor::from_array(([1usize, 3, TILE as usize, TILE as usize], data))
                .map_err(|e| e.to_string())?
                .into_dyn();

            let outputs = session.run(inputs![tensor])
                .map_err(|e| format!("Inference: {}", e))?;

            let (oshape, odata) = outputs[0]
                .try_extract_tensor::<f32>()
                .map_err(|e| format!("Extract: {}", e))?;

            let sd = oshape.as_ref();
            let ow = sd[3] as usize;
            // let oh = sd[2] as usize;

            // First tile: detect scale and allocate output
            if scale == 0 {
                scale = ow as u32 / TILE;
                if scale == 0 {
                    return Err("Cannot determine scale factor".into());
                }
                dst = Some(image::RgbImage::new(w * scale, h * scale));
            }

            // Stitch valid region, skipping padded borders
            let out = dst.as_mut().unwrap();
            let plane_out = ow;
            let off = (PAD * scale) as usize;
            let vw = STEP.min(w - x);
            let vh = STEP.min(h - y);

            for ry in 0..vh * scale {
                for rx in 0..vw * scale {
                    let idx = (off + ry as usize) * ow + (off + rx as usize);
                    if idx + 2 * plane_out * plane_out < odata.len() {
                        let r = (odata[idx].clamp(0.0, 1.0) * 255.0).round() as u8;
                        let g = (odata[plane_out * plane_out + idx].clamp(0.0, 1.0) * 255.0).round() as u8;
                        let b = (odata[2 * plane_out * plane_out + idx].clamp(0.0, 1.0) * 255.0).round() as u8;
                        out.put_pixel(x * scale + rx, y * scale + ry, image::Rgb([r, g, b]));
                    }
                }
            }
        }
    }

    let out_img = dst.ok_or("No output produced")?;
    let rgba: image::RgbaImage = image::ImageBuffer::from_fn(out_img.width(), out_img.height(), |x, y| {
        let p = out_img.get_pixel(x, y);
        image::Rgba([p[0], p[1], p[2], 255])
    });
    image_to_data_url(&rgba)
}

// ── Subject Matting ──────────────────────────

const MATTING_INPUT_SIZE: usize = 1024;

fn run_matting(model_path: &Path, input: &Path) -> Result<String, String> {
    ort::init().with_name("BeastTV-matting").commit();

    let mut session = Session::builder()
        .map_err(|e| format!("Build: {}", e))?
        .with_execution_providers([ep::CPU::default().build()])
        .map_err(|e| format!("EP: {}", e))?
        .commit_from_file(model_path)
        .map_err(|e| format!("Model: {}", e))?;

    let bytes = std::fs::read(input).map_err(|e| format!("Read: {}", e))?;
    let orig = load_from_memory(&bytes).map_err(|e| format!("Decode: {}", e))?;
    let (orig_w, orig_h) = (orig.width() as usize, orig.height() as usize);

    // Resize to model's expected input size (1024x1024)
    let resized = imageops::resize(&orig.to_rgba8(), MATTING_INPUT_SIZE as u32, MATTING_INPUT_SIZE as u32, imageops::FilterType::Lanczos3);
    let pixels = resized.into_raw();
    let data = rgb_to_nchw(&pixels, MATTING_INPUT_SIZE, MATTING_INPUT_SIZE);

    let tensor = Tensor::from_array(([1usize, 3, MATTING_INPUT_SIZE, MATTING_INPUT_SIZE], data))
        .map_err(|e| e.to_string())?
        .into_dyn();

    let outputs = session.run(inputs![tensor])
        .map_err(|e| format!("Inference: {}", e))?;

    let (shape, output_data) = outputs[0]
        .try_extract_tensor::<f32>()
        .map_err(|e| format!("Extract: {}", e))?;

    let dims = shape.as_ref();

    // For RMBG-1.4, the output can be (1,1,H,W) or (1,H,W)
    let (out_h, out_w) = if dims.len() == 4 && dims[1] == 1 {
        (dims[2] as usize, dims[3] as usize)
    } else if dims.len() == 3 {
        (dims[1] as usize, dims[2] as usize)
    } else {
        (dims[2] as usize, dims[3] as usize)
    };

    // Build mask and resize to original image size
    let mut mask_small = vec![0u8; out_w * out_h];
    for i in 0..out_w * out_h {
        let val = output_data.get(i).copied().unwrap_or(0.0).clamp(0.0, 1.0);
        mask_small[i] = (val * 255.0) as u8;
    }
    use image::GrayImage;
    let mask_img = GrayImage::from_raw(out_w as u32, out_h as u32, mask_small)
        .ok_or("Mask create failed")?;
    let mask_resized = imageops::resize(&mask_img, orig_w as u32, orig_h as u32, imageops::FilterType::Triangle);
    let mask_pixels = mask_resized.into_raw();

    // Apply mask to original image
    let orig_rgba = orig.to_rgba8();
    let mut result = orig_rgba.clone();
    for y in 0..orig_h {
        for x in 0..orig_w {
            let idx = y * orig_w + x;
            let pix = result.get_pixel_mut(x as u32, y as u32);
            pix[3] = mask_pixels.get(idx).copied().unwrap_or(0);
        }
    }

    image_to_data_url(&result)
}

// ── Tauri Commands ───────────────────────────────

#[tauri::command]
pub async fn check_model_exists(model_name: String, app: AppHandle) -> Result<bool, String> {
    Ok(models_dir(&app).join(&model_name).exists())
}

#[tauri::command]
pub async fn upscale_image(path: String, app: AppHandle) -> Result<String, String> {
    let input_path = resolve_image_input(&path, &app).await?;
    let model_path = ensure_model(&app, UPSCALE_MODEL).await?;
    let ip = input_path.clone();
    let ap = app.clone();
    let result = tokio::task::spawn_blocking(move || run_upscale(&model_path, &ip, &ap))
        .await.map_err(|e| format!("Task: {}", e))?
        .map_err(|e| format!("Upscale failed: {}", e))?;
    if path.starts_with("data:") { let _ = std::fs::remove_file(&input_path); }
    Ok(result)
}

#[tauri::command]
pub async fn matting_image(path: String, app: AppHandle) -> Result<String, String> {
    let input_path = resolve_image_input(&path, &app).await?;
    let model_path = ensure_model(&app, MATTING_MODEL).await?;
    let ip = input_path.clone();
    let result = tokio::task::spawn_blocking(move || run_matting(&model_path, &ip))
        .await.map_err(|e| format!("Task: {}", e))?
        .map_err(|e| format!("Matting failed: {}", e))?;
    if path.starts_with("data:") { let _ = std::fs::remove_file(&input_path); }
    Ok(result)
}
