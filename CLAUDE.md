# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

KReader is a lightweight desktop comic/document reader built with Tauri v2 + React + TypeScript. It supports CBZ, CBR, ZIP, RAR, PDF, and standalone image files.

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
  App.tsx                       Entry point: dialog, recent files, theme/lang, format dispatch
  components/
    Reader.tsx                  Stateful viewer for image-based formats (CBZ/CBR/folder)
    PDFReader.tsx               Stateful viewer for PDFs (uses pdfjs canvas + text layer)
    ReaderOverlay.tsx           Floating shortcuts panel + page info indicator
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
  utils/
    recentFiles.ts              Lazy-init wrapper around .recent-files.dat
    theme.ts                    Theme persisted in localStorage
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
- `.settings.dat` — global app settings (currently just `pin-page-indicator`).

### Rust backend (`src-tauri/src/`)

- `main.rs` — trivial: just calls `kreader_lib::run()`.
- `lib.rs` — exposes two Tauri commands:
  - `get_startup_file` — returns the path passed as CLI argument (used for OS file associations).
  - `extract_cbr(path)` — uses the `unrar` crate to unpack a CBR/RAR archive and returns each image as a `data:` URL (base64-encoded). Browser RAR support is non-viable, so this stays in Rust.

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

## Versioning

When bumping the version, update it in all three places:

| File | Field |
|------|-------|
| `package.json` | `"version"` |
| `src-tauri/tauri.conf.json` | `"version"` |
| `src-tauri/Cargo.toml` | `version` (line 3) |

All three must match. `Cargo.toml` is what Tauri uses for the installer binary version.

## Key dependencies

- `pdfjs-dist` — PDF rendering; worker is loaded via Vite `?url` import.
- `jszip` — CBZ extraction (CBZ is just a ZIP of images).
- `unrar` (Rust) — CBR extraction in the backend.
- `react-hotkeys-hook` — present in `package.json` but unused; keyboard handling is done via `addEventListener` in `useReaderShortcuts` and `App.tsx`.
- `@tauri-apps/plugin-store` — key-value persistence for recent files, reading progress, and settings.
