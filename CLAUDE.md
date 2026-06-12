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
                                  ambiguous-file resolution, tag editor modal, rename-file modal
    LibraryCard.tsx             Grid-view card for a library entry (cover thumbnail + metadata)
    LibraryDetailsRow.tsx       Details-view row for a library entry
    TagEditor.tsx               Modal for adding/removing custom tags; supports single and
                                  multi-entry mode, autocomplete suggestions
    SettingsModal.tsx           Modal de ajustes: tema (dark/light), color de acento (ice/violet),
                                  idioma (ES/EN), export/import de biblioteca. Abre desde el engranaje de NavBar.
    Button.tsx                  Shared action button: variant (primary solid-accent CTA + glow / secondary bordered /
                                  danger red) + size (sm/lg). Forwards native button props. Used by App home,
                                  SettingsModal, and DeleteConfirmModal. Specialized controls (toggles, chips,
                                  icon-only, tag chips, folder rows) deliberately stay outside this component.
    Modal.tsx                   Shared modal shell: dimmed backdrop + Escape-to-close + click-outside +
                                  stopPropagation. Children = panel content; panelClassName sets width.
                                  Used by MoveFolderModal/DeleteConfirmModal/RemoveLibraryConfirmModal (in LibraryView)
                                  + ResolveLocationModal. RemoveLibraryConfirmModal guards the ✕ "remove library"
                                  action, warning that custom tags/favorites/ratings/progress are lost (disk files untouched).
    ResolveLocationModal.tsx    Ambiguous-entry location picker (lists same-name/size candidates). Uses Modal.
    ContextMenu.tsx             Library right-click menu: positioned + own dismiss (click-outside/Escape).
                                  Presentational; LibraryView passes semantic callbacks + ambiguousCandidates.
                                  "Rename" entry is single-selection only (onRename receives one entry).
    FilterDropdown.tsx          Shared folders/tags filter dropdown shell (trigger badge + search + scroll list +
                                  clear footer + dismiss). Owns open/search state; caller passes renderItems(search).
  hooks/
    useReadingProgress.ts       Per-file pageIndex + cascadeMode state, persisted to .reading-progress.dat
    useReaderShortcuts.ts       Owns the keyboard switch for Reader (Ctrl+Arrow, W/C/D/S/G/I/P/J/+/-/Home/End/Escape/F/X)
    useOverlayAutoHide.ts       Shared overlay visibility: shows on mousemove, hides after 1.5s (suppressed while info is pinned). Used by Reader and PDFReader.
    usePinPageIndicator.ts      Shared pin-page-indicator state, persisted to .settings.dat. Used by Reader and PDFReader.
  loaders/
    index.ts                    detectKind(path) + loadPages(path) dispatcher
    loadCbz.ts                  CBZ/ZIP via JSZip → blob URLs
    loadCbr.ts                  CBR/RAR via invoke('extract_cbr')
    loadImageFolder.ts          Single image → loads whole folder, sorted numerically
    types.ts                    IMAGE_EXTS (+ IMAGE_EXTS_SET), extOf, mimeForExt, LoaderResult.
                                  Single source of truth for image extensions/MIME used across loaders,
                                  thumbnails, countPages, and the reader shortcuts.
  types/
    library.ts                  Tag, TagCategory, Library, LibraryEntry, ReadingState,
                                  SortField, SortDirection, ViewMode
  utils/
    recentFiles.ts              Lazy-init wrapper around .recent-files.dat
    theme.ts                    Theme (dark/light) persisted in localStorage (key `kreader-theme`), applied via `data-theme`
    accent.ts                   Accent color (`ice`/`violet`) persisted in localStorage (key `kreader-accent`), applied via
                                  `data-accent`. Mirrors theme.ts; both applied pre-paint in main.tsx to avoid flash.
    libraryStore.ts             Library + entries CRUD against .library.dat. getEntryByPath(libraryId, path)
                                  resolves an entry by normalized currentPath (used by sibling navigation).
                                  setFavorite/setReadingState/setCustomTags/setRating/batchSetCustomTags also
                                  write-through to entryMetaStore; export/importLibraryData carry entryMeta.
    entryMetaStore.ts           Sticky user metadata (customTags/isFavorite/rating/readingState) keyed by entry id
                                  (filename::size), library-independent, in .entry-meta.dat (single `entry-meta` key →
                                  Record<id, EntryMeta>). Lets that data survive a library delete + re-add. See Library system.
                                  renameEntryMeta(oldId, newId) migrates a record when a file is renamed (id changes).
    readingSession.ts           startLibraryReadingSession(entry): disk-only reading bookkeeping for entries
                                  opened outside LibraryView (sibling Ctrl+Arrow). Marks opened + returns
                                  onComplete/onPagesLoaded callbacks. See Sibling-file navigation.
    settingsStore.ts            Global settings CRUD against .settings.dat
    backup.ts                   runAutoBackupIfDue(): startup auto-backup via exportLibraryData (libraries + entries
                                  + entryMeta) to app_config_dir()/backups/kreader-backup-<epochMs>.json. Throttled to once/day
                                  (last-backup-at), keeps the 5 most recent (rotates). Gated by the auto-backup
                                  setting; runs only in the `main` window. Restore is manual via SettingsModal import.
    thumbnails.ts               Cover extraction (CBZ/CBR/PDF/image) + disk+memory cache
    parseTags.ts                Auto-tag parsing from filename brackets [Author (Circle)]
    folderUtils.ts              Path helpers: getRelativeFolder(entryPath, rootPath), basename(path), normalizePath(path)
    scroll.ts                   Scroll-edge constants (SCROLL_EPSILON_PX, WHEEL_THROTTLE_MS, PAGE_SCROLL_FRACTION) + isAtTop/isAtBottom
    appWindow.ts                APP_NAME + setWindowTitle(name?) → "${name} - KReader" or "KReader"
    readingProgressStore.ts     Owns all .reading-progress.dat keys (page/cascade/bookmarks), read+write.
                                  Consumed by useReadingProgress and PDFReader; exposes getReadingProgress,
                                  getSavedPage, savePage/saveCascade/saveBookmarks, and getPageForPath(filePath).
                                  migrateReadingProgress(oldPath, newPath) moves all three keys when a file is renamed.
    countPages.ts               Page count via Rust IPC (CBZ/PDF/CBR) or readDir (image folders). Returns null for unsupported formats.
    progress.ts                 Shared reading-progress helpers: computeProgress(entry, currentPage),
                                  PROGRESS_INCOMPLETE_CAP, PROGRESS_DOT_COLORS. Used by LibraryCard + LibraryDetailsRow.
  i18n/                         react-i18next setup (en, es)
```

### Theming, fonts & accent

The app uses a **dark-cinema (OLED)** aesthetic, dark-first with a working light theme.

- **Fonts** are vendored offline in `src/assets/fonts/` (`.woff2`): **Clash Display** (display, weights 500/600/700) and **Hanken Grotesk** (body, variable 300–700). `@font-face` + a Tailwind v4 `@theme` block in `App.css` expose them as `font-sans` (Hanken, the default body font) and `font-display` (Clash Display). Use `font-display` for headings/titles.
- **Tokens** live in `App.css` as CSS variables. The neutral palette + state colors switch on `data-theme` (`dark` default / `light`). All component colors must go through these vars (e.g. `var(--bg-primary)`, `var(--text-primary)`, `var(--color-favorite)`) — never hardcode hex/Tailwind color utilities for chrome. (Exception: `TagEditor` tag-color presets are user-chosen swatches, not chrome.)
- **Accent** is orthogonal to theme: `--accent`, `--accent-ink` (text on accent), `--glow`, `--glow-soft` are defined per `data-accent` (`ice` default / `violet`), with glow rgba **precomputed** (no `color-mix` at runtime). Selection (`--color-selection`/`--color-selection-bg`) and reader key hints (`--text-key`) derive from the accent. Accent is owned by `utils/accent.ts` (localStorage `kreader-accent`), selectable in `SettingsModal`, applied pre-paint in `main.tsx`.
- **Atmosphere**: `html:not([data-theme="light"]) body` paints fixed radial accent-glow gradients. This only shows because the React root container is **transparent** (no `bg-*`); `body` paints `--bg-primary`. Keep the root container transparent.
- **Animation**: `.kr-rise` (in `App.css`) is the staggered home page-load reveal (via inline `animationDelay`); it respects `prefers-reduced-motion`. `.kr-card-cover` owns library-card cover shadow/hover-glow and the selection/ambiguous ring (`data-ring`).

### Data flow

1. `App.tsx` opens files via `@tauri-apps/plugin-dialog`, calls `detectKind(path)` then either `loadPages(path)` (for image-based formats) or reads the bytes directly for PDF.
2. Image-based formats return `{ pages: string[], pageNames?, startPage? }`. Those URLs are tracked in `blobUrlsRef` and revoked the next time `handleOpen` runs or `resetPages` fires.
3. `Reader.tsx` receives the page array and delegates persistence to `useReadingProgress` and keyboard handling to `useReaderShortcuts`. Overlay visuals live in `<ReaderOverlay>`.
4. PDF takes a separate path: bytes are passed to `<PDFReader>`, which renders pages on a canvas via `pdfjs-dist`.

### State persistence (Tauri Store)

- `.recent-files.dat` — list of up to 10 recently opened file paths.
- `.reading-progress.dat` — per-file page index (`{filePath}-page`), cascade mode flag (`{filePath}-cascade`), and bookmarks (`{filePath}-bookmarks`, `number[]`), keyed by absolute file path.
- `.settings.dat` — global app settings. Current keys:
  - `pin-page-indicator` — boolean, pin page number overlay.
  - `library-view-mode` — `"details" | "grid"`, last used view mode in library.
  - `last-app-view` — `"home" | "library"`, restores active view on next launch.
  - `folder-filter:<libraryId>` — `Record<string, "full" | "partial">`, persisted folder filter per library.
  - `show-progress-bar` — boolean, show reading progress bar in library cards and rows (default false).
  - `show-page-count` — boolean, show page count on library cards (default false).
  - `auto-backup` — boolean, enable automatic library backups on startup (default false).
  - `last-backup-at` — number, epoch-ms of the last auto-backup (throttle, default 0).
  - `keep-data-on-remove` — boolean, keep sticky entry metadata when a library is removed (default true).
- `.entry-meta.dat` — sticky user metadata keyed by entry id. Single key `entry-meta` → `Record<id, EntryMeta>` where
  `EntryMeta = { customTags?, isFavorite?, rating?, readingState? }`. Owned by `entryMetaStore.ts`. See Library system.
- `.library.dat` — library definitions and entries. Keys:
  - `libraries` — `Library[]` list of all libraries.
  - `entries:<libraryId>` — `LibraryEntry[]` for that library.
- `.window-state.json` — window geometry (size, position, maximized, fullscreen, visible) per window label, owned by `tauri-plugin-window-state` (in `app_config_dir()`). Written automatically on window close / app exit, restored on launch. Only the `main` window (stable label) round-trips across sessions; `reader-*` labels change each launch (see [Multi-window](#multi-window-single-instance)). The `main` window is declared `"visible": false` in `tauri.conf.json` so the plugin can apply the saved geometry while hidden and then show it (the plugin's `restore_state` calls `show()` itself when the `VISIBLE` flag is set) — this avoids the open-at-default-size-then-resize flash. First launch (no saved state) still shows because the plugin defaults `should_show` to true.

**Rule:** All store access must go through the utility wrappers (`libraryStore.ts`, `settingsStore.ts`, `recentFiles.ts`, `readingProgressStore.ts`). Never instantiate `Store` directly in a component or hook, and never use key strings outside the owning util file. The `pin-page-indicator` setting is owned by `settingsStore.ts`; `usePinPageIndicator` consumes it through that wrapper.

### Library system

`LibraryView.tsx` manages a collection of `LibraryEntry` objects, each pointing to a file on disk.

**Scan flow:** `invoke('scan_library', { root })` returns `ScannedFile[]` (path, filename, sizeBytes, modifiedSecs). Each scanned file is matched against stored entries by `filename + sizeBytes`. New files get `parseAutoTags(filename)` applied and are inserted; existing entries keep their custom tags, reading state, etc.

- Single match → auto-relocates `currentPath` if it changed.
- Multiple matches (same name+size in different subfolders) → stored in `ambiguousCandidates`; user resolves via context menu "Resolver ubicación" → resolution modal.

**Scan lifecycle (`reconcileScan` + two effects):** The filesystem diff (relocations, new/missing/ambiguous, sticky-meta overlay, page-count queueing) lives in the `reconcileScan(lib, baseline, allPageProgress)` callback. Two effects drive it:
- *Initial* (keyed on `activeLib`): Phase A loads stored entries + reading progress via `getAllPageProgress()` (one IPC) and renders them immediately (<100ms); Phase B calls `reconcileScan` with the stored set as baseline, then records `scannedLibRef`.
- *Background re-scan* (keyed on `active`): when the library becomes the visible view again (`active` flips false→true after the initial scan completed), `reconcileScan` re-runs with the **live** entries as baseline, so files added/moved while away reconcile without clearing the rendered list. Only the small toolbar spinner shows.
- `scanRef` guards against concurrent scans; `scanAbortRef` (set by `handleOpen`) makes a scan drop its results if the user opens a file mid-scan, avoiding store-write contention with file loading.

**Mounting model:** `App.tsx` keeps the home/library chrome mounted and renders the Reader/PDFReader and the loading spinner as **overlays** (the chrome gets `hidden` while `view === "reader"`, not unmounted). Once visited, `LibraryView` stays mounted for the session (`libraryMounted`), so its state, scroll position and warm in-memory thumbnail cache survive entering/leaving the reader — opening a comic and returning is instant. The `active` prop (`view === "library"`) tells `LibraryView` when it's the visible view (drives the background re-scan above).

**Entry identity:** `id = "{filename}::{sizeBytes}"`. This means an *external* rename is treated as a new file; moving within the library root is auto-resolved on next scan.

**Rename (context menu, single entry):** `handleRename` renames the file on disk via `rename` (`@tauri-apps/plugin-fs`, same directory, separator/path preserved) and, because the id is filename-derived, migrates every id-/path-keyed record so nothing is orphaned or duplicated on the next scan: it swaps the library entry (new id/filename/currentPath, `autoTags` re-parsed, `customTags` kept), `renameEntryMeta(oldId→newId)`, `migrateReadingProgress(oldPath→newPath)` (page/cascade/bookmarks), and clears the old thumbnail cache (`clearThumbnailDiskCache([oldId])`, regenerates lazily). The `RenameModal` pre-fills the base name with the extension shown as a fixed suffix, validates against `INVALID_FILENAME_CHARS`, and stays open if the destination already `exists` (handler returns false).

**Sticky entry metadata (`entryMetaStore.ts`):**
- `customTags`, `isFavorite`, `rating` and `readingState` are mirrored into `.entry-meta.dat`, keyed by entry id (so they're library-independent). The `LibraryEntry` in `.library.dat` remains the live mirror the UI reads/sorts/filters; the meta store is the durable copy.
- **Write-through:** the libraryStore setters (`setFavorite`/`setReadingState`/`setCustomTags`/`setRating`/`batchSetCustomTags`) write both the entry and the meta. `setReadingState` is the single choke point, so all readingState writers (LibraryView open/mark-as-read/reset, `readingSession.ts` sibling nav) are covered.
- **Overlay + migration on scan:** `LibraryView` overlays saved meta onto entries before `upsertEntries` (so a re-added folder restores them); entries with no saved meta backfill it from their current values, so pre-feature data is never wiped.
- **Forget toggle:** `keep-data-on-remove` setting (default true). On `handleRemoveLibrary`, when false, meta is purged for the removed library's entry ids that aren't present in any remaining library (`deleteEntryMeta`). `removeLibrary` still deletes `entries:<libId>` regardless. `RemoveLibraryConfirmModal` shows a keep/forget message based on the live setting (read fresh when the modal opens).
- **Limitation:** keyed by `filename::size`, so renaming a file or changing its size breaks the association (treated as a new file).

**Rating system:**
- `rating?: number` (1–5) stored per entry in `LibraryEntry`. Optional — entries without rating have `undefined`.
- `setRating(id, libraryId, rating: number | undefined)` in `libraryStore.ts`. Passing `undefined` clears the rating.
- UI: 5 clickable stars (★/☆) in `LibraryDetailsRow` (column after favorite) and `LibraryCard` (below title). Clicking the active star toggles it off.

**Last opened:**
- `lastOpenedAt?: number` (Unix timestamp in seconds) stored per entry in `LibraryEntry`. Set in `LibraryView.handleOpen` every time an entry is opened.
- `setLastOpenedAt(id, libraryId, timestamp)` in `libraryStore.ts`.
- Sortable column in details view (`SortField = "lastOpened"`). Defaults to descending when first selected (most recently opened first). Entries never opened show `"—"`.

**Progress bar:**
- Thin bar shown in `LibraryCard` (below rating stars) and `LibraryDetailsRow` (2px line at row bottom). Toggled via `show-progress-bar` setting.
- `totalPages?: number` persisted in `LibraryEntry` via `setTotalPages` in `libraryStore.ts`. Registered through an `onPagesLoaded(total)` callback: `LibraryView.handleOpen` creates it and passes it as third arg of `onOpen`; `App.tsx` calls it after `loadPages` (image formats) or forwards it to `<PDFReader>` as a prop (PDF format).
- `currentPage` is **session-only** (not persisted in `LibraryEntry`). `LibraryView` batch-reads it from `.reading-progress.dat` via `getPageForPath` after each scan and stores it in a local `pageMap: Map<id, page>`. This means the displayed progress reflects the state at last scan, not real-time — it updates accurately on app restart or library rescan.
- Progress capped at 99% while `readingState === "in_progress"`; shows 100% only when `readingState === "completed"`.

**Tag system:**
- `autoTags` — parsed on scan from filename brackets, e.g. `[Circle (Author)]` → circle + author tags. Stored but never manually edited.
- `customTags` — user-defined, stored per entry. Multi-entry edits use `batchSetCustomTags` (single read-modify-write) to avoid concurrent-write race conditions.
- Tag filter in UI is session-only (module-level variable `sessionSelectedTags`; resets on app restart). Now that `LibraryView` stays mounted for the session (see Mounting model), the module-level vars are a redundant safety net rather than the primary persistence mechanism.

**Favorites filter:**
- "Show favorites only" toggle is session-only (module-level variable `sessionShowFavoritesOnly`; same lifecycle as the tag filter — resets on app restart).

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
  - `take_window_file` — returns (and clears) the file path the calling window should open on mount, looked up by its label in the `PendingFiles` map. The initial `main` window's entry is seeded from the CLI argument in `setup()`; windows spawned by `open_new_window` or the single-instance callback seed their own entry. Returns `None` once consumed.
  - `open_new_window(path?)` — spawns a new app window in the current process (label `reader-{n}`), optionally pre-loading `path`. Used by the NavBar "New window" button.
  - `extract_cbr(path)` — unpacks a full CBR/RAR archive; returns all images as raw binary response.
  - `extract_cbr_cover(path)` — returns only the first image from a CBR/RAR (for thumbnails). Stops after first image found.
  - `extract_cbz_cover(path)` — returns only the first image from a CBZ/ZIP (alphabetically sorted); reads only the central directory + one compressed entry.
  - `scan_library(root)` — recursive directory walk returning `ScannedFile[]` (path, filename, size_bytes, modified_secs) for all supported extensions.
  - `list_subdirs(root)` — recursive walk returning all subdirectory paths relative to root (`"/"` for root itself, `"Leído"`, `"Leído/Archivado"`, etc.). Used by the "Move to folder" context menu action.
  - `trash_file(path)` — sends a file to the OS trash via the `trash` crate; falls back to permanent deletion if trash is unavailable.
  - `count_cbz_pages(path)` — counts image entries in a CBZ/ZIP central directory without decompression. Returns `u32`.
  - `count_pdf_pages(path)` — counts pages via `lopdf::Document::load` (reads xref + catalog only, no content streams). Returns `u32`.
  - `count_cbr_pages(path)` — counts image entries in a CBR/RAR via `open_for_listing` (no extraction). Returns `u32`.

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

Page counting (CBZ/PDF/CBR) also runs in Rust to avoid loading full files into WebView2 heap — only a `u32` is returned to JS. Image folder counting uses `readDir` in TS (lightweight).

### Sibling-file navigation (Ctrl+Arrow)

`Ctrl+ArrowRight/Left` in Reader behaves differently depending on the open file:

- **CBZ/CBR/ZIP/RAR**: reads the parent directory, lists files with the same extension, fires a `CustomEvent("openNewCbz", { detail: path })` on `window`. `App.tsx` listens for it and reloads.
- **Standalone image**: the whole folder is already loaded as pages, so it just advances/rewinds the page index in place.

When the current file was opened from the library, sibling navigation keeps library reading-state in sync. `App.tsx` tracks the active `libraryId` in `activeLibraryIdRef` (set via the 4th arg of `LibraryView`'s `onOpen`), and `handleOpenNewCbz` resolves the sibling's entry via `getEntryByPath(libraryId, path)` then calls `startLibraryReadingSession(entry)` (`utils/readingSession.ts`) to mark it `in_progress`/`completed` and record `totalPages`/`lastOpenedAt` — the same bookkeeping `LibraryView.handleOpen` does for the first open, but written straight to disk since `LibraryView` is unmounted during reading. Siblings not present in the library (unscanned) fall back to a plain reload with no tracking.

### System file associations

`App.tsx` also listens for the Tauri event `openCbzFromSystem` (emitted when the OS opens a registered file with KReader via the file association in `tauri.conf.json`).

## Multi-window (single-instance)

KReader runs as a **single process** with potentially multiple windows, via `tauri-plugin-single-instance` (registered as the *first* plugin in `lib.rs`). This is deliberate: the Tauri Store keeps its canonical map in Rust shared across all windows of a process, so multiple windows can read/write reading progress, bookmarks, and settings without clobbering each other. Separate *processes* would each hold an independent in-memory copy and overwrite the whole file on `save()` (last-write-wins), which is the bug this design avoids.

- A second OS launch (e.g. file-association double-click while running) is intercepted by the single-instance callback, which spawns a new window via `create_reader_window` instead of starting a second process.
- The NavBar "New window" button calls `open_new_window` to spawn a fresh window from inside the app. New windows inherit the `main` window's current inner size (and maximized state) via `create_reader_window`, falling back to `DEFAULT_WINDOW_WIDTH`/`DEFAULT_WINDOW_HEIGHT` (800×600) when `main` is gone.
- Each window resolves which file to open on mount by calling `take_window_file` (keyed by its own window label) — see the `PendingFiles` map in `lib.rs`. The `main` window's entry comes from the CLI argument.
- New windows use labels `reader-{n}` (monotonic `WindowCounter`). The capability in `capabilities/default.json` must cover them — its `windows` list includes both `"main"` and `"reader-*"`; without the glob, new windows would have no store/fs/dialog/core permissions.
- **Not handled:** live cross-window reactivity. If two windows share the same library, an in-memory change in one (e.g. folder filter) is not pushed to the other until it rescans/reopens. Disk state stays consistent; only the live React state can be momentarily stale.

## Reader keyboard shortcuts

| Key | Action |
|-----|--------|
| `←` / `→` | Prev/Next page (respects RTL) |
| `PageUp` / `PageDown` | Scroll or page-turn at boundary |
| `Home` / `End` | First / last page |
| `Ctrl+←` / `Ctrl+→` | Previous/next file (or page, for standalone images) |
| `W` | Toggle webtoon mode (continuous vertical scroll, no height cap, no gap) |
| `C` | Toggle cascade mode (all pages vertical, height-capped) |
| `B` | Toggle bookmark on current page (persists per file) |
| `[` / `]` | Jump to previous / next bookmark |
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

The capability's `windows` list is bound to `["main", "reader-*"]` so dynamically created reader windows inherit all permissions (see [Multi-window](#multi-window-single-instance)).

New fs operations require explicit entries here. Currently granted beyond `fs:default`:
- `fs:allow-write-file` — writing files (used by store plugins)
- `fs:allow-mkdir` — creating directories (also the `backups/` dir for auto-backup)
- `fs:allow-rename` — moving/renaming files (used by "Move to folder")
- `fs:allow-read-dir` — listing directories (auto-backup rotation)
- `fs:allow-remove` — deleting files (auto-backup rotation prunes old backups)

If a new `@tauri-apps/plugin-fs` call fails with "not allowed", add its permission here.

## Key dependencies

- `pdfjs-dist` — PDF rendering; worker is loaded via Vite `?url` import.
- `jszip` — CBZ extraction (CBZ is just a ZIP of images). Not used for page counting (handled by Rust).
- `unrar` (Rust) — CBR extraction and page counting in the backend.
- `lopdf` (Rust) — PDF page counting (`count_pdf_pages` command). `default-features = false` to avoid pulling in rayon/chrono/time.
- `react-hotkeys-hook` — present in `package.json` but unused; keyboard handling is done via `addEventListener` in `useReaderShortcuts` and `App.tsx`.
- `@tauri-apps/plugin-store` — key-value persistence for recent files, reading progress, settings, and library data.
- `tauri-plugin-window-state` (Rust) — persists/restores window geometry to `.window-state.json`. Registered right after `single_instance` in `lib.rs`. Used purely via its Rust autosave/restore; no JS commands invoked, so no capability entry is required.
