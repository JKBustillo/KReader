# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

KReader is a lightweight desktop comic/document reader built with Tauri v2 + React + TypeScript. It supports CBZ (comic book zip) and PDF formats.

## Commands

```bash
# Development (starts Vite on port 1420 + Tauri window)
npm run tauri dev

# Production build
npm run tauri build

# Frontend-only dev (no Tauri window, browser only)
npm run dev

# Type check + bundle frontend
npm run build
```

There are no tests. Vite's dev server **must** run on port 1420 — Tauri hardcodes this in `tauri.conf.json`.

## Architecture

### Data flow

1. `App.tsx` — entry point and file loader. Opens files via `@tauri-apps/plugin-dialog`, reads bytes via `@tauri-apps/plugin-fs`, decodes them in-browser (CBZ → JSZip → blob URLs; PDF → pdfjs-dist → canvas → data URLs), then passes the resulting `string[]` of image URLs to `<Reader>`.
2. `Reader.tsx` — stateful viewer. Receives the page image array and manages all display logic: single/double/cascade mode, zoom, RTL, scroll, page persistence.
3. `utils/recentFiles.ts` — thin wrapper around `@tauri-apps/plugin-store` that persists the recent-files list to `.recent-files.dat`.

### State persistence (Tauri Store)

- `.recent-files.dat` — list of up to 10 recently opened file paths.
- `.reading-progress.dat` — per-file page index (`{filePath}-page`) and cascade mode flag (`{filePath}-cascade`), keyed by absolute file path.

### Rust backend (`src-tauri/src/lib.rs`)

Minimal — contains only the template `greet` command and registers the `tauri-plugin-opener`. All actual file I/O and format decoding happens in the frontend via Tauri JS plugins.

### CBZ → sibling navigation

`Ctrl+ArrowRight/Left` in Reader reads the parent directory (`readDir`) to list `.cbz` files and fires a `CustomEvent("openNewCbz", { detail: path })` on `window`, which `App.tsx` listens for to reload a new file without a full page refresh.

### System file associations

`App.tsx` also listens for the Tauri event `openCbzFromSystem` (emitted when the OS opens a `.cbz` file with KReader via the file association registered in `tauri.conf.json`).

## Reader keyboard shortcuts

| Key | Action |
|-----|--------|
| `←` / `→` | Prev/Next page (respects RTL) |
| `PageUp` / `PageDown` | Scroll or page-turn at boundary |
| `Home` / `End` | First / last page |
| `Ctrl+←` / `Ctrl+→` | Previous/next CBZ in same folder |
| `C` | Toggle cascade mode (all pages vertical) |
| `D` | Toggle double-page mode |
| `S` | Toggle RTL reading direction |
| `G` | Toggle gap between pages |
| `+` / `-` | Zoom in/out |
| `J` | Toggle smooth scroll |
| `I` | Toggle info overlay |
| `Escape` | Close reader, return to home screen |
| `F` | Toggle fullscreen |
| `X` | Close window |

## Key dependencies

- `pdfjs-dist` — PDF rendering; worker is loaded from cdnjs CDN (`GlobalWorkerOptions.workerSrc`).
- `jszip` — CBZ extraction (CBZ is just a ZIP of images).
- `react-hotkeys-hook` — imported but keyboard handling is done manually via `addEventListener` in both `App.tsx` and `Reader.tsx`.
- `@tauri-apps/plugin-store` — key-value persistence for recent files and reading progress.
