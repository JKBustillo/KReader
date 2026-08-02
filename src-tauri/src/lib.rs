use tauri_plugin_store::Builder as StoreBuilder;
use tauri::Manager;
use tauri::ipc::Response;
use tauri::http::{HeaderValue, Request as HttpRequest, Response as HttpResponse, StatusCode};
use tauri::http::header::{ACCESS_CONTROL_ALLOW_ORIGIN, CACHE_CONTROL, CONTENT_TYPE};
use percent_encoding::percent_decode_str;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::time::UNIX_EPOCH;

const READER_WINDOW_LABEL_PREFIX: &str = "reader-";

// Fallback window size used when there is no main window to inherit geometry
// from (e.g. main was already closed). Matches the `main` defaults in tauri.conf.json.
const DEFAULT_WINDOW_WIDTH: f64 = 800.0;
const DEFAULT_WINDOW_HEIGHT: f64 = 600.0;

// Custom URI scheme that serves one CBZ/ZIP entry per request (see cbz_page_response).
const PAGE_PROTOCOL: &str = "kreader";
const ENTRY_QUERY_PREFIX: &str = "entry=";

// Lets the webview keep served pages in its own cache, so revisiting a page (or
// the reader's preloading) doesn't re-open and re-inflate the archive. Bounded
// rather than immutable: a page URL is path + entry name, so replacing the file
// on disk while it is open would otherwise serve stale pages indefinitely.
const PAGE_CACHE_CONTROL: &str = "max-age=3600";

// Where CBR/RAR archives are unpacked (under app_cache_dir), and how many
// digits the generated page filenames use.
const CBR_CACHE_SUBDIR: &str = "kreader-cbr";
const EXTRACTED_PAGE_DIGITS: usize = 5;

// Must stay in sync with IMAGE_EXTS in src/loaders/types.ts.
const IMAGE_EXTS: &[&str] = &[".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".avif"];

fn image_mime(lower_name: &str) -> &'static str {
    if lower_name.ends_with(".png") { "image/png" }
    else if lower_name.ends_with(".gif") { "image/gif" }
    else if lower_name.ends_with(".webp") { "image/webp" }
    else if lower_name.ends_with(".bmp") { "image/bmp" }
    else if lower_name.ends_with(".avif") { "image/avif" }
    else { "image/jpeg" }
}

// An archive entry is a page when its (lowercased) name ends in a supported
// image extension.
fn is_image_name(lower_name: &str) -> bool {
    IMAGE_EXTS.iter().any(|ext| lower_name.ends_with(ext))
}

// A file queued for a window to open on mount, plus the optional library it
// belongs to. When a window is spawned from the library's "Open in new window"
// action, library_id lets that window keep the library's reading state in sync
// (in_progress / completed / total pages), matching an in-library open. CLI /
// file-association launches have no library context, so library_id is None.
#[derive(serde::Serialize)]
struct PendingFile {
    path: String,
    library_id: Option<String>,
}

// Maps a window label to the file it should open on mount. Each window reads
// (and clears) its own entry via `take_window_file`. The initial window
// ("main") gets the CLI-argument file; windows spawned by the single-instance
// callback or `open_new_window` get their target file here too. A single
// shared store lives in this one process, so multiple windows never clobber
// each other's persisted state.
struct PendingFiles(Mutex<HashMap<String, PendingFile>>);

// Monotonic counter for unique reader-window labels. Tauri panics on duplicate
// labels, so this must never repeat within a process.
struct WindowCounter(AtomicU32);

// Spawns a new app window in the current process, optionally pre-loading a file.
// library_id is carried only when the file belongs to a library entry (see PendingFile).
fn create_reader_window(app: &tauri::AppHandle, path: Option<String>, library_id: Option<String>) -> Result<(), String> {
    let n = app.state::<WindowCounter>().0.fetch_add(1, Ordering::SeqCst);
    let label = format!("{}{}", READER_WINDOW_LABEL_PREFIX, n);

    if let Some(p) = path {
        app.state::<PendingFiles>()
            .0
            .lock()
            .unwrap()
            .insert(label.clone(), PendingFile { path: p, library_id });
    }

    // Inherit geometry from the main window so new windows match the user's
    // current sizing instead of a fixed default. If main is maximized, open
    // maximized too but keep a sensible un-maximize size from the default.
    let main = app.get_webview_window("main");
    let maximized = main
        .as_ref()
        .and_then(|w| w.is_maximized().ok())
        .unwrap_or(false);
    let (width, height) = match main.as_ref() {
        Some(w) if !maximized => match (w.inner_size(), w.scale_factor()) {
            (Ok(size), Ok(scale)) => (size.width as f64 / scale, size.height as f64 / scale),
            _ => (DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT),
        },
        _ => (DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT),
    };

    tauri::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::App("index.html".into()))
        .title("KReader")
        .inner_size(width, height)
        .maximized(maximized)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn take_window_file(window: tauri::Window, state: tauri::State<PendingFiles>) -> Option<PendingFile> {
    state.0.lock().unwrap().remove(window.label())
}

// Must be async: synchronous commands run on the main thread, and building a
// WebviewWindow (WebView2 on Windows) needs the main thread's event loop to be
// pumping. Calling build() from a sync command deadlocks the UI. Running async
// moves this off the main thread so build() can dispatch window creation to the
// now-free main thread. The single-instance callback also runs on the main thread,
// so it spawns create_reader_window onto the async runtime for the same reason.
#[tauri::command]
async fn open_new_window(app: tauri::AppHandle, path: Option<String>, library_id: Option<String>) -> Result<(), String> {
    create_reader_window(&app, path, library_id)
}

// Absolute paths of a CBR's unpacked pages, plus the directory holding them so
// the frontend can delete it once the archive is closed.
#[derive(serde::Serialize)]
struct ExtractedArchive {
    dir: String,
    pages: Vec<String>,
}

fn cbr_cache_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map(|dir| dir.join(CBR_CACHE_SUBDIR))
        .map_err(|e| e.to_string())
}

// Stable, filesystem-safe directory name for an archive path.
fn cache_key(path: &str) -> String {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

// Unpacks a CBR/RAR to a directory under app_cache_dir and returns the page
// file paths. RAR is a streaming format (no random access to entries), so the
// archive has to be walked once up front — but unrar writes each page straight
// to disk, so peak memory stays flat regardless of archive size. The frontend
// then loads each page from disk through the asset protocol instead of holding
// the whole comic in the WebView heap.
#[tauri::command]
fn extract_cbr_to_dir(app: tauri::AppHandle, path: String) -> Result<ExtractedArchive, String> {
    let dir = cbr_cache_root(&app)?.join(cache_key(&path));
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let mut archive = unrar::Archive::new(&path)
        .open_for_processing()
        .map_err(|e| e.to_string())?;

    // Keyed by entry name so pages come back in alphabetical order, matching
    // how the archive's own listing is sorted.
    let mut pages: BTreeMap<String, String> = BTreeMap::new();

    while let Some(header) = archive.read_header().map_err(|e| e.to_string())? {
        let name = header.entry().filename.to_string_lossy().to_string();
        let lower = name.to_lowercase();

        if header.entry().is_file() && is_image_name(&lower) {
            // Generated flat filenames, never the entry's own: archive names can
            // contain subfolders or `..` segments that must not reach the disk.
            let ext = lower.rsplit('.').next().unwrap_or("jpg");
            let out = dir.join(format!(
                "{:0width$}.{}",
                pages.len(),
                ext,
                width = EXTRACTED_PAGE_DIGITS
            ));
            archive = header.extract_to(&out).map_err(|e| e.to_string())?;
            pages.insert(name, out.to_string_lossy().to_string());
        } else {
            archive = header.skip().map_err(|e| e.to_string())?;
        }
    }

    if pages.is_empty() {
        let _ = std::fs::remove_dir_all(&dir);
        return Err("No images found in archive".into());
    }

    Ok(ExtractedArchive {
        dir: dir.to_string_lossy().to_string(),
        pages: pages.into_values().collect(),
    })
}

// Image entry names of a CBZ/ZIP, read from the central directory only (no
// decompression). The frontend sorts them and turns each into a PAGE_PROTOCOL
// URL, so pages are decompressed one at a time, on demand.
#[tauri::command]
fn list_cbz_pages(path: String) -> Result<Vec<String>, String> {
    let file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    let mut names = Vec::new();
    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_file() && is_image_name(&entry.name().to_lowercase()) {
            names.push(entry.name().to_string());
        }
    }

    if names.is_empty() {
        return Err("No images found in archive".into());
    }
    Ok(names)
}

// Reads one entry out of a CBZ/ZIP. Only the central directory plus that single
// compressed entry are touched, so serving a page costs the same on a 20 MB
// archive as on a 2 GB one.
// URL shape: <PAGE_PROTOCOL>://<url-encoded archive path>?entry=<url-encoded entry name>
fn read_cbz_entry(request: &HttpRequest<Vec<u8>>) -> Result<(&'static str, Vec<u8>), String> {
    use std::io::Read;

    let uri = request.uri();
    let archive_path = decode_uri_component(uri.path().trim_start_matches('/'))?;
    let entry_name = uri
        .query()
        .and_then(|query| {
            query
                .split('&')
                .find_map(|param| param.strip_prefix(ENTRY_QUERY_PREFIX))
        })
        .ok_or("missing entry parameter")?;
    let entry_name = decode_uri_component(entry_name)?;

    let file = std::fs::File::open(&archive_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let mut entry = archive.by_name(&entry_name).map_err(|e| e.to_string())?;

    let mut data = Vec::with_capacity(entry.size() as usize);
    entry.read_to_end(&mut data).map_err(|e| e.to_string())?;

    Ok((image_mime(&entry_name.to_lowercase()), data))
}

fn decode_uri_component(value: &str) -> Result<String, String> {
    percent_decode_str(value)
        .decode_utf8()
        .map(|decoded| decoded.into_owned())
        .map_err(|e| e.to_string())
}

fn cbz_page_response(request: &HttpRequest<Vec<u8>>) -> HttpResponse<Vec<u8>> {
    match read_cbz_entry(request) {
        Ok((mime, data)) => {
            let mut response = HttpResponse::new(data);
            let headers = response.headers_mut();
            headers.insert(CONTENT_TYPE, HeaderValue::from_static(mime));
            headers.insert(ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
            headers.insert(CACHE_CONTROL, HeaderValue::from_static(PAGE_CACHE_CONTROL));
            response
        }
        Err(message) => {
            let mut response = HttpResponse::new(message.into_bytes());
            *response.status_mut() = StatusCode::NOT_FOUND;
            response
        }
    }
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
        let is_image = is_image_name(&lower);

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
        if is_image_name(&lower) {
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

// --- EPUB cover extraction helpers ---------------------------------------
// An EPUB is a ZIP whose cover image is declared in the OPF package document.
// The OPF is small, so we scan it as text (attribute order varies) instead of
// pulling in a full XML parser.

// Reads a single attribute value (name="value" or name='value') from a tag body.
// The whitespace guard before the match avoids matching a suffix of another
// attribute name (e.g. `type=` inside `media-type=`).
fn get_attr(tag: &str, name: &str) -> Option<String> {
    let key = format!("{}=", name);
    let mut start = 0;
    while let Some(pos) = tag[start..].find(&key) {
        let idx = start + pos;
        let preceded_by_space = tag[..idx].chars().last().map_or(true, |c| c.is_whitespace());
        if preceded_by_space {
            let after = &tag[idx + key.len()..];
            if let Some(quote) = after.chars().next() {
                if quote == '"' || quote == '\'' {
                    let rest = &after[1..];
                    if let Some(end) = rest.find(quote) {
                        return Some(rest[..end].to_string());
                    }
                }
            }
        }
        start = idx + key.len();
    }
    None
}

// Returns the body (attributes) of each `<tag ...>` element. The trailing-char
// check keeps `<item` from matching `<itemref`.
fn element_bodies<'a>(xml: &'a str, tag: &str) -> Vec<&'a str> {
    let open = format!("<{}", tag);
    let mut out = Vec::new();
    let mut start = 0;
    while let Some(pos) = xml[start..].find(&open) {
        let after = start + pos + open.len();
        let is_tag = xml[after..].chars().next().map_or(false, |c| c.is_whitespace() || c == '>' || c == '/');
        if is_tag {
            if let Some(end) = xml[after..].find('>') {
                out.push(&xml[after..after + end]);
                start = after + end + 1;
                continue;
            }
        }
        start = after;
    }
    out
}

// Cover image href (relative to the OPF), trying EPUB3 properties, then the
// EPUB2 <meta name="cover"> id reference, then the first image in the manifest.
fn find_cover_href(opf: &str) -> Option<String> {
    let items = element_bodies(opf, "item");

    for tag in &items {
        if let Some(props) = get_attr(tag, "properties") {
            if props.split_whitespace().any(|p| p == "cover-image") {
                return get_attr(tag, "href");
            }
        }
    }

    let cover_id = element_bodies(opf, "meta").into_iter().find_map(|tag| {
        if get_attr(tag, "name").as_deref() == Some("cover") {
            get_attr(tag, "content")
        } else {
            None
        }
    });
    if let Some(id) = cover_id {
        for tag in &items {
            if get_attr(tag, "id").as_deref() == Some(id.as_str()) {
                return get_attr(tag, "href");
            }
        }
    }

    items.iter().find_map(|tag| {
        get_attr(tag, "media-type")
            .filter(|mt| mt.starts_with("image/"))
            .and_then(|_| get_attr(tag, "href"))
    })
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

// EPUB hrefs are URL-encoded (e.g. spaces as %20) but zip entry names are literal.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                out.push(hi * 16 + lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

// Joins an href to the OPF's directory and collapses "." / ".." segments.
fn resolve_zip_path(opf_path: &str, href: &str) -> String {
    let dir = opf_path.rfind('/').map(|i| &opf_path[..i + 1]).unwrap_or("");
    let joined = format!("{}{}", dir, percent_decode(href));
    let mut parts: Vec<&str> = Vec::new();
    for seg in joined.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            s => parts.push(s),
        }
    }
    parts.join("/")
}

// Extracts the cover image from an EPUB for thumbnail generation. Reads only the
// container.xml, the OPF, and the single cover entry — never the whole book.
// Returns the same binary layout (count=1) as extract_cbz_cover.
#[tauri::command]
fn extract_epub_cover(path: String) -> Result<Response, String> {
    use std::io::Read;

    let file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    let read_text = |archive: &mut zip::ZipArchive<std::fs::File>, name: &str| -> Option<String> {
        let mut entry = archive.by_name(name).ok()?;
        let mut s = String::new();
        entry.read_to_string(&mut s).ok()?;
        Some(s)
    };

    let container = read_text(&mut archive, "META-INF/container.xml")
        .ok_or("EPUB missing META-INF/container.xml")?;
    let opf_path = element_bodies(&container, "rootfile")
        .into_iter()
        .find_map(|tag| get_attr(tag, "full-path"))
        .ok_or("EPUB container has no rootfile")?;

    let opf = read_text(&mut archive, &opf_path).ok_or("EPUB OPF not found")?;
    let href = find_cover_href(&opf).ok_or("EPUB has no cover image")?;
    let cover_path = resolve_zip_path(&opf_path, &href);

    let mime = image_mime(&cover_path.to_lowercase());
    let mut entry = archive.by_name(&cover_path).map_err(|e| e.to_string())?;
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
    "cbz", "cbr", "zip", "rar", "pdf", "epub",
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
                    is_image_name(&lower)
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
            is_image_name(&lower)
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
            // The single-instance callback runs on the main thread (dispatched by
            // the event loop on receiving the second instance's message). Building a
            // WebView2 window synchronously here would deadlock — build() needs the
            // main thread's event loop free to dispatch window creation. Spawn it off
            // the main thread, mirroring why open_new_window is async.
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = create_reader_window(&app, file, None);
            });
        }))
        // Persists window size, position, maximized and fullscreen state per
        // window label to .window-state.dat, restoring on launch. The main
        // window (stable label) is the one that round-trips across sessions.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            let args: Vec<String> = std::env::args().collect();
            let startup_path = if args.len() > 1 { Some(args[1].clone()) } else { None };
            let mut pending = HashMap::new();
            if let Some(p) = startup_path {
                pending.insert("main".to_string(), PendingFile { path: p, library_id: None });
            }
            app.manage(PendingFiles(Mutex::new(pending)));
            app.manage(WindowCounter(AtomicU32::new(1)));

            // Drop CBR extractions left behind by a previous run (a crash, or a
            // window closed without unloading). Single-instance guarantees this
            // is the only process, so nothing here is in use yet.
            if let Ok(root) = cbr_cache_root(app.handle()) {
                let _ = std::fs::remove_dir_all(root);
            }
            Ok(())
        })
        // Serves CBZ/ZIP pages straight out of the archive, one entry per
        // request. Registered on the builder so every window can use it.
        .register_asynchronous_uri_scheme_protocol(PAGE_PROTOCOL, |_ctx, request, responder| {
            // Reading + inflating an entry is blocking I/O; keep it off the
            // thread driving the webview. A thread per request is enough for the
            // handful of pages a view has in flight; pool them if that changes.
            std::thread::spawn(move || responder.respond(cbz_page_response(&request)));
        })
        .plugin(StoreBuilder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![take_window_file, open_new_window, list_cbz_pages, extract_cbr_to_dir, extract_cbr_cover, extract_cbz_cover, extract_epub_cover, scan_library, list_subdirs, trash_file, count_cbz_pages, count_pdf_pages, count_cbr_pages])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};

    fn encode(value: &str) -> String {
        utf8_percent_encode(value, NON_ALPHANUMERIC).to_string()
    }

    // Round-trips the CBZ page pipeline: list the entries, build the URL the
    // frontend builds (convertFileSrc + ?entry=), and serve that one entry.
    #[test]
    fn serves_a_single_cbz_entry_by_url() {
        let dir = std::env::temp_dir().join("kreader-cbz-page-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let archive_path = dir.join("test.cbz");

        {
            let file = std::fs::File::create(&archive_path).unwrap();
            let mut writer = zip::ZipWriter::new(file);
            let options = zip::write::SimpleFileOptions::default();
            // Name with a subfolder and a space: both survive URL encoding.
            writer.start_file("pages/002 b.png", options).unwrap();
            std::io::Write::write_all(&mut writer, b"PNGDATA").unwrap();
            writer.start_file("notes.txt", options).unwrap();
            std::io::Write::write_all(&mut writer, b"ignored").unwrap();
            writer.finish().unwrap();
        }

        let archive = archive_path.to_string_lossy().to_string();
        let names = list_cbz_pages(archive.clone()).unwrap();
        assert_eq!(names, vec!["pages/002 b.png".to_string()]);

        let request = |entry: &str| {
            HttpRequest::builder()
                .uri(format!(
                    "http://{}.localhost/{}?{}{}",
                    PAGE_PROTOCOL,
                    encode(&archive),
                    ENTRY_QUERY_PREFIX,
                    encode(entry)
                ))
                .body(Vec::new())
                .unwrap()
        };

        let response = cbz_page_response(&request(&names[0]));
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[CONTENT_TYPE], "image/png");
        assert_eq!(response.body().as_slice(), b"PNGDATA");

        let missing = cbz_page_response(&request("nope.png"));
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);

        std::fs::remove_dir_all(&dir).unwrap();
    }
}
