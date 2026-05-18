use tauri_plugin_store::Builder as StoreBuilder;
use tauri::Manager;
use tauri::ipc::Response;
use std::sync::Mutex;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::UNIX_EPOCH;

const IMAGE_EXTS: &[&str] = &[".jpg", ".jpeg", ".png", ".gif", ".webp"];

fn image_mime(lower_name: &str) -> &'static str {
    if lower_name.ends_with(".png") { "image/png" }
    else if lower_name.ends_with(".gif") { "image/gif" }
    else if lower_name.ends_with(".webp") { "image/webp" }
    else { "image/jpeg" }
}

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
        let is_image = IMAGE_EXTS.iter().any(|ext| lower.ends_with(ext));

        if header.entry().is_file() && is_image {
            let mime = image_mime(&lower);
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

// Extracts only the first image from a CBR/RAR archive using the same
// binary layout as extract_cbr (count=1). Stops immediately after the
// first image found — no need to scan the entire archive for a cover.
#[tauri::command]
fn extract_cbr_cover(path: String) -> Result<Response, String> {
    let mut archive = unrar::Archive::new(&path)
        .open_for_processing()
        .map_err(|e| e.to_string())?;

    while let Some(header) = archive.read_header().map_err(|e| e.to_string())? {
        let name = header.entry().filename.to_string_lossy().to_string();
        let lower = name.to_lowercase();
        let is_image = IMAGE_EXTS.iter().any(|ext| lower.ends_with(ext));

        if header.entry().is_file() && is_image {
            let mime = image_mime(&lower);
            let (data, _) = header.read().map_err(|e| e.to_string())?;

            let total = 4 + 1 + mime.len() + 4 + data.len();
            let mut buf = Vec::with_capacity(total);
            buf.extend_from_slice(&1u32.to_le_bytes());
            buf.push(mime.len() as u8);
            buf.extend_from_slice(mime.as_bytes());
            buf.extend_from_slice(&(data.len() as u32).to_le_bytes());
            buf.extend_from_slice(&data);

            return Ok(Response::new(buf));
        } else {
            archive = header.skip().map_err(|e| e.to_string())?;
        }
    }

    Err("No images found in archive".into())
}

// Extracts only the first image (alphabetically) from a CBZ/ZIP archive.
// Uses the zip crate so only the central directory + one compressed entry
// are read — the full archive is never loaded into memory.
// Returns the same binary layout as extract_cbr_cover (count=1).
#[tauri::command]
fn extract_cbz_cover(path: String) -> Result<Response, String> {
    use std::io::Read;

    let file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    // Collect image entries from the central directory (no decompression yet).
    let mut images: Vec<(String, usize)> = Vec::new();
    for i in 0..archive.len() {
        let name = {
            let entry = archive.by_index(i).map_err(|e| e.to_string())?;
            entry.name().to_string()
        };
        let lower = name.to_lowercase();
        if IMAGE_EXTS.iter().any(|ext| lower.ends_with(ext)) {
            images.push((name, i));
        }
    }

    if images.is_empty() {
        return Err("No images found in archive".into());
    }

    // Alphabetical sort handles zero-padded sequences (001.jpg, 002.jpg, …).
    images.sort_by(|(a, _), (b, _)| a.to_lowercase().cmp(&b.to_lowercase()));

    let (name, index) = &images[0];
    let mime = image_mime(&name.to_lowercase());

    let mut entry = archive.by_index(*index).map_err(|e| e.to_string())?;
    let mut data = Vec::new();
    entry.read_to_end(&mut data).map_err(|e| e.to_string())?;

    let total = 4 + 1 + mime.len() + 4 + data.len();
    let mut buf = Vec::with_capacity(total);
    buf.extend_from_slice(&1u32.to_le_bytes());
    buf.push(mime.len() as u8);
    buf.extend_from_slice(mime.as_bytes());
    buf.extend_from_slice(&(data.len() as u32).to_le_bytes());
    buf.extend_from_slice(&data);

    Ok(Response::new(buf))
}

#[derive(serde::Serialize)]
struct ScannedFile {
    path: String,
    filename: String,
    size_bytes: u64,
    modified_secs: u64,
}

const SUPPORTED_EXTS: &[&str] = &[
    "cbz", "cbr", "zip", "rar", "pdf",
    "jpg", "jpeg", "png", "gif", "webp", "bmp", "avif",
];

#[tauri::command]
fn scan_library(root: String) -> Result<Vec<ScannedFile>, String> {
    let mut results = Vec::new();
    let mut dirs: Vec<PathBuf> = vec![PathBuf::from(&root)];

    while let Some(dir) = dirs.pop() {
        let read_dir = match std::fs::read_dir(&dir) {
            Ok(rd) => rd,
            Err(_) => continue, // skip unreadable directories silently
        };

        for entry in read_dir.flatten() {
            let path = entry.path();
            let metadata = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };

            if metadata.is_dir() {
                dirs.push(path);
                continue;
            }

            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_lowercase())
                .unwrap_or_default();

            if !SUPPORTED_EXTS.contains(&ext.as_str()) {
                continue;
            }

            let modified_secs = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            let filename = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default()
                .to_string();

            results.push(ScannedFile {
                path: path.to_string_lossy().to_string(),
                filename,
                size_bytes: metadata.len(),
                modified_secs,
            });
        }
    }

    results.sort_by(|a, b| a.filename.to_lowercase().cmp(&b.filename.to_lowercase()));
    Ok(results)
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
        .invoke_handler(tauri::generate_handler![get_startup_file, extract_cbr, extract_cbr_cover, extract_cbz_cover, scan_library])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
