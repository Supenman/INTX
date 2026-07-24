use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use image::ImageReader;
use ort::{self, ep, inputs, session::Session, value::Tensor};
use std::io::Cursor;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tokio::fs;

const UPSCALE_MODEL: &str = "realesrgan-x4.onnx";
const MATTING_MODEL: &str = "rmbg-1.4.onnx";

/// Map model name to HuggingFace download URL.
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
    log::info!("Downloading model {} ...", model_name);
    let url = model_url(model_name);
    if url.is_empty() {
        return Err(format!("Unknown model: {}", model_name));
    }
    let response = reqwest::get(url).await.map_err(|e| e.to_string())?;
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    fs::write(&model_path, &bytes).await.map_err(|e| e.to_string())?;
    Ok(model_path)
}

/// Resolve input: if path starts with "data:", decode base64 and write to a temp file.
/// Otherwise treat as a file path.
async fn resolve_image_input(path: &str, app: &AppHandle) -> Result<(PathBuf, bool), String> {
    if path.starts_with("data:") {
        let base64_data = path.split(',').nth(1).ok_or("Invalid data URL")?;
        let bytes = BASE64
            .decode(base64_data)
            .map_err(|e| format!("Base64 decode: {}", e))?;
        let dir = app.path().app_data_dir().unwrap_or_default().join("temp");
        std::fs::create_dir_all(&dir).ok();
        let tmp_path = dir.join(format!("input_{}.png", std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_millis()));
        fs::write(&tmp_path, &bytes)
            .await
            .map_err(|e| e.to_string())?;
        Ok((tmp_path, true))
    } else {
        let p = PathBuf::from(path);
        if !p.exists() {
            return Err(format!("File not found: {}", path));
        }
        Ok((p, false))
    }
}

/// Encode a PNG image to a data URL.
fn image_to_data_url(img: &image::RgbaImage) -> Result<String, String> {
    let mut buf = Cursor::new(Vec::new());
    img.write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    let b64 = BASE64.encode(buf.into_inner());
    Ok(format!("data:image/png;base64,{}", b64))
}

fn image_to_tensor(path: &Path) -> Result<(image::DynamicImage, ort::value::Value), String> {
    let img = ImageReader::open(path)
        .map_err(|e| e.to_string())?
        .decode()
        .map_err(|e| e.to_string())?;
    let rgba = img.to_rgba8();
    let (w, h) = (rgba.width() as usize, rgba.height() as usize);
    let pixels = rgba.into_raw();
    let n = w * h;

    let mut data = vec![0.0f32; n * 3];
    for i in 0..n {
        data[i] = pixels[i * 4] as f32 / 255.0;
        data[n + i] = pixels[i * 4 + 1] as f32 / 255.0;
        data[2 * n + i] = pixels[i * 4 + 2] as f32 / 255.0;
    }

    let tensor = Tensor::from_array(([1usize, 3, h, w], data))
        .map_err(|e| e.to_string())?
        .into_dyn();

    let img = ImageReader::open(path)
        .map_err(|e| e.to_string())?
        .decode()
        .map_err(|e| e.to_string())?;
    Ok((img, tensor))
}

fn run_upscale(model_path: &Path, input: &Path) -> Result<String, String> {
    ort::init().with_name("BeastTV-upscale").commit();

    let mut session = Session::builder()
        .map_err(|e| format!("Session builder: {}", e))?
        .with_execution_providers([ep::CPU::default().build()])
        .map_err(|e| format!("EP: {}", e))?
        .commit_from_file(model_path)
        .map_err(|e| format!("Load model: {}", e))?;

    let (_, tensor) = image_to_tensor(input)?;
    let outputs = session
        .run(inputs!["input" => tensor])
        .map_err(|e| format!("Inference: {}", e))?;

    let (shape, output_data) = outputs["output"]
        .try_extract_tensor::<f32>()
        .map_err(|e| format!("Extract: {}", e))?;

    let dims = shape.as_ref();
    if dims.len() < 4 {
        return Err("Unexpected output shape".into());
    }
    let (h, w) = (dims[2] as usize, dims[3] as usize);
    let n = h * w;
    let mut pixels = vec![0u8; w * h * 4];

    for i in 0..w * h {
        let ri = output_data.get(i).copied().unwrap_or(0.0).clamp(0.0, 1.0);
        let gi = output_data
            .get(n + i)
            .copied()
            .unwrap_or(0.0)
            .clamp(0.0, 1.0);
        let bi = output_data
            .get(2 * n + i)
            .copied()
            .unwrap_or(0.0)
            .clamp(0.0, 1.0);
        pixels[i * 4] = (ri * 255.0) as u8;
        pixels[i * 4 + 1] = (gi * 255.0) as u8;
        pixels[i * 4 + 2] = (bi * 255.0) as u8;
        pixels[i * 4 + 3] = 255;
    }

    let out_img = image::RgbaImage::from_raw(w as u32, h as u32, pixels)
        .ok_or("Failed to create output image".to_string())?;
    image_to_data_url(&out_img)
}

fn run_matting(model_path: &Path, input: &Path) -> Result<String, String> {
    ort::init().with_name("BeastTV-matting").commit();

    let mut session = Session::builder()
        .map_err(|e| format!("Session builder: {}", e))?
        .with_execution_providers([ep::CPU::default().build()])
        .map_err(|e| format!("EP: {}", e))?
        .commit_from_file(model_path)
        .map_err(|e| format!("Load model: {}", e))?;

    let (img, tensor) = image_to_tensor(input)?;
    let outputs = session
        .run(inputs!["input" => tensor])
        .map_err(|e| format!("Inference: {}", e))?;

    let (shape, output_data) = outputs["output"]
        .try_extract_tensor::<f32>()
        .map_err(|e| format!("Extract: {}", e))?;

    let dims = shape.as_ref();
    if dims.len() < 4 {
        return Err("Unexpected output shape".into());
    }
    let (h, w) = (dims[2] as usize, dims[3] as usize);
    let total = w * h;

    let mut mask = vec![0u8; total];
    for i in 0..total.min(output_data.len()) {
        mask[i] = (output_data[i].clamp(0.0, 1.0) * 255.0) as u8;
    }

    let rgba = img.to_rgba8();
    let mut result = rgba.clone();
    let min_h = h.min(rgba.height() as usize);
    let min_w = w.min(rgba.width() as usize);

    for y in 0..min_h {
        for x in 0..min_w {
            let mi = y * w + x;
            let pix = result.get_pixel_mut(x as u32, y as u32);
            pix[3] = mask.get(mi).copied().unwrap_or(0);
        }
    }
    image_to_data_url(&result)
}

// ── Tauri Commands ───────────────────────────────

#[tauri::command]
pub async fn upscale_image(path: String, app: AppHandle) -> Result<String, String> {
    let (input_path, _is_temp) = resolve_image_input(&path, &app).await?;
    let model_path = ensure_model(&app, UPSCALE_MODEL).await?;

    let ip = input_path.clone();
    let result = tokio::task::spawn_blocking(move || run_upscale(&model_path, &ip))
        .await
        .map_err(|e| format!("Task failed: {}", e))?
        .map_err(|e| format!("Upscale failed: {}", e))?;

    if path.starts_with("data:") {
        let _ = std::fs::remove_file(&input_path);
    }

    Ok(result)
}

#[tauri::command]
pub async fn matting_image(path: String, app: AppHandle) -> Result<String, String> {
    let (input_path, _is_temp) = resolve_image_input(&path, &app).await?;
    let model_path = ensure_model(&app, MATTING_MODEL).await?;

    let ip = input_path.clone();
    let result = tokio::task::spawn_blocking(move || run_matting(&model_path, &ip))
        .await
        .map_err(|e| format!("Task failed: {}", e))?
        .map_err(|e| format!("Matting failed: {}", e))?;

    Ok(result)
}
