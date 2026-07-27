use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use image::{imageops, load_from_memory, DynamicImage, RgbaImage};
use ort::{self, ep, inputs, session::Session, value::Tensor};
use std::io::Cursor;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tokio::fs;

const UPSCALE_MODEL: &str = "realesrgan-x4.onnx";
const MATTING_MODEL: &str = "rmbg-1.4.onnx";

fn model_url(name: &str) -> &'static str {
    match name {
        "realesrgan-x4.onnx" => "https://huggingface.co/imgdesignart/realesrgan-x4-onnx/resolve/main/onnx/model.onnx",
        "rmbg-1.4.onnx" => "https://huggingface.co/briaai/RMBG-1.4/resolve/main/onnx/model.onnx",
        _ => "",
    }
}

fn models_dir(app: &AppHandle) -> PathBuf {
    let dir = app.path().app_data_dir().unwrap_or_default().join("models");
    std::fs::create_dir_all(&dir).ok();
    dir
}

async fn ensure_model(app: &AppHandle, model_name: &str) -> Result<PathBuf, String> {
    let model_path = models_dir(app).join(model_name);
    if model_path.exists() {
        return Ok(model_path);
    }
    let url = model_url(model_name);
    log::info!("Downloading model {} ...", model_name);
    let response = reqwest::get(url).await.map_err(|e| e.to_string())?;
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    fs::write(&model_path, &bytes).await.map_err(|e| e.to_string())?;
    log::info!("Model downloaded: {}", model_name);
    Ok(model_path)
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

fn run_upscale(model_path: &Path, input: &Path) -> Result<String, String> {
    ort::init().with_name("BeastTV-upscale").commit();

    let mut session = Session::builder()
        .map_err(|e| format!("Build: {}", e))?
        .with_execution_providers([ep::CPU::default().build()])
        .map_err(|e| format!("EP: {}", e))?
        .commit_from_file(model_path)
        .map_err(|e| format!("Model: {}", e))?;

    // Get the actual input name from the model
    let (img, pixels, iw, ih) = load_image(input)?;
    let data = rgb_to_nchw(&pixels, iw, ih);
    let tensor = Tensor::from_array(([1usize, 3, ih, iw], data))
        .map_err(|e| e.to_string())?
        .into_dyn();

    let outputs = session.run(inputs![tensor])
        .map_err(|e| format!("Inference: {}", e))?;

    let (shape, output_data) = outputs[0]
        .try_extract_tensor::<f32>()
        .map_err(|e| format!("Extract: {}", e))?;

    let dims = shape.as_ref();
    let (oh, ow) = (dims[2] as usize, dims[3] as usize);
    let out_img = nchw_to_rgba(output_data, ow, oh);

    drop(img);

    image_to_data_url(&out_img)
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
    let mask_img = RgbaImage::from_raw(out_w as u32, out_h as u32, mask_small)
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
pub async fn upscale_image(path: String, app: AppHandle) -> Result<String, String> {
    let input_path = resolve_image_input(&path, &app).await?;
    let model_path = ensure_model(&app, UPSCALE_MODEL).await?;
    let ip = input_path.clone();
    let result = tokio::task::spawn_blocking(move || run_upscale(&model_path, &ip))
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
