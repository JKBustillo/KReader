use tauri_plugin_store::Builder as StoreBuilder;
use tauri::Manager;
use tauri::ipc::Response;
use std::sync::Mutex;
use std::collections::BTreeMap;

struct StartupFile(Mutex<Option<String>>);

#[tauri::command]
fn get_startup_file(state: tauri::State<StartupFile>) -> Option<String> {
    state.0.lock().unwrap().take()
}

// Binary response layout:
//   u32 LE  count
//   for each page:
//     u8       mime_len
//     [bytes]  mime (ASCII)
//     u32 LE   data_len
//     [bytes]  image data
//
// We use Response (raw IPC bytes) instead of base64 data: URLs to avoid
// the 33% size inflation and to keep the bytes outside of V8's heap.
// JS rebuilds blob URLs from the slices.
#[tauri::command]
fn extract_cbr(path: String) -> Result<Response, String> {
    let mut archive = unrar::Archive::new(&path)
        .open_for_processing()
        .map_err(|e| e.to_string())?;

    let mut images: BTreeMap<String, (Vec<u8>, &'static str)> = BTreeMap::new();

    while let Some(header) = archive.read_header().map_err(|e| e.to_string())? {
        let name = header.entry().filename.to_string_lossy().to_string();
        let lower = name.to_lowercase();
        let is_image = lower.ends_with(".jpg") || lower.ends_with(".jpeg")
            || lower.ends_with(".png") || lower.ends_with(".gif")
            || lower.ends_with(".webp");

        if header.entry().is_file() && is_image {
            let mime: &'static str = if lower.ends_with(".png") { "image/png" }
                else if lower.ends_with(".gif") { "image/gif" }
                else if lower.ends_with(".webp") { "image/webp" }
                else { "image/jpeg" };
            let (data, next) = header.read().map_err(|e| e.to_string())?;
            images.insert(name, (data, mime));
            archive = next;
        } else {
            archive = header.skip().map_err(|e| e.to_string())?;
        }
    }

    let total: usize = 4 + images.values()
        .map(|(d, m)| 1 + m.len() + 4 + d.len())
        .sum::<usize>();

    let mut buf = Vec::with_capacity(total);
    buf.extend_from_slice(&(images.len() as u32).to_le_bytes());
    for (data, mime) in images.into_values() {
        buf.push(mime.len() as u8);
        buf.extend_from_slice(mime.as_bytes());
        buf.extend_from_slice(&(data.len() as u32).to_le_bytes());
        buf.extend_from_slice(&data);
    }

    Ok(Response::new(buf))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
        .invoke_handler(tauri::generate_handler![get_startup_file, extract_cbr])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
