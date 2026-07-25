# KReader

A lightweight desktop reader for comics and documents, built with Tauri + React + TypeScript.

It reads comic archives, PDFs, EPUB e-books, and standalone images, and includes a built-in library system for organizing and browsing your collection.

## Supported formats

| Format | Description |
|--------|-------------|
| `.cbz` / `.zip` | Comic Book ZIP — a ZIP of images (most common comic format) |
| `.cbr` / `.rar` | Comic Book RAR — a RAR of images |
| `.pdf` | PDF documents |
| `.epub` | EPUB e-books — reflowable text with chapters, table of contents and adjustable font size |
| Images | `.jpg` `.jpeg` `.png` `.gif` `.webp` `.bmp` `.avif` — opening one loads the whole folder as pages |

## Features

### Reader

- **Multiple view modes** — single page, double page, cascade (all pages scrollable vertically, height-capped), and webtoon (continuous vertical scroll, no gaps).
- **PDF cascade** — PDFs also support cascade mode (`C`): continuous vertical scroll that renders pages on demand to keep memory bounded, with selectable text on each page.
- **EPUB reading** — reflowable e-books with a chapter table of contents (`T`), adjustable font size (`+` / `−`, remembered between books), and the book styled to match the app's light/dark theme. Your reading position is remembered and the book-wide progress is cached so reopening is instant; pin the progress indicator with `P`, and click it to cycle between overall percent, pages within the current chapter (which grow/shrink with the font size), and a stable book-wide page count.
- **Bookmarks** — toggle bookmarks per page and jump between them; persisted per file.
- **Reading progress** — remembers the last page and view mode for each file.
- **Sibling navigation** — jump to the previous/next comic in the same folder without leaving the reader.
- **Zoom** — scale content between 50% and 300%.
- **RTL support** — right-to-left reading direction for manga.
- **Fullscreen** — toggle with a key or by double-clicking anywhere.
- **Recent files** — keeps a list of the last 10 opened files for quick access.

### Library

A built-in collection manager for browsing large libraries:

- **Folder scanning** — point KReader at a folder and it indexes all supported files recursively.
- **Two view modes** — grid (cover thumbnails) and details (sortable table).
- **Sorting** — by name, size, date, last opened, or page count.
- **Filtering** — by tags and by folders (recursive or direct-children-only), with union semantics.
- **Tags** — auto-parsed from filename brackets (e.g. `[Circle (Author)]`) plus your own custom tags, editable individually or in bulk. The tag input suggests your recently-assigned tags the moment you focus it, so common tags are one click away. From the tags filter you can also **manage tags library-wide**: rename, recolor or delete a custom tag across every comic at once (renaming into an existing tag merges them).
- **Ratings** — 1–5 stars per entry.
- **Favorites & reading state** — mark entries as favorite and as read / in-progress; filter to favorites only. The favorites filter is remembered per library between sessions, and a setting controls whether it respects the active folder filter (off by default, so favorites from every folder are shown).
- **Reading progress bar** — optional per-card/row progress indicator.
- **Metadata that sticks to the file** — your custom tags, favorites, ratings and reading state are saved per file, so they're restored if you remove and re-add the same folder (toggleable in settings).
- **Cover thumbnails** — extracted and cached on disk.
- **File management** — open an entry in a new window, rename a file, move entries to subfolders, send them to the OS trash, or copy file names to the clipboard (right-click; multi-selection copies one name per line; open-in-new-window and rename are single-selection). Renaming keeps your tags, favorites, ratings, reading state and reading position. Removing a library asks for confirmation first.
- **Export / import** — back up or transfer your whole library, including your per-file metadata.
- **Automatic backups** — optional: KReader snapshots your library on startup (at most once a day) and keeps the most recent few.

### App

- **Multiple windows** — open several reader windows at once; they run in a single process and share state, so bookmarks and settings never clobber each other.
- **Themes** — dark and light.
- **Languages** — English and Spanish.
- **File association** — `.cbz`, `.cbr`, `.epub`, `.pdf`, `.zip`, and `.rar` files can be opened directly with KReader from your OS.

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
| `←` / `→` | Previous / next page (respects RTL) |
| `PageUp` / `PageDown` | Scroll, or turn page when at edge |
| `Home` / `End` | Jump to first / last page |
| `Ctrl + ←` / `Ctrl + →` | Previous / next comic in the same folder |
| `W` | Toggle webtoon mode |
| `C` | Toggle cascade mode |
| `B` | Toggle bookmark on current page |
| `[` / `]` | Jump to previous / next bookmark |
| `D` | Toggle double-page mode |
| `S` | Toggle RTL reading direction |
| `G` | Toggle gap between pages |
| `+` / `-` | Zoom in / out |
| `J` | Toggle smooth scroll |
| `I` | Toggle info overlay |
| `P` | Pin / unpin page number permanently |
| `Escape` | Close reader, return to home screen |

### EPUB reader

| Key | Action |
|-----|--------|
| `←` / `→` · `PageUp` / `PageDown` | Previous / next page |
| `Home` / `End` | First / last chapter |
| `+` / `−` | Increase / decrease font size |
| `T` | Toggle table of contents |
| `P` | Pin the progress indicator so it stays visible |
| Click the progress | Cycle display: percent / chapter pages / total pages |
| `I` | Toggle info overlay (chapter + progress) |
| `F` | Toggle fullscreen |
| `X` | Close window |
| `Escape` | Close the table of contents, or close the reader |

## Development

```bash
# Install dependencies
npm install

# Start in development mode (Vite + Tauri window)
npm run dev

# Build for production
npm run build

# Lint
npm run lint
```

> Requires [Rust](https://www.rust-lang.org/tools/install) and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.
>
> Vite's dev server must run on port 1420 — Tauri hardcodes this in `tauri.conf.json`.

## Tech stack

- [Tauri v2](https://tauri.app/) — native desktop shell
- [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [Vite](https://vitejs.dev/) — frontend tooling
- [Tailwind CSS v4](https://tailwindcss.com/)
- [react-i18next](https://react.i18next.com/) — internationalization (en/es)
- [pdfjs-dist](https://github.com/mozilla/pdf.js) — PDF rendering
- [JSZip](https://stuk.github.io/jszip/) — CBZ extraction
- [epubjs](https://github.com/futurepress/epub.js/) — EPUB rendering
- Rust crates: [`unrar`](https://crates.io/crates/unrar) (CBR extraction & page counting), [`lopdf`](https://crates.io/crates/lopdf) (PDF page counting), [`zip`](https://crates.io/crates/zip), [`trash`](https://crates.io/crates/trash) (send to OS trash)
- [`@tauri-apps/plugin-store`](https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/store) — key-value persistence
