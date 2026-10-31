# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

KReader is a lightweight desktop comic/document reader built with Tauri v2 + React + TypeScript. It supports CBZ, CBR, ZIP, RAR, PDF, EPUB, and standalone image files. It also includes a library system for organizing and browsing collections.

## Commands

```bash
# Development (starts Vite on port 1420 + Tauri window)
npm run dev

# Production build
npm run build

# Lint
npm run lint

# Rust tests (backend only)
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

There are no frontend tests. The Rust side has one, covering the `kreader://` page protocol
(see Page delivery). Vite's dev server **must** run on port 1420 — Tauri hardcodes this in `tauri.conf.json`.

## Architecture

### Source layout

```
src/
  App.tsx                       Entry point: dialog, recent files, theme/lang, format dispatch,
                                  last-view persistence, hotkey guard for input elements
  components/
    Reader.tsx                  Stateful viewer for image-based formats (CBZ/CBR/folder)
    PDFReader.tsx               Stateful viewer for PDFs. Single-page path uses one pdfjs canvas +
                                  text layer; cascade mode (toggle C) delegates to PDFCascade.
    PDFCascade.tsx              Virtualized continuous-scroll view for PDFs (cascade mode). Vertical
                                  list of per-page placeholders sized from prefetched viewports; an
                                  IntersectionObserver renders each page on demand to a throwaway
                                  offscreen canvas, then swaps it into the visible canvas via drawImage
                                  (pdfjs forbids two render() calls on one canvas, and the swap avoids a
                                  blank/black flash mid-render); pages outside a ~1-viewport render window
                                  are blanked (width/height=0) to cap memory; a second center-band observer
                                  reflects the active page into pageNum. Each visible page also renders a
                                  pdfjs text layer (`.textLayer`) over its canvas for text selection, on the
                                  same render-window lifecycle (cleared off-window; a per-page generation
                                  guard drops stale spans when a page re-enters mid-render).
    EPUBReader.tsx              Stateful viewer for EPUB e-books. Renders via epubjs (paginated flow)
                                  into its own iframe; keyboard is registered on BOTH window and
                                  rendition.on (the iframe swallows key events when focused). Persists the
                                  reading position as a CFI and caches the epubjs location table (both in
                                  .reading-progress.dat) so book-wide % is instant on reopen; also mirrors the
                                  location index into the shared `{path}-page` key + reports the location count
                                  via onPagesLoaded so the library progress bar works with no special-casing.
                                  In-book theme is built from the app's live CSS tokens (the iframe can't see
                                  :root vars); the reading surface uses a dedicated `--epub-bg` (pure white in
                                  light, not the off-white `--bg-primary`) so images with a baked-in white
                                  background don't seam against the page. TOC comes from book.navigation.toc; its hrefs (which epubjs
                                  stores raw, relative to the nav/ncx doc) are resolved against
                                  book.packaging.navPath so navigation + chapter-label lookup match the spine
                                  even when the nav lives in a subfolder. Font size persists globally
                                  (epub-font-size); D toggles double page (rendition.spread "auto"/"none", global
                                  epub-double-page, read before renderTo so the book never lays out single first); P pins the progress % (usePinPageIndicator, shared with
                                  the comic reader). The progress indicator (clickable) cycles 3 modes
                                  (epub-progress-mode): overall % + book-wide page count from the location
                                  table (both font-independent), and pages within the current chapter from
                                  the relocated event's `displayed` (font-reactive; re-read ~400ms after a
                                  font change since epubjs doesn't re-report location on reflow).
    ReaderOverlay.tsx           Floating shortcuts panel + page info indicator
    NavBar.tsx                  Top nav: home/library toggle + botón engranaje (abre SettingsModal)
    LibraryView.tsx             Main library UI: scan, filter (tags + folders), sort, view mode,
                                  ambiguous-file resolution, tag editor modal, rename-file modal
    LibraryCard.tsx             Grid-view card for a library entry (cover thumbnail + metadata)
    LibraryDetailsRow.tsx       Details-view row for a library entry
    TagEditor.tsx               Modal for adding/removing custom tags; supports single and
                                  multi-entry mode, autocomplete suggestions, and a recently-assigned
                                  quick-pick list shown when the input is focused but empty (recentTags prop)
    TagManager.tsx              Modal (uses Modal) for managing custom tags library-wide: lists each distinct
                                  custom tag with its entry count + a representative color, and per-tag actions
                                  rename (inline, merges on collision), recolor (ColorSwatch), and delete
                                  (inline confirm showing affected count). Opened from the tags FilterDropdown
                                  footer in LibraryView; operates on the active library's full entry list.
    ColorSwatch.tsx             Shared tag color picker (swatch button + palette popover) + the PALETTE presets.
                                  Used by TagEditor and TagManager. Colors are user-chosen content, not chrome.
    SettingsModal.tsx           Modal de ajustes: tema (dark/light), color de acento (ice/violet),
                                  idioma (ES/EN), export/import de biblioteca. Abre desde el engranaje de NavBar.
    Button.tsx                  Shared action button: variant (primary solid-accent CTA + glow / secondary bordered /
                                  danger red) + size (sm/lg). Forwards native button props. Used by App home,
                                  SettingsModal, and DeleteConfirmModal. Specialized controls (toggles, chips,
                                  icon-only, tag chips, folder rows) deliberately stay outside this component.
    Spinner.tsx                 Small inline accent loading wheel (AniList link search + series panel).
    ContinueButton.tsx          "Continue <file> (page/total)" / "Start <file>" / disabled "Up to date" for a
                                  pickContinueTarget result. In the library toolbar (whole library, also Enter with no
                                  selection) and the AniList panel's continueAction slot (that series' entries).
    Modal.tsx                   Shared modal shell: dimmed backdrop + Escape-to-close + click-outside +
                                  stopPropagation. Children = panel content; panelClassName sets width.
                                  Used by MoveFolderModal/DeleteConfirmModal/RemoveLibraryConfirmModal (in LibraryView)
                                  + ResolveLocationModal. RemoveLibraryConfirmModal guards the ✕ "remove library"
                                  action, warning that custom tags/favorites/ratings/progress are lost (disk files untouched).
    ResolveLocationModal.tsx    Ambiguous-entry location picker (lists same-name/size candidates). Uses Modal.
    AniListLinkModal.tsx        Links a series folder to an AniList media (debounced search pre-filled with the folder
                                  name; cover/format/year/totals per result) or unlinks it. Uses Modal. Opened from the
                                  ContextMenu "Link series to AniList…" item (single selection, unlinked folder) or the
                                  series panel's "Change link". See AniList sync.
    AniListSeriesPanel.tsx      Per-series panel for a linked folder, a non-modal right sidebar in its own column of
                                  LibraryView's content row (the list narrows and the cover grid reflows; Escape is ordered by LibraryView: expanded cover, then the selection, then the sidebar;
                                  another AL badge switches series via `key`). A series opened
                                  before renders complete from the cache (getCachedSeriesPanel) and refreshes silently;
                                  only a never-fetched one shows a spinner + skeletons. Stays mounted while reading, so it also
                                  follows SERIES_LINK_UPDATED_EVENT (fired by updateSeriesLink) to show sync/undo writes for its folder. Cover (click: extraLarge lightbox portaled to body, since the slide-in animation's kept transform would otherwise contain it; Escape closes only it, caught in the capture phase), format/year/totals, genres, plain-text
                                  synopsis, "Open on AniList", and a form for status/chapters/volumes/score (score control
                                  follows the account's format, see anilistScore.ts). Save sends only the changed fields.
                                  Shows the cached link with a notice when AniList can't be reached. Opened from the AL
                                  badge or the ContextMenu "View on AniList…" item.
    AniListSettings.tsx         SettingsModal section: connect (opens the authorize URL, user pastes the token),
                                  shows the viewer name, disconnect. Self-contained (no SettingsModal props).
    AniListToast.tsx            Per-window notice for ANILIST_SYNC_EVENT (synced/queued/authRequired/failed) with
                                  Undo for synced updates. Once it hides, a marker colored by the result stays at the
                                  bottom-center edge; hovering it recalls the last notice. Mounted once in App.tsx, above the reader overlay, keyed by the open
                                  file so opening another one drops the previous notice.
    AniListBadge.tsx            "AL" badge on LibraryCard/LibraryDetailsRow when the entry's folder is linked. Clicking it
                                  opens the series panel (stops propagation so the entry isn't selected/opened).
    ContextMenu.tsx             Library right-click menu: positioned + own dismiss (click-outside/Escape).
                                  Presentational; LibraryView passes semantic callbacks + ambiguousCandidates.
                                  First entry "Open in new window" (onOpenInNewWindow) and "Rename" (onRename) are
                                  single-selection only (each receives one entry). Open-in-new-window calls the
                                  open_new_window IPC with the entry's currentPath + libraryId, so the spawned window
                                  tracks reading state for that library entry (see Open-in-new-window tracking).
                                  Shows a non-clickable count header (library.selectedCount) when entries.length > 1.
    FilterDropdown.tsx          Shared folders/tags filter dropdown shell (trigger badge + search + scroll list +
                                  clear footer + dismiss). Owns open/search state; caller passes renderItems(search).
                                  Optional `footer` prop pins extra content below the clear footer (tags dropdown
                                  uses it for the "Manage tags" action that opens TagManager).
  hooks/
    useReadingProgress.ts       Per-file pageIndex + cascadeMode state, persisted to .reading-progress.dat. Its 3rd
                                  arg `cascadeIsPerFile` is false for library files (the library style owns cascade).
    useLibraryReaderStyle.ts    Per-library reader view style ("image": webtoon/cascade/doublePage/rtl/gap/zoom;
                                  "pdf": cascade/scale), last-used and auto-saved to .settings.dat. Applies the saved
                                  style on mount and returns `loaded` (Reader gates its content on it). No-op when the
                                  file has no library. Used by Reader and PDFReader.
    useReaderShortcuts.ts       Owns the keyboard switch for Reader (Ctrl+Arrow, W/C/D/S/G/I/P/J/+/-/Home/End/Escape/X; F/F11 fullscreen is global in App.tsx)
    usePageScroll.ts            PageUp/PageDown scrolling. Separate presses chain smooth scrolls from the running one's
                                  target (capped at MAX_QUEUED_PAGE_SCROLLS steps ahead); a held key (e.repeat) switches to a
                                  constant-speed rAF scroll (HELD_PAGE_SCROLL_SCREENS_PER_SEC) until keyup/blur. Retargeting a
                                  native smooth scroll restarts its slow ease-in, which is why it isn't used for key repeat.
                                  Used by Reader and PDFReader.
    useOverlayAutoHide.ts       Shared overlay visibility: shows on mousemove, hides after 1.5s (suppressed while info is pinned). Used by Reader and PDFReader.
    usePinPageIndicator.ts      Shared pin-page-indicator state, persisted to .settings.dat. Used by Reader and PDFReader.
  loaders/
    index.ts                    detectKind(path) + loadPages(path) dispatcher. epub, like pdf, is
                                  detected here but handled separately by the caller (not via loadPages).
    loadCbz.ts                  CBZ/ZIP: invoke('list_cbz_pages') → one `kreader://` URL per entry
    loadCbr.ts                  CBR/RAR via invoke('extract_cbr_to_dir') → asset-protocol URLs + tempDir
    loadImageFolder.ts          Single image → whole folder as asset-protocol URLs, sorted numerically
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
    thumbnails.ts               Cover extraction (CBZ/CBR/PDF/EPUB/image) + disk+memory cache
                                  (EPUB cover via extract_epub_cover Rust IPC)
    parseTags.ts                Auto-tag parsing from filename brackets [Author (Circle)]
    folderUtils.ts              Path helpers: getRelativeFolder(entryPath, rootPath), basename(path), normalizePath(path)
    scroll.ts                   Scroll-edge constants (SCROLL_EPSILON_PX, WHEEL_THROTTLE_MS, PAGE_SCROLL_FRACTION), ACTIVE_PAGE_ROOT_MARGIN (center-band active-page rootMargin, shared by Reader cascade + PDFCascade) + isAtTop/isAtBottom
    appWindow.ts                APP_NAME + setWindowTitle(name?) → "${name} - KReader" or "KReader"
    readingProgressStore.ts     Owns all .reading-progress.dat keys (page/cascade/bookmarks/epub-cfi/
                                  epub-locations), read+write. Consumed by useReadingProgress, PDFReader and
                                  EPUBReader; exposes getReadingProgress, getSavedPage, savePage/saveCascade/
                                  saveBookmarks, getEpubCfi/saveEpubCfi, getEpubLocations/saveEpubLocations, and
                                  getPageForPath(filePath). migrateReadingProgress(oldPath, newPath) moves all
                                  keys (incl. the epub ones) when a file is renamed.
    countPages.ts               Page count via Rust IPC (CBZ/PDF/CBR) or readDir (image folders). Returns null for unsupported formats and for EPUB (EPUB totalPages is set from the reader's location count on first open, not counted up front).
    anilistParse.ts             Pure filename -> ReadingUnit (volume / chapter (+season) / extra) + absoluteChapter
                                  (season offset from sibling files). Validated against a real ~16k-file collection.
    anilistApi.ts               AniList GraphQL client (search, Media totals + viewer's list entry, getSeriesDetails for the
                                  panel incl. the viewer's score format, partial SaveMediaListEntry, DeleteMediaListEntry,
                                  Viewer). Scores are always raw 0-100 (read as score(format: POINT_100), written as
                                  scoreRaw). Token via the anilist_token_* IPC (cached in memory).
                                  Throws AniListAuthError (reconnect) / AniListRetryableError (offline, 429).
    anilistStore.ts             Owns .anilist.dat: series links (folder name -> SeriesLink, incl. cached panel info + last
                                  known entry), the progress queue, the panel edit queue and the cached score format.
    anilistScore.ts             Pure raw-score (0-100) <-> account score format mapping for the panel's score control.
    anilistSync.ts              syncCompletedEntries(entries), flushPendingSyncs(), undoSync(notice), loadSeriesPanel /
                                  saveSeriesEdit (series panel), seriesFolderName(path). See AniList sync.
    continueReading.ts          pickContinueTarget(entries): the last opened file while unfinished, else the first
                                  unfinished file after it in its folder (numeric path order, as Ctrl+Arrow).
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

1. `App.tsx` opens files via `@tauri-apps/plugin-dialog`, calls `detectKind(path)` then either `loadPages(path)` (for image-based formats) or, for PDF, hands `<PDFReader>` an asset-protocol URL (`convertFileSrc(path)`).
2. Image-based formats return `{ pages: string[], pageNames?, startPage?, tempDir? }`. `pages` are URLs the WebView fetches lazily (see [Page delivery](#page-delivery-large-files)), so nothing is held in the JS heap; `blobUrlsRef` still revokes any `blob:` URL a loader might produce, and `tempDir` (CBR only) is deleted on the next `resetState`.
3. `Reader.tsx` receives the page array and delegates persistence to `useReadingProgress` and keyboard handling to `useReaderShortcuts`. Overlay visuals live in `<ReaderOverlay>`.
4. PDF takes a separate path: a URL (not bytes) is passed to `<PDFReader>`, which hands it to `pdfjs.getDocument({ url })` — pdf.js then range-requests only the pages it renders. It draws the current page on a canvas (single-page path) or delegates to `<PDFCascade>` for continuous vertical scroll (cascade mode, toggle `C`). PDFReader reads/persists the page index and cascade flag from `.reading-progress.dat` directly (it does **not** use `useReadingProgress`); the `cascade` key is shared with the image reader.
5. EPUB takes its own separate path (like PDF): bytes are passed to `<EPUBReader>`, which renders reflowable text via `epubjs` into an iframe. It persists position as a CFI and caches the epubjs location table in `.reading-progress.dat` directly (not via `useReadingProgress`). Because EPUB has no fixed pages, it mirrors the current location index into the shared `{path}-page` key and reports the location count via `onPagesLoaded`, so the library's page-based progress bar and reading-state machinery work unchanged.

### Page delivery (large files)

Nothing loads a whole file into the WebView. A page is always a URL the webview
fetches on demand, so peak memory is a handful of decoded pages regardless of
archive size (a 1+ GB comic used to OOM the renderer and kill the window):

| Format | Mechanism |
|--------|-----------|
| CBZ/ZIP | `kreader://` custom protocol (`register_asynchronous_uri_scheme_protocol` in `lib.rs`). `list_cbz_pages` returns the image entry names; the loader sorts them and builds `convertFileSrc(path, "kreader") + "?entry=<name>"` per page. Each request opens the zip, reads the central directory and inflates that single entry on a worker thread. Nothing is written to disk. Responses carry `PAGE_CACHE_CONTROL`, so the webview serves a revisited page from its own cache instead of re-inflating it — without that header nothing is reused and `Reader`'s preloading is wasted work. |
| CBR/RAR | RAR is sequential-only, so `extract_cbr_to_dir` unpacks the archive once into `app_cache_dir()/kreader-cbr/<hash>/` (unrar writes each page straight to disk — flat, generated `00000.ext` filenames, never the entry's own name, which could contain `..`). Pages are then plain `convertFileSrc` URLs. The dir is deleted on the next `resetState`; leftovers from a crash are pruned at startup in `setup()`. |
| Images / PDF | `convertFileSrc(path)` — the built-in asset protocol, which also serves HTTP ranges (that's what lets pdf.js load a huge PDF incrementally). |

The asset protocol must stay enabled in `tauri.conf.json` (`app.security.assetProtocol`,
scope `**` since comics live anywhere) and the `tauri` crate needs its `protocol-asset` feature.

`Reader.tsx` only mounts the page(s) on screen, so it preloads `PRELOAD_SCREENS` screens in
**both** directions (`new Image().src`) — going back is as common as going forward, and the
fetches only pay off because the responses are cacheable.

### State persistence (Tauri Store)

- `.recent-files.dat` — list of up to 10 recently opened file paths.
- `.reading-progress.dat` — per-file page index (`{filePath}-page`), cascade mode flag (`{filePath}-cascade`, only for files opened outside a library; library files use the library's `reader-style:*` instead), bookmarks (`{filePath}-bookmarks`, `number[]`), and for EPUB the reading position (`{filePath}-epub-cfi`, a CFI string) + cached location table (`{filePath}-epub-locations`, JSON from epubjs `Locations.save()`), keyed by absolute file path.
- `.settings.dat` — global app settings. Current keys:
  - `pin-page-indicator` — boolean, pin page number overlay (also pins the EPUB reader's progress %).
  - `epub-font-size` — number, EPUB reader font size as a percent (global preference, default 100).
  - `epub-double-page` — boolean, EPUB reader double-page spread (global, default false). Uses epubjs `spread: "auto"`, so a window narrower than epubjs's `minSpreadWidth` still shows one page.
  - `epub-progress-mode` — `"percent" | "chapter" | "total"`, which value the EPUB reader's progress indicator shows (global, default `percent`; click the indicator to cycle).
  - `library-view-mode` — `"details" | "grid"`, last used view mode in library.
  - `last-app-view` — `"home" | "library"`, restores active view on next launch.
  - `last-library-id` — string, id of the last active library; restored on launch (falls back to the first library if it no longer exists).
  - `folder-filter:<libraryId>` — `Record<string, "full" | "partial">`, persisted folder filter per library.
  - `favorites-filter:<libraryId>` — boolean, persisted "show favorites only" filter per library (default false).
  - `anilist-panel:<libraryId>` — `string | null`, folder name of the AniList series sidebar left open in that library (restored on library load, hidden if no longer linked).
  - `favorites-respect-folders` — boolean, whether the favorites filter is intersected with the folder filter; when false the favorites filter ignores folders (default false).
  - `show-progress-bar` — boolean, show reading progress bar in library cards and rows (default false).
  - `show-page-count` — boolean, show page count on library cards (default false).
  - `auto-backup` — boolean, enable automatic library backups on startup (default false).
  - `last-backup-at` — number, epoch-ms of the last auto-backup (throttle, default 0).
  - `keep-data-on-remove` — boolean, keep sticky entry metadata when a library is removed (default true).
  - `reader-style:image:<libraryId>` — `ImageReaderStyle` (`{ webtoon, cascade, doublePage, rtl, gap, zoom }`), the image reader's last-used view style in that library. Owned by `useLibraryReaderStyle`.
  - `reader-style:pdf:<libraryId>` — `PdfReaderStyle` (`{ cascade, scale }`), PDFReader's counterpart (its scale isn't comparable to the image zoom, so it's stored apart).
  - `recent-custom-tags` — `string[]`, recently-assigned custom tag values (MRU, deduped case-insensitively, capped). Feeds the TagEditor quick-pick list shown on empty-input focus.
- `.entry-meta.dat` — sticky user metadata keyed by entry id. Single key `entry-meta` → `Record<id, EntryMeta>` where
  `EntryMeta = { customTags?, isFavorite?, rating?, readingState? }`. Owned by `entryMetaStore.ts`. See Library system.
- `.library.dat` — library definitions and entries. Keys:
  - `libraries` — `Library[]` list of all libraries.
  - `entries:<libraryId>` — `LibraryEntry[]` for that library.
- `.anilist.dat` — AniList sync, owned by `anilistStore.ts`. Keys: `links` (`Record<folderName, SeriesLink>`, where
  `SeriesLink = { mediaId, title, coverUrl?, chapters, volumes, info?, entry? }`, totals cached and refreshed on each
  sync; `info` = panel data (large + extraLarge cover, format, year, siteUrl, genres, description) and `entry` = last known list
  entry with queued edits applied, both optional for links made before the series panel), `queue` (`PendingSync[]` =
  `{ folderName, chapter?, volume? }`, merged by max per folder), `edits` (`PendingEdit[]` = `{ folderName, mediaId,
  edit }`, only the fields changed in the panel, merged per field, later wins; dropped when the folder is unlinked or
  relinked to another media) and `score-format` (the account's `ScoreFormat`, cached for offline). Every
  read-modify-write in `anilistStore.ts` runs under a module-level promise lock (`exclusive`), since sync, the panel
  and the flush write concurrently. Links are included in export/import; the access token is **not** stored here
  (see AniList sync).
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
- `scanGenRef` is bumped by every scan that starts; a scan only sets React state (entries, missing/ambiguous, queues, spinner) while it is still the latest, so switching libraries mid-scan can't render the previous library's entries (its disk writes still complete — they're valid for that library). The initial scan always runs on a library switch; `scanRef` only keeps the background re-scan from overlapping one in flight; `scanAbortRef` (set by `handleOpen`) makes a scan drop its results if the user opens a file mid-scan, avoiding store-write contention with file loading.

**Mounting model:** `App.tsx` keeps the home/library chrome mounted and renders the Reader/PDFReader and the loading spinner as **overlays** (the chrome gets `hidden` while `view === "reader"`, not unmounted). Once visited, `LibraryView` stays mounted for the session (`libraryMounted`), so its state, scroll position and warm in-memory thumbnail cache survive entering/leaving the reader — opening a comic and returning is instant. The `active` prop (`view === "library"`) tells `LibraryView` when it's the visible view (drives the background re-scan above).

**Entry identity:** `id = "{filename}::{sizeBytes}"`. This means an *external* rename is treated as a new file; moving within the library root is auto-resolved on next scan.

**Rename (context menu, single entry):** `handleRename` renames the file on disk via `rename` (`@tauri-apps/plugin-fs`, same directory, separator/path preserved) and, because the id is filename-derived, migrates every id-/path-keyed record so nothing is orphaned or duplicated on the next scan: it swaps the library entry (new id/filename/currentPath, `autoTags` re-parsed, `customTags` kept), `renameEntryMeta(oldId→newId)`, `migrateReadingProgress(oldPath→newPath)` (page/cascade/bookmarks), and clears the old thumbnail cache (`clearThumbnailDiskCache([oldId])`, regenerates lazily). The `RenameModal` pre-fills the base name with the extension shown as a fixed suffix, validates against `INVALID_FILENAME_CHARS`, and stays open if the destination already `exists` (handler returns false).

**Sticky entry metadata (`entryMetaStore.ts`):**
- `customTags`, `isFavorite`, `rating` and `readingState` are mirrored into `.entry-meta.dat`, keyed by entry id (so they're library-independent). The `LibraryEntry` in `.library.dat` remains the live mirror the UI reads/sorts/filters; the meta store is the durable copy.
- **Write-through:** the libraryStore setters (`setFavorite`/`setReadingState`/`batchSetReadingState`/`setCustomTags`/`setRating`/`batchSetCustomTags`) write both the entry and the meta. All readingState writers go through `setReadingState` (LibraryView open, `readingSession.ts` sibling nav) or `batchSetReadingState` (LibraryView bulk mark-as-read/reset: closes the menu and updates the UI optimistically, then writes once in the background).
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
- `customTags` — user-defined, stored per entry. Multi-entry edits use `batchSetCustomTags` (single read-modify-write) to avoid concurrent-write race conditions. On save, the curated tag values are recorded into the `recent-custom-tags` MRU (`pushRecentTags`); `LibraryView` loads them and passes `recentTags` to `TagEditor`, which surfaces them as a quick-pick list when the input is focused but empty.
- **Library-wide management (`TagManager`):** rename, recolor and delete a custom tag across every entry at once. `LibraryView` handlers (`handleRenameTag`/`handleRecolorTag`/`handleDeleteTag`) compute the affected-entry updates and funnel them through a shared `persistCustomTagUpdates` helper (`batchSetCustomTags` + optimistic `setEntries`), the same path `handleTagSave` uses. Rename merges (dedupes) when an entry already has the destination tag, syncs the `selectedTags` filter (swap on rename, drop on delete), and keeps the `recent-custom-tags` MRU consistent (`removeRecentTags` drops the old/deleted value; rename then pushes the new one) so stale values don't linger in the TagEditor quick-pick. Only `customTags` are managed — `autoTags` regenerate on scan.
- Tag filter in UI is session-only (module-level variable `sessionSelectedTags`; resets on app restart). Now that `LibraryView` stays mounted for the session (see Mounting model), the module-level vars are a redundant safety net rather than the primary persistence mechanism.

**Favorites filter:**
- "Show favorites only" toggle is persisted **per library** to `.settings.dat` under `favorites-filter:<libraryId>` (same load/save lifecycle as the folder filter: loaded on library switch via a ref guard `favoritesFilterLoadedForLibRef`, saved on change). Survives app restart and is independent per library.
- `favorites-respect-folders` setting (global, default false) controls how the favorites filter interacts with the folder filter. When **off** (default), an active favorites filter ignores the folder filter (shows favorites from every folder); when **on**, favorites are intersected with the folder filter. Computed once per render as `applyFolderFilter = !(showFavoritesOnly && !favoritesRespectFolders)` and used to gate the folder-filter branch in the entry predicate. Toggled in `SettingsModal`; loaded/owned by `App.tsx` and passed to `LibraryView`.

**Continue reading:** `pickContinueTarget` over the entries present on disk drives the toolbar `ContinueButton`
and Enter (ignored with a selection, on a focused control, or while an `aria-modal` dialog / `role="menu"` is open;
modal shells carry those attributes for this). It relies on `lastOpenedAt` being fresh, so the background re-scan
merges `lastOpenedAt`/`totalPages` from the store into its live baseline (sibling nav and other windows only write
the store).

**Search bypass ("Whole library"):**
- While the search box has text and any filter (folders/tags/favorites) is active, a toggle next to it (`searchAllLibrary`, session-only) makes the search match against all entries, ignoring those filters. The filter state itself is never touched — only bypassed — and `handleSearchChange` resets the toggle when the text is cleared (also on library switch), so filters come back as they were. The button shows `+N` = matches hidden by the filters.

**Folder filter:**
- Three states per folder: unselected → `"full"` (✓, includes subdirectories recursively) → `"partial"` (—, direct children only) → unselected.
- Union semantics: an entry matches if any selected folder covers it.
- Persisted to `.settings.dat` under `folder-filter:<libraryId>`, loaded on library switch, saved on change.
- A ref guard (`folderFilterLoadedForLibRef`) prevents saving before the async load completes.

**Thumbnails (`utils/thumbnails.ts`):**
- In-memory cache (deduplicates concurrent requests per session).
- Disk cache in `appCacheDir()/kreader-thumbnails-v2/`, keyed by entry ID, stored as JPEG. The dir name is versioned:
  bump it (and add the old name to `LEGACY_THUMBNAIL_CACHE_SUBDIRS`, deleted on first use) whenever generation changes.
- `resizeBlob` crops images taller than the 2:3 cover to their top before scaling, so webtoon strips stay sharp
  instead of shrinking to a few pixels wide.
- Concurrent generation limited to `MAX_CONCURRENT = 4` via semaphore.
- Cover extraction: `extract_cbz_cover` / `extract_cbr_cover` (Rust IPC, raw bytes), `pdfjs` for PDF (by URL via `convertFileSrc`, so only the first page is fetched — never the whole file), direct `readFile` for images.

### Rust backend (`src-tauri/src/`)

- `main.rs` — trivial: just calls `kreader_lib::run()`.
- `lib.rs` — exposes Tauri commands:
  - `take_window_file` — returns (and clears) the `PendingFile` (`{ path, library_id }`) the calling window should open on mount, looked up by its label in the `PendingFiles` map. `library_id` is `None` for CLI / file-association launches and `Some` when the window was spawned from the library "Open in new window" action (lets that window keep library reading state in sync — see Library system). The initial `main` window's entry is seeded from the CLI argument in `setup()`; windows spawned by `open_new_window` or the single-instance callback seed their own entry. Returns `None` once consumed.
  - `open_new_window(path?, libraryId?)` — spawns a new app window in the current process (label `reader-{n}`), optionally pre-loading `path` (with `libraryId` when the file is a library entry). Used by the NavBar "New window" button (no args) and the library "Open in new window" context-menu action (path + libraryId).
  - `list_cbz_pages(path)` — image entry names of a CBZ/ZIP, read from the central directory only. The frontend sorts them and turns each into a `kreader://` page URL (see Page delivery).
  - `extract_cbr_to_dir(path)` — unpacks a CBR/RAR into `app_cache_dir()/kreader-cbr/<hash-of-path>/`, one entry at a time, and returns `{ dir, pages }` (absolute paths, ordered by entry name). Memory stays flat: unrar writes straight to disk.
  - `extract_cbr_cover(path)` — returns only the first image from a CBR/RAR (for thumbnails). Stops after first image found.
  - `extract_cbz_cover(path)` — returns only the first image from a CBZ/ZIP (alphabetically sorted); reads only the central directory + one compressed entry.
  - `extract_epub_cover(path)` — returns the cover image from an EPUB (for thumbnails). Reads container.xml → OPF (parsed by lightweight string scanning, no XML crate) → cover href (EPUB3 `properties="cover-image"`, then EPUB2 `<meta name="cover">`, then first image item), then the single cover entry. Same binary layout as extract_cbz_cover.
  - `scan_library(root)` — recursive directory walk returning `ScannedFile[]` (path, filename, size_bytes, modified_secs) for all supported extensions.
  - `list_subdirs(root)` — recursive walk returning all subdirectory paths relative to root (`"/"` for root itself, `"Leído"`, `"Leído/Archivado"`, etc.). Used by the "Move to folder" context menu action.
  - `trash_file(path)` — sends a file to the OS trash via the `trash` crate; falls back to permanent deletion if trash is unavailable.
  - `count_cbz_pages(path)` — counts image entries in a CBZ/ZIP central directory without decompression. Returns `u32`.
  - `count_pdf_pages(path)` — counts pages via `lopdf::Document::load` (reads xref + catalog only, no content streams). Returns `u32`.
  - `count_cbr_pages(path)` — counts image entries in a CBR/RAR via `open_for_listing` (no extraction). Returns `u32`.
  - `anilist_token_get()` / `anilist_token_set(token)` / `anilist_token_delete()` — AniList token in the OS credential
    store (`keyring`, Windows Credential Manager). `get` returns `None` when absent; `delete` is a no-op when absent.

All commands return `Result<T, String>`. Large binary data (images) is returned as `tauri::ipc::Response` (raw bytes) to avoid base64 inflation and keep bytes outside V8's heap.

`lib.rs` also registers the `kreader` URI scheme (see Page delivery) — that one is a protocol handler, not a command, so it isn't in `invoke_handler![]`. Its parsing + zip lookup is covered by the `cargo test` in the file's `mod tests`.

**Binary response layout** (used by `extract_cbr_cover`, `extract_cbz_cover`, `extract_epub_cover`):
```
u32 LE  count
for each image:
  u8       mime_len
  [bytes]  mime (ASCII)
  u32 LE   data_len
  [bytes]  image data
```

Page counting (CBZ/PDF/CBR) also runs in Rust to avoid loading full files into WebView2 heap — only a `u32` is returned to JS. Image folder counting uses `readDir` in TS (lightweight).

### AniList sync

Pushes reading progress to the user's AniList list automatically, and lets the user view and edit a series' entry by
hand in the series panel. Nothing on AniList ever changes KReader's local reading state.

- **Series = folder name.** A link is keyed by the name of the folder that holds the file (`seriesFolderName`), not its
  path or library, so it survives moving the folder (e.g. into `- Leído/`) and covers files added later. Two folders
  with the same name share a link.
- **Auth:** implicit grant with AniList's `/oauth/pin` redirect (client id in `anilistApi.ts`): the user pastes the token
  shown in the browser. `connectAniList` validates it with a `Viewer` query before storing it. The token (1 year,
  near-full account access, no refresh) lives in the OS credential store via the `keyring` crate
  (`anilist_token_get/set/delete` in `lib.rs`), never in a `.dat` store or backup.
- **Trigger:** `syncCompletedEntries` is called wherever an entry becomes `completed`: `LibraryView.handleOpen`'s
  onComplete, `handleMarkAsRead` (bulk: only entries not already completed) and `readingSession.ts` onComplete
  (sibling nav + open-in-new-window). Re-reading a completed file sends nothing. Entries are grouped per linked
  folder, one request per series.
- **Mapping (`computeNext`):** volume files set `progressVolumes` and, when AniList knows both totals, an estimated
  `progress = floor(vol * chapters / volumes)`; chapter files set `progress` (range end, decimals floored, seasons
  offset by earlier seasons' highest chapter in the folder); extras send nothing. Values are max'd with AniList's
  current ones and capped at the totals. Status: missing/PLANNING/CURRENT -> CURRENT, -> COMPLETED when a total is
  reached (progress filled to the totals); PAUSED/DROPPED/REPEATING/COMPLETED are never changed. No-op updates are skipped.
- **Notices & undo:** results go out as a `CustomEvent` (`ANILIST_SYNC_EVENT`) on the window that read the file;
  `AniListToast` renders them. Undo restores the previous values (or deletes an entry KReader created) only if AniList
  still holds what KReader wrote (`AniListUndoConflictError` otherwise).
- **Offline queue:** auth and retryable failures enqueue the read (`.anilist.dat` `queue`); the `main` window flushes it
  on startup, on the `online` event, and after reconnecting in settings.
- **Series panel (`AniListSeriesPanel`):** `loadSeriesPanel` first sends edits still queued for that folder (so the
  panel never shows values older than the user's own edits), then fetches `getSeriesDetails` and caches it into the
  link. When AniList can't be reached it returns the cached link with `stale` set. `saveSeriesEdit` sends only the
  changed fields; on auth/retryable failure it queues them (`edits`) and applies them to the cached `entry` so the
  panel shows them offline. A series not on the list yet gets status CURRENT when an edit creates its entry.
  Queued edits always go out **before** progress: `flushPendingSyncs` sends them before the progress queue, and
  `pushProgress` sends the folder's own queued edits before each read, so a later read can still raise progress over a
  hand-set value and a stale edit never lowers it. A still-queued edit is re-applied to freshly fetched data, and undo
  writes the restored entry back to the cache. Scores stay raw 0-100 end to end; only the control maps them to the account's
  format (`anilistScore.ts`), so a queued score doesn't depend on the format active when it was made.

### Reader style per library

`App.tsx` tracks `readerLibraryId` (set by `handleOpen`'s 5th arg: the library's `onOpen`, sibling nav inside a library
— even for unscanned siblings — and "Open in new window" startup with a `library_id`) and passes it to `Reader` /
`PDFReader` as `libraryId`. With a library, `useLibraryReaderStyle` restores and auto-saves the view style per library
(last used wins), replacing the per-file cascade flag; without one (home, recents, OS file association) nothing changes:
only the per-file cascade is remembered.

### Sibling-file navigation (Ctrl+Arrow)

`Ctrl+ArrowRight/Left` in Reader behaves differently depending on the open file:

- **CBZ/CBR/ZIP/RAR**: reads the parent directory, lists files with the same extension, fires a `CustomEvent("openNewCbz", { detail: path })` on `window`. `App.tsx` listens for it and reloads.
- **Standalone image**: the whole folder is already loaded as pages, so it just advances/rewinds the page index in place.

When the current file was opened from the library, sibling navigation keeps library reading-state in sync. `App.tsx` tracks the active `libraryId` in `activeLibraryIdRef` (set via the 4th arg of `LibraryView`'s `onOpen`), and `handleOpenNewCbz` resolves the sibling's entry via `getEntryByPath(libraryId, path)` then calls `startLibraryReadingSession(entry)` (`utils/readingSession.ts`) to mark it `in_progress`/`completed` and record `totalPages`/`lastOpenedAt` — the same bookkeeping `LibraryView.handleOpen` does for the first open, but written straight to disk since `LibraryView` is unmounted during reading. Siblings not present in the library (unscanned) fall back to a plain reload with no tracking.

### Open-in-new-window tracking

The library context-menu "Open in new window" action calls `open_new_window` with the entry's `currentPath` **and** `libraryId`. On mount, the spawned window's startup effect reads the `PendingFile` from `take_window_file`; when `library_id` is present it resolves the entry via `getEntryByPath` and runs `startLibraryReadingSession(entry)` — the **same** disk-only bookkeeping as sibling navigation — so the comic is marked `in_progress`/`lastOpenedAt` on open, `totalPages` on load, and `completed` when finished. The `main` window picks these up on its next re-scan (the shared single-process store, see Multi-window). The window opens with `returnTo: "home"` (it's a standalone reader, not a library browser), so Ctrl+Arrow sibling nav **within** the spawned window does not track — consistent with the cross-window-reactivity limitation below.

### System file associations

`App.tsx` also listens for the Tauri event `openCbzFromSystem` (emitted when the OS opens a registered file with KReader via the file association in `tauri.conf.json`).

## Multi-window (single-instance)

KReader runs as a **single process** with potentially multiple windows, via `tauri-plugin-single-instance` (registered as the *first* plugin in `lib.rs`). This is deliberate: the Tauri Store keeps its canonical map in Rust shared across all windows of a process, so multiple windows can read/write reading progress, bookmarks, and settings without clobbering each other. Separate *processes* would each hold an independent in-memory copy and overwrite the whole file on `save()` (last-write-wins), which is the bug this design avoids.

- A second OS launch (e.g. file-association double-click while running) is intercepted by the single-instance callback, which spawns a new window via `create_reader_window` instead of starting a second process.
- The NavBar "New window" button calls `open_new_window` to spawn a fresh window from inside the app. New windows inherit the `main` window's current inner size (and maximized state) via `create_reader_window`, falling back to `DEFAULT_WINDOW_WIDTH`/`DEFAULT_WINDOW_HEIGHT` (800×600) when `main` is gone.
- Each window resolves which file to open on mount by calling `take_window_file` (keyed by its own window label), which returns a `PendingFile` (`{ path, library_id }`) — see the `PendingFiles` map in `lib.rs`. The `main` window's entry comes from the CLI argument (no `library_id`); the library "Open in new window" action seeds an entry that carries `library_id` (see Open-in-new-window tracking).
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
| `F` / `F11` | Toggle fullscreen |
| `X` | Close window |

Global hotkeys (`F` / `F11` = fullscreen) are guarded in `App.tsx`: they do not fire when focus is on an `INPUT`, `TEXTAREA`, or `contenteditable` element. The `T` theme-toggle hotkey was removed when the theme control moved to the settings modal.

The **EPUB reader** has its own reduced keyboard (it owns its handler, like PDFReader; most comic shortcuts don't apply to reflowable text): `←`/`→` and `PageUp`/`PageDown` turn the page, `Home`/`End` jump to the first/last chapter, `+`/`-` change font size, `T` toggles the table of contents, `D` toggles double page, `P` pins the progress indicator so it stays visible (click it to cycle percent / chapter pages / total pages), `I` the info overlay, `F`/`F11` fullscreen, `X` closes the window, and `Escape` closes the TOC (if open) or the reader. These are registered on both `window` and `rendition.on("keydown")` because the book's iframe swallows key events when focused.

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

The **asset protocol** is not gated by capabilities: it is enabled in `tauri.conf.json`
(`app.security.assetProtocol.enable` + `scope`) and needs the `protocol-asset` feature on the
`tauri` crate in `Cargo.toml` — the build fails with an allowlist mismatch if the two disagree.

## Key dependencies

- `pdfjs-dist` — PDF rendering; worker is loaded via Vite `?url` import. Documents are opened by URL, never by bytes.
- `epubjs` — EPUB rendering (reflowable text in an iframe). Ships loose/partly-wrong TypeScript types (e.g. `Locations.locationFromCfi` is typed as returning a `Location` but returns a numeric index; `Locations.total` is undeclared) — `EPUBReader` narrows the pieces it uses via a local interface. Pulls in some stale transitive deps (`@xmldom/xmldom`).
- `unrar` (Rust) — CBR extraction and page counting in the backend.
- `zip` (Rust) — CBZ page listing, per-page reads for the `kreader://` protocol, and covers.
- `percent-encoding` (Rust) — decodes the file path / entry name out of a `kreader://` request URI (the counterpart of the frontend's `convertFileSrc` + `encodeURIComponent`).
- `keyring` (Rust, `windows-native`) — OS credential store for the AniList token.
- `tauri-plugin-opener` / `@tauri-apps/plugin-opener` — opens the AniList authorize URL in the default browser
  (`opener:default` in the capability).
- `lopdf` (Rust) — PDF page counting (`count_pdf_pages` command). `default-features = false` to avoid pulling in rayon/chrono/time.
- `react-hotkeys-hook` — present in `package.json` but unused; keyboard handling is done via `addEventListener` in `useReaderShortcuts` and `App.tsx`.
- `@tauri-apps/plugin-store` — key-value persistence for recent files, reading progress, settings, and library data.
- `tauri-plugin-window-state` (Rust) — persists/restores window geometry to `.window-state.json`. Registered right after `single_instance` in `lib.rs`. Used purely via its Rust autosave/restore; no JS commands invoked, so no capability entry is required.
