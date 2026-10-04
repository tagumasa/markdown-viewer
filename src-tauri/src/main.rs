#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::Path;

const TEXT_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd"];
const IMAGE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif", "svg",
];
// whole-file reads are memory-bound; reject anything that could OOM the process
const MAX_FILE_SIZE: u64 = 64 * 1024 * 1024;

fn ensure_allowed_extension(path: &str, allowed: &[&str]) -> Result<(), String> {
    let ext = Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .unwrap_or_default();
    if allowed.contains(&ext.as_str()) {
        Ok(())
    } else {
        Err(format!("unsupported file type: {ext}"))
    }
}

fn ensure_allowed_size(path: &str) -> Result<(), String> {
    let len = fs::metadata(path).map_err(|err| err.to_string())?.len();
    if len <= MAX_FILE_SIZE {
        Ok(())
    } else {
        Err(format!(
            "file too large: {len} bytes (max {} MiB)",
            MAX_FILE_SIZE / (1024 * 1024)
        ))
    }
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    ensure_allowed_extension(&path, TEXT_EXTENSIONS)?;
    ensure_allowed_size(&path)?;
    fs::read_to_string(&path).map_err(|err| err.to_string())
}

#[tauri::command]
fn read_binary_file(path: String) -> Result<tauri::ipc::Response, String> {
    ensure_allowed_extension(&path, IMAGE_EXTENSIONS)?;
    ensure_allowed_size(&path)?;
    let bytes = fs::read(&path).map_err(|err| err.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![read_text_file, read_binary_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
