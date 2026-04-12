# KReader

A lightweight desktop reader for comics and documents, built with Tauri + React + TypeScript.

## Supported formats

| Format | Description |
|--------|-------------|
| `.cbz` | Comic Book ZIP — most common comic format |
| `.pdf` | PDF documents |

## Features

- **Recent files** — keeps a list of the last 10 opened files for quick access
- **Reading progress** — remembers the last page and view mode for each file
- **File association** — `.cbz` files can be opened directly with KReader from your OS
- **Sibling navigation** — jump to the previous/next comic in the same folder without leaving the reader
- **Multiple view modes** — single page, double page, and cascade (all pages scrollable vertically)
- **Zoom** — scale content between 50% and 300%
- **RTL support** — right-to-left reading direction for manga
- **Fullscreen** — toggle with a key or double-click anywhere

## Keyboard shortcuts

### Global

| Key | Action |
|-----|--------|
| `F` | Toggle fullscreen |
| `X` | Close window |
| Double-click | Toggle fullscreen |

### Reader

| Key | Action |
|-----|--------|
| `←` / `→` | Previous / next page |
| `PageUp` / `PageDown` | Scroll, or turn page when at edge |
| `Home` / `End` | Jump to first / last page |
| `Ctrl + ←` / `Ctrl + →` | Previous / next comic in the same folder |
| `C` | Toggle cascade mode |
| `D` | Toggle double-page mode |
| `S` | Toggle RTL reading direction |
| `G` | Toggle gap between pages |
| `+` / `-` | Zoom in / out |
| `J` | Toggle smooth scroll |
| `I` | Toggle info overlay |
| `Escape` | Close reader, return to home screen |

## Development

```bash
# Install dependencies
npm install

# Start in development mode (Vite + Tauri window)
npm run tauri dev

# Build for production
npm run tauri build

# Lint
npm run lint
```

> Requires [Rust](https://www.rust-lang.org/tools/install) and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.

## Tech stack

- [Tauri v2](https://tauri.app/) — native desktop shell
- [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [Vite](https://vitejs.dev/) — frontend tooling
- [Tailwind CSS v4](https://tailwindcss.com/)
- [pdfjs-dist](https://github.com/mozilla/pdf.js) — PDF rendering
- [JSZip](https://stuk.github.io/jszip/) — CBZ extraction
