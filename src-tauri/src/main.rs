// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use tauri_plugin_store::Builder as StoreBuilder;
use tauri::Manager;
use std::sync::Mutex;
use std::collections::BTreeMap;
use base64::{Engine, engine::general_purpose::STANDARD as BASE64};

struct StartupFile(Mutex<Option<String>>);

#[tauri::command]
fn get_startup_file(state: tauri::State<StartupFile>) -> Option<String> {
    state.0.lock().unwrap().take()
}

#[tauri::command]
fn extract_cbr(path: String) -> Result<Vec<String>, String> {
    let mut archive = unrar::Archive::new(&path)
        .open_for_processing()
        .map_err(|e| e.to_string())?;

    let mut images: BTreeMap<String, (Vec<u8>, String)> = BTreeMap::new();

    while let Some(header) = archive.read_header().map_err(|e| e.to_string())? {
        let name = header.entry().filename.to_string_lossy().to_string();
        let lower = name.to_lowercase();
        let is_image = lower.ends_with(".jpg") || lower.ends_with(".jpeg")
            || lower.ends_with(".png") || lower.ends_with(".gif")
            || lower.ends_with(".webp");

        if header.entry().is_file() && is_image {
            let mime = if lower.ends_with(".png") { "image/png" }
                else if lower.ends_with(".gif") { "image/gif" }
                else if lower.ends_with(".webp") { "image/webp" }
                else { "image/jpeg" };
            let (data, next) = header.read().map_err(|e| e.to_string())?;
            images.insert(name, (data, mime.to_string()));
            archive = next;
        } else {
            archive = header.skip().map_err(|e| e.to_string())?;
        }
    }

    let result = images.into_values()
        .map(|(data, mime)| format!("data:{};base64,{}", mime, BASE64.encode(&data)))
        .collect();

    Ok(result)
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let args: Vec<String> = std::env::args().collect();
            let startup_path = if args.len() > 1 { Some(args[1].clone()) } else { None };
            app.manage(StartupFile(Mutex::new(startup_path)));
            Ok(())
        })
        .plugin(StoreBuilder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(StoreBuilder::default().build())
        .invoke_handler(tauri::generate_handler![get_startup_file, extract_cbr])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
