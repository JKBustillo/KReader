# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

KReader is a lightweight desktop comic/document reader built with Tauri v2 + React + TypeScript. It supports CBZ, CBR, ZIP, RAR, PDF, and standalone image files. It also includes a library system for organizing and browsing collections.

## Commands

```bash
# Development (starts Vite on port 1420 + Tauri window)
npm run dev

# Production build
npm run build

# Lint
npm run lint
```

There are no tests. Vite's dev server **must** run on port 1420 — Tauri hardcodes this in `tauri.conf.json`.

## Architecture

### Source layout

```
src/
  App.tsx                       Entry point: dialog, recent files, theme/lang, format dispatch,
                                  last-view persistence, hotkey guard for input elements
  components/
    Reader.tsx                  Stateful viewer for image-based formats (CBZ/CBR/folder)
    PDFReader.tsx               Stateful viewer for PDFs (uses pdfjs canvas + text layer)
    ReaderOverlay.tsx           Floating shortcuts panel + page info indicator
    NavBar.tsx                  Top nav: home/library toggle + botón engranaje (abre SettingsModal)
    LibraryView.tsx             Main library UI: scan, filter (tags + folders), sort, view mode,
                                  ambiguous-file resolution, tag editor modal
    LibraryCard.tsx             Grid-view card for a library entry (cover thumbnail + metadata)
    LibraryDetailsRow.tsx       Details-view row for a library entry
    TagEditor.tsx               Modal for adding/removing custom tags; supports single and
                                  multi-entry mode, autocomplete suggestions
    SettingsModal.tsx           Modal de ajustes: tema (dark/light), idioma (ES/EN),
                                  export/import de biblioteca. Abre desde el engranaje de NavBar.
  hooks/
    useReadingProgress.ts       Per-file pageIndex + cascadeMode state, persisted to .reading-progress.dat
    useReaderShortcuts.ts       Owns the keyboard switch for Reader (Ctrl+Arrow, C/D/S/G/I/P/J/+/-/Home/End/Escape/F/X)
    useOverlayAutoHide.ts       Shared overlay visibility: shows on mousemove, hides after 1.5s (suppressed while info is pinned). Used by Reader and PDFReader.
    usePinPageIndicator.ts      Shared pin-page-indicator state, persisted to .settings.dat. Used by Reader and PDFReader.
  loaders/
    index.ts                    detectKind(path) + loadPages(path) dispatcher
    loadCbz.ts                  CBZ/ZIP via JSZip → blob URLs
    loadCbr.ts                  CBR/RAR via invoke('extract_cbr')
    loadImageFolder.ts          Single image → loads whole folder, sorted numerically
    types.ts                    IMAGE_EXTS, LoaderResult
  types/
    library.ts                  Tag, TagCategory, Library, LibraryEntry, ReadingState,
                                  SortField, SortDirection, ViewMode
  utils/
    recentFiles.ts              Lazy-init wrapper around .recent-files.dat
    theme.ts                    Theme persisted in localStorage
    libraryStore.ts             Library + entries CRUD against .library.dat
    settingsStore.ts            Global settings CRUD against .settings.dat
    thumbnails.ts               Cover extraction (CBZ/CBR/PDF/image) + disk+memory cache
    parseTags.ts                Auto-tag parsing from filename brackets [Author (Circle)]
    folderUtils.ts              getRelativeFolder(entryPath, rootPath) shared util
  i18n/                         react-i18next setup (en, es)
```

### Data flow

1. `App.tsx` opens files via `@tauri-apps/plugin-dialog`, calls `detectKind(path)` then either `loadPages(path)` (for image-based formats) or reads the bytes directly for PDF.
2. Image-based formats return `{ pages: string[], pageNames?, startPage? }`. Those URLs are tracked in `blobUrlsRef` and revoked the next time `handleOpen` runs or `resetPages` fires.
3. `Reader.tsx` receives the page array and delegates persistence to `useReadingProgress` and keyboard handling to `useReaderShortcuts`. Overlay visuals live in `<ReaderOverlay>`.
4. PDF takes a separate path: bytes are passed to `<PDFReader>`, which renders pages on a canvas via `pdfjs-dist`.

### State persistence (Tauri Store)

- `.recent-files.dat` — list of up to 10 recently opened file paths.
- `.reading-progress.dat` — per-file page index (`{filePath}-page`) and cascade mode flag (`{filePath}-cascade`), keyed by absolute file path.
- `.settings.dat` — global app settings. Current keys:
  - `pin-page-indicator` — boolean, pin page number overlay.
  - `library-view-mode` — `"details" | "grid"`, last used view mode in library.
  - `last-app-view` — `"home" | "library"`, restores active view on next launch.
  - `folder-filter:<libraryId>` — `Record<string, "full" | "partial">`, persisted folder filter per library.
- `.library.dat` — library definitions and entries. Keys:
  - `libraries` — `Library[]` list of all libraries.
  - `entries:<libraryId>` — `LibraryEntry[]` for that library.

**Rule:** All store access must go through the utility wrappers (`libraryStore.ts`, `settingsStore.ts`, `recentFiles.ts`). Never instantiate `Store` directly in a component or hook, and never use key strings outside the owning util file.

### Library system

`LibraryView.tsx` manages a collection of `LibraryEntry` objects, each pointing to a file on disk.

**Scan flow:** `invoke('scan_library', { root })` returns `ScannedFile[]` (path, filename, sizeBytes, modifiedSecs). Each scanned file is matched against stored entries by `filename + sizeBytes`. New files get `parseAutoTags(filename)` applied and are inserted; existing entries keep their custom tags, reading state, etc.

- Single match → auto-relocates `currentPath` if it changed.
- Multiple matches (same name+size in different subfolders) → stored in `ambiguousCandidates`; user resolves via context menu "Resolver ubicación" → resolution modal.

**Entry identity:** `id = "{filename}::{sizeBytes}"`. This means renames are treated as new files; moving within the library root is auto-resolved on next scan.

**Rating system:**
- `rating?: number` (1–5) stored per entry in `LibraryEntry`. Optional — entries without rating have `undefined`.
- `setRating(id, libraryId, rating: number | undefined)` in `libraryStore.ts`. Passing `undefined` clears the rating.
- UI: 5 clickable stars (★/☆) in `LibraryDetailsRow` (column after favorite) and `LibraryCard` (below title). Clicking the active star toggles it off.

**Tag system:**
- `autoTags` — parsed on scan from filename brackets, e.g. `[Circle (Author)]` → circle + author tags. Stored but never manually edited.
- `customTags` — user-defined, stored per entry. Multi-entry edits use `batchSetCustomTags` (single read-modify-write) to avoid concurrent-write race conditions.
- Tag filter in UI is session-only (module-level variable `sessionSelectedTags`; survives component unmount but resets on app restart).

**Folder filter:**
- Three states per folder: unselected → `"full"` (✓, includes subdirectories recursively) → `"partial"` (—, direct children only) → unselected.
- Union semantics: an entry matches if any selected folder covers it.
- Persisted to `.settings.dat` under `folder-filter:<libraryId>`, loaded on library switch, saved on change.
- A ref guard (`folderFilterLoadedForLibRef`) prevents saving before the async load completes.

**Thumbnails (`utils/thumbnails.ts`):**
- In-memory cache (deduplicates concurrent requests per session).
- Disk cache in `appCacheDir()/kreader-thumbnails/`, keyed by entry ID, stored as JPEG.
- Concurrent generation limited to `MAX_CONCURRENT = 4` via semaphore.
- Cover extraction: `extract_cbz_cover` / `extract_cbr_cover` (Rust IPC, raw bytes), `pdfjs` for PDF, direct `readFile` for images.

### Rust backend (`src-tauri/src/`)

- `main.rs` — trivial: just calls `kreader_lib::run()`.
- `lib.rs` — exposes Tauri commands:
  - `get_startup_file` — returns the path passed as CLI argument (used for OS file associations).
  - `extract_cbr(path)` — unpacks a full CBR/RAR archive; returns all images as raw binary response.
  - `extract_cbr_cover(path)` — returns only the first image from a CBR/RAR (for thumbnails). Stops after first image found.
  - `extract_cbz_cover(path)` — returns only the first image from a CBZ/ZIP (alphabetically sorted); reads only the central directory + one compressed entry.
  - `scan_library(root)` — recursive directory walk returning `ScannedFile[]` (path, filename, size_bytes, modified_secs) for all supported extensions.
  - `list_subdirs(root)` — recursive walk returning all subdirectory paths relative to root (`"/"` for root itself, `"Leído"`, `"Leído/Archivado"`, etc.). Used by the "Move to folder" context menu action.
  - `trash_file(path)` — sends a file to the OS trash via the `trash` crate; falls back to permanent deletion if trash is unavailable.

All commands return `Result<T, String>`. Large binary data (images) is returned as `tauri::ipc::Response` (raw bytes) to avoid base64 inflation and keep bytes outside V8's heap.

**Binary response layout** (used by `extract_cbr`, `extract_cbr_cover`, `extract_cbz_cover`):
```
u32 LE  count
for each image:
  u8       mime_len
  [bytes]  mime (ASCII)
  u32 LE   data_len
  [bytes]  image data
```

All other file I/O and format decoding happens in the frontend via Tauri JS plugins.

### Sibling-file navigation (Ctrl+Arrow)

`Ctrl+ArrowRight/Left` in Reader behaves differently depending on the open file:

- **CBZ/CBR/ZIP/RAR**: reads the parent directory, lists files with the same extension, fires a `CustomEvent("openNewCbz", { detail: path })` on `window`. `App.tsx` listens for it and reloads.
- **Standalone image**: the whole folder is already loaded as pages, so it just advances/rewinds the page index in place.

### System file associations

`App.tsx` also listens for the Tauri event `openCbzFromSystem` (emitted when the OS opens a registered file with KReader via the file association in `tauri.conf.json`).

## Reader keyboard shortcuts

| Key | Action |
|-----|--------|
| `←` / `→` | Prev/Next page (respects RTL) |
| `PageUp` / `PageDown` | Scroll or page-turn at boundary |
| `Home` / `End` | First / last page |
| `Ctrl+←` / `Ctrl+→` | Previous/next file (or page, for standalone images) |
| `C` | Toggle cascade mode (all pages vertical) |
| `D` | Toggle double-page mode |
| `S` | Toggle RTL reading direction |
| `G` | Toggle gap between pages |
| `+` / `-` | Zoom in/out |
| `J` | Toggle smooth scroll |
| `I` | Toggle info overlay |
| `P` | Pin/unpin page number (persists globally) |
| `Escape` | Close reader, return to home screen |
| `F` | Toggle fullscreen |
| `X` | Close window |

Global hotkeys (`F` = fullscreen) are guarded in `App.tsx`: they do not fire when focus is on an `INPUT`, `TEXTAREA`, or `contenteditable` element. The `T` theme-toggle hotkey was removed when the theme control moved to the settings modal.

## Versioning

When bumping the version, update it in all three places:

| File | Field |
|------|-------|
| `package.json` | `"version"` |
| `src-tauri/tauri.conf.json` | `"version"` |
| `src-tauri/Cargo.toml` | `version` (line 3) |

All three must match. `Cargo.toml` is what Tauri uses for the installer binary version. After bumping, run `npm i` to sync `package-lock.json`.

## Key dependencies

### Tauri capabilities (`src-tauri/capabilities/default.json`)

New fs operations require explicit entries here. Currently granted beyond `fs:default`:
- `fs:allow-write-file` — writing files (used by store plugins)
- `fs:allow-mkdir` — creating directories
- `fs:allow-rename` — moving/renaming files (used by "Move to folder")

If a new `@tauri-apps/plugin-fs` call fails with "not allowed", add its permission here.

## Key dependencies

- `pdfjs-dist` — PDF rendering; worker is loaded via Vite `?url` import.
- `jszip` — CBZ extraction (CBZ is just a ZIP of images).
- `unrar` (Rust) — CBR extraction in the backend.
- `react-hotkeys-hook` — present in `package.json` but unused; keyboard handling is done via `addEventListener` in `useReaderShortcuts` and `App.tsx`.
- `@tauri-apps/plugin-store` — key-value persistence for recent files, reading progress, settings, and library data.
