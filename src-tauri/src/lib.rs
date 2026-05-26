use tauri_plugin_store::Builder as StoreBuilder;
use tauri::Manager;
use tauri::ipc::Response;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::time::UNIX_EPOCH;

const READER_WINDOW_LABEL_PREFIX: &str = "reader-";

const IMAGE_EXTS: &[&str] = &[".jpg", ".jpeg", ".png", ".gif", ".webp"];

fn image_mime(lower_name: &str) -> &'static str {
    if lower_name.ends_with(".png") { "image/png" }
    else if lower_name.ends_with(".gif") { "image/gif" }
    else if lower_name.ends_with(".webp") { "image/webp" }
    else { "image/jpeg" }
}

// Maps a window label to the file path it should open on mount. Each window
// reads (and clears) its own entry via `take_window_file`. The initial window
// ("main") gets the CLI-argument file; windows spawned by the single-instance
// callback or `open_new_window` get their target file here too. A single
// shared store lives in this one process, so multiple windows never clobber
// each other's persisted state.
struct PendingFiles(Mutex<HashMap<String, String>>);

// Monotonic counter for unique reader-window labels. Tauri panics on duplicate
// labels, so this must never repeat within a process.
struct WindowCounter(AtomicU32);

// Spawns a new app window in the current process, optionally pre-loading a file.
fn create_reader_window(app: &tauri::AppHandle, path: Option<String>) -> Result<(), String> {
    let n = app.state::<WindowCounter>().0.fetch_add(1, Ordering::SeqCst);
    let label = format!("{}{}", READER_WINDOW_LABEL_PREFIX, n);

    if let Some(p) = path {
        app.state::<PendingFiles>()
            .0
            .lock()
            .unwrap()
            .insert(label.clone(), p);
    }

    tauri::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::App("index.html".into()))
        .title("KReader")
        .inner_size(800.0, 600.0)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn take_window_file(window: tauri::Window, state: tauri::State<PendingFiles>) -> Option<String> {
    state.0.lock().unwrap().remove(window.label())
}

// Must be async: synchronous commands run on the main thread, and building a
// WebviewWindow (WebView2 on Windows) needs the main thread's event loop to be
// pumping. Calling build() from a sync command deadlocks the UI. Running async
// moves this off the main thread so build() can dispatch window creation to the
// now-free main thread. The single-instance callback creates windows directly
// (it isn't blocking an IPC response), so create_reader_window stays sync.
#[tauri::command]
async fn open_new_window(app: tauri::AppHandle, path: Option<String>) -> Result<(), String> {
    create_reader_window(&app, path)
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

#[tauri::command]
fn list_subdirs(root: String) -> Result<Vec<String>, String> {
    let root_path = PathBuf::from(&root);
    let mut result = vec!["/".to_string()];
    let mut dirs: Vec<PathBuf> = vec![root_path.clone()];

    while let Some(dir) = dirs.pop() {
        let read_dir = match std::fs::read_dir(&dir) {
            Ok(rd) => rd,
            Err(_) => continue,
        };
        for entry in read_dir.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let rel = path
                    .strip_prefix(&root_path)
                    .map(|p| p.to_string_lossy().replace('\\', "/"))
                    .unwrap_or_default();
                if !rel.is_empty() {
                    result.push(rel);
                }
                dirs.push(path);
            }
        }
    }

    result.sort();
    Ok(result)
}

#[tauri::command]
fn count_cbz_pages(path: String) -> Result<u32, String> {
    let file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let count = (0..archive.len())
        .filter(|&i| {
            archive
                .name_for_index(i)
                .map(|name| {
                    let lower = name.to_lowercase();
                    IMAGE_EXTS.iter().any(|ext| lower.ends_with(ext))
                })
                .unwrap_or(false)
        })
        .count();
    Ok(count as u32)
}

#[tauri::command]
fn count_pdf_pages(path: String) -> Result<u32, String> {
    let doc = lopdf::Document::load(&path).map_err(|e| e.to_string())?;
    Ok(doc.get_pages().len() as u32)
}

#[tauri::command]
fn count_cbr_pages(path: String) -> Result<u32, String> {
    let archive = unrar::Archive::new(&path)
        .open_for_listing()
        .map_err(|e| e.to_string())?;
    let count = archive
        .filter_map(|entry| entry.ok())
        .filter(|header| {
            if !header.is_file() {
                return false;
            }
            let lower = header.filename.to_string_lossy().to_lowercase();
            IMAGE_EXTS.iter().any(|ext| lower.ends_with(ext))
        })
        .count();
    Ok(count as u32)
}

#[tauri::command]
fn trash_file(path: String) -> Result<(), String> {
    if !std::path::Path::new(&path).exists() {
        return Ok(());
    }
    match trash::delete(&path) {
        Ok(_) => Ok(()),
        Err(_) => std::fs::remove_file(&path).map_err(|e| e.to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // The single-instance plugin must be registered first. When a second
        // launch is intercepted (e.g. OS file association double-click), the
        // primary process spawns a new window for the incoming file instead.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let file = argv.get(1).filter(|s| !s.is_empty()).cloned();
            let _ = create_reader_window(app, file);
        }))
        .setup(|app| {
            let args: Vec<String> = std::env::args().collect();
            let startup_path = if args.len() > 1 { Some(args[1].clone()) } else { None };
            let mut pending = HashMap::new();
            if let Some(p) = startup_path {
                pending.insert("main".to_string(), p);
            }
            app.manage(PendingFiles(Mutex::new(pending)));
            app.manage(WindowCounter(AtomicU32::new(1)));
            Ok(())
        })
        .plugin(StoreBuilder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![take_window_file, open_new_window, extract_cbr, extract_cbr_cover, extract_cbz_cover, scan_library, list_subdirs, trash_file, count_cbz_pages, count_pdf_pages, count_cbr_pages])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
