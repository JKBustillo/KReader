// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use tauri_plugin_store::Builder as StoreBuilder;
use tauri::Manager;
use std::sync::Mutex;

struct StartupFile(Mutex<Option<String>>);

#[tauri::command]
fn get_startup_file(state: tauri::State<StartupFile>) -> Option<String> {
    state.0.lock().unwrap().take()
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
        .invoke_handler(tauri::generate_handler![get_startup_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
