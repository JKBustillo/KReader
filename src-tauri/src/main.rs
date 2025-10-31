// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use tauri_plugin_store::Builder as StoreBuilder;
use tauri::{Manager, Emitter};
use std::time::Duration;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let args: Vec<String> = std::env::args().collect();
            if args.len() > 1 {
                let path = args[1].clone();
                if let Some(window) = app.webview_windows().get("main") {
                    let window_ = window.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(Duration::from_millis(500));
                        let _ = window_.emit("openCbzFromSystem", path);
                    });
                }
            }
            Ok(())
        })
        .plugin(StoreBuilder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(StoreBuilder::default().build())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
