import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { rename, mkdir, exists } from "@tauri-apps/plugin-fs";

import type { Library, LibraryEntry, SortDirection, SortField, Tag, ViewMode } from "../types/library";
import {
  getLibraries,
  addLibrary,
  removeLibrary,
  getEntries,
  upsertEntries,
  upsertEntry,
  updateEntryPath,
  removeEntry,
  setFavorite,
  setRating,
  setReadingState,
  setLastOpenedAt,
  setTotalPages,
  clearAllTotalPages,
  batchSetCustomTags,
} from "../utils/libraryStore";
import { getEntryMetaMap, batchSetEntryMeta, deleteEntryMeta, renameEntryMeta, type EntryMeta } from "../utils/entryMetaStore";
import { countPages } from "../utils/countPages";
import { clearThumbnailDiskCache } from "../utils/thumbnails";
import { getLibraryViewMode, saveLibraryViewMode, getSavedFolderFilter, saveFolderFilter, getKeepDataOnRemove, getRecentTags, pushRecentTags, removeRecentTags } from "../utils/settingsStore";
import { getAllPageProgress, migrateReadingProgress } from "../utils/readingProgressStore";
import { parseAutoTags } from "../utils/parseTags";
import { getRelativeFolder, basename, normalizePath } from "../utils/folderUtils";
import { LibraryDetailsRow, COL_WIDTHS, COL_STAR, COL_RATING } from "./LibraryDetailsRow";
import LibraryCard from "./LibraryCard";
import TagEditor from "./TagEditor";
import TagManager from "./TagManager";
import Modal from "./Modal";
import ResolveLocationModal from "./ResolveLocationModal";
import ContextMenu from "./ContextMenu";
import FilterDropdown from "./FilterDropdown";
import Button from "./Button";

type ScannedFile = {
  path: string;
  filename: string;
  size_bytes: number;
  modified_secs: number;
};

type ContextMenuState = {
  x: number;
  y: number;
  entries: LibraryEntry[];
};

// Session-only tag filter — survives LibraryView unmount (reader open/close)
// but resets when the app is restarted.
let sessionSelectedTags: Set<string> = new Set();

// Session-only favorites filter — same lifecycle as sessionSelectedTags.
let sessionShowFavoritesOnly = false;

// Session-only library scroll position — restored on LibraryView remount
// (reader open/close); resets on app restart.
let sessionScrollTop = 0;

function makeEntryId(filename: string, sizeBytes: number): string {
  return `${filename}::${sizeBytes}`;
}

function DetailsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
    </svg>
  );
}

// Folder-tree layout (rem). Each nesting level shifts the row right so the
// list reads as a hierarchy; base padding aligns the top level with the header.
const ROOT_FOLDER_PATH = "/";
const FOLDER_BASE_PADDING_REM = 0.75;
const FOLDER_INDENT_REM = 0.85;

// Characters not allowed in a filename on Windows (and unsafe cross-platform).
const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/;

// Splits a filename into its base name and extension (incl. the dot). A leading
// dot (dotfile with no extension) is treated as all-base.
function splitFilename(filename: string): { base: string; ext: string } {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return { base: filename, ext: "" };
  return { base: filename.slice(0, dot), ext: filename.slice(dot) };
}

function RenameModal({
  entry,
  onRename,
  onClose,
}: {
  entry: LibraryEntry;
  // Returns false when the target name already exists on disk (kept open so the
  // user can pick another name); true closes the modal via the parent.
  onRename: (entry: LibraryEntry, newFilename: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { base, ext } = splitFilename(entry.filename);
  const [value, setValue] = useState(base);
  const [collision, setCollision] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the field and pre-select the base name (not the extension) on open.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const trimmed = value.trim();
  const invalid = INVALID_FILENAME_CHARS.test(trimmed);
  const unchanged = trimmed === base;
  const canSave = trimmed !== "" && !invalid && !unchanged && !busy;

  async function handleSubmit() {
    if (!canSave) return;
    setBusy(true);
    setCollision(false);
    try {
      const ok = await onRename(entry, trimmed + ext);
      // false = destination already exists; keep open so the user can retry.
      if (!ok) setCollision(true);
    } catch {
      // Disk error (e.g. missing/locked file): unstick without a misleading
      // "already exists" message. The user can retry or cancel.
    } finally {
      setBusy(false);
    }
    // On success the parent unmounts this modal; the setBusy above is a no-op.
  }

  return (
    <Modal onClose={busy ? () => {} : onClose} panelClassName="max-w-md">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {t("library.renameTitle")}
        </h2>
        <button
          onClick={onClose}
          disabled={busy}
          className="text-lg leading-none opacity-60 hover:opacity-100"
          style={{ color: "var(--text-muted)" }}
        >
          ×
        </button>
      </div>
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => { setValue(e.target.value); setCollision(false); }}
          onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
          className="flex-1 min-w-0 text-sm rounded-lg px-3 py-1.5 outline-none transition-colors bg-[var(--bg-tab-active)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] border border-[var(--border-nav)] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--glow-soft)]"
        />
        {ext && (
          <span className="text-sm shrink-0 font-mono" style={{ color: "var(--text-muted)" }}>{ext}</span>
        )}
      </div>
      {invalid && (
        <p className="text-xs" style={{ color: "var(--color-danger)" }}>{t("library.renameInvalid")}</p>
      )}
      {collision && (
        <p className="text-xs" style={{ color: "var(--color-danger)" }}>{t("library.renameExists")}</p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {t("library.cancel")}
        </Button>
        <Button variant="primary" onClick={handleSubmit} disabled={!canSave}>
          {t("library.renameBtn")}
        </Button>
      </div>
    </Modal>
  );
}

function MoveFolderModal({
  entries,
  folders,
  rootPath,
  onMove,
  onClose,
}: {
  entries: LibraryEntry[];
  folders: string[];
  rootPath: string;
  onMove: (entries: LibraryEntry[], folder: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  const currentFolders = new Set(entries.map((e) => getRelativeFolder(e.currentPath, rootPath)));
  const destinations = folders.filter((f) => !currentFolders.has(f));

  return (
    <Modal onClose={onClose}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {t("library.moveToFolderTitle")}
        </h2>
        <button
          onClick={onClose}
          className="text-lg leading-none opacity-60 hover:opacity-100"
          style={{ color: "var(--text-muted)" }}
        >
          ×
        </button>
      </div>
      {destinations.length === 0 ? (
        <p className="text-xs py-2" style={{ color: "var(--text-muted)" }}>
          {t("library.moveNoDestinations")}
        </p>
      ) : (
        <div className="flex flex-col gap-0.5 max-h-64 overflow-y-auto">
          {destinations.map((folder) => {
            const isRoot = folder === ROOT_FOLDER_PATH;
            const segments = isRoot ? [] : folder.split("/");
            const name = isRoot ? t("library.rootFolder") : segments[segments.length - 1];
            const paddingLeft = `${FOLDER_BASE_PADDING_REM + segments.length * FOLDER_INDENT_REM}rem`;
            return (
              <button
                key={folder}
                onClick={() => onMove(entries, folder)}
                title={isRoot ? undefined : folder}
                className="group flex items-center gap-2 text-left text-xs py-2 pr-3 rounded border-l-2 border-transparent transition-colors hover:bg-[var(--bg-tab-active)] hover:border-[var(--color-selection)]"
                style={{ color: "var(--text-primary)", paddingLeft }}
              >
                <span aria-hidden="true">📁</span>
                <span className="truncate">{name}</span>
                <span
                  aria-hidden="true"
                  className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ color: "var(--color-selection)" }}
                >
                  →
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

function DeleteConfirmModal({
  entries,
  onConfirm,
  onClose,
}: {
  entries: LibraryEntry[];
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  const message = entries.length === 1
    ? t("library.deleteConfirm", { name: entries[0].filename.replace(/\.[^.]+$/, "") })
    : t("library.deleteConfirmMany", { count: entries.length });

  return (
    <Modal onClose={onClose} panelClassName="max-w-sm">
      <div className="flex items-start gap-3.5">
        <span
          className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
          style={{ border: "1px solid var(--color-danger)", color: "var(--color-danger)" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
          </svg>
        </span>
        <p className="text-sm leading-relaxed pt-1" style={{ color: "var(--text-primary)" }}>{message}</p>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {t("library.cancel")}
        </Button>
        <Button variant="danger" onClick={onConfirm}>
          {t("library.deleteConfirmBtn")}
        </Button>
      </div>
    </Modal>
  );
}

function RemoveLibraryConfirmModal({
  libraryName,
  keepData,
  onConfirm,
  onClose,
}: {
  libraryName: string;
  keepData: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const messageKey = keepData
    ? "library.removeLibraryConfirmKeep"
    : "library.removeLibraryConfirmForget";

  return (
    <Modal onClose={onClose} panelClassName="max-w-sm">
      <div className="flex items-start gap-3.5">
        <span
          className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
          style={{ border: "1px solid var(--color-danger)", color: "var(--color-danger)" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </span>
        <p className="text-sm leading-relaxed pt-1" style={{ color: "var(--text-primary)" }}>
          {t(messageKey, { name: libraryName })}
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {t("library.cancel")}
        </Button>
        <Button variant="danger" onClick={onConfirm}>
          {t("library.removeLibrary")}
        </Button>
      </div>
    </Modal>
  );
}

function PurgeGhostsModal({
  ghosts,
  onConfirm,
  onClose,
}: {
  ghosts: LibraryEntry[];
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    await onConfirm();
  }

  return (
    <Modal onClose={loading ? () => {} : onClose} panelClassName="max-w-md">
      <div className="flex items-start gap-3.5">
        <span
          className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
          style={{ border: "1px solid var(--color-danger)", color: "var(--color-danger)" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </span>
        <p className="text-sm leading-relaxed pt-1" style={{ color: "var(--text-primary)" }}>
          {t("library.purgeGhostsConfirm", { count: ghosts.length })}
        </p>
      </div>
      <div className="flex flex-col gap-0.5 max-h-52 overflow-y-auto">
        {ghosts.map((e) => (
          <div
            key={e.id}
            className="text-xs font-mono py-0.5 px-2 rounded"
            style={{ color: "var(--text-primary)" }}
            title={e.currentPath}
          >
            {e.filename}
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={loading}>
          {t("library.cancel")}
        </Button>
        <Button variant="danger" onClick={handleConfirm} disabled={loading}>
          {loading ? t("library.purgeGhostsBusy") : t("library.purgeGhostsBtn")}
        </Button>
      </div>
    </Modal>
  );
}

function LibraryView({
  onOpen,
  showProgressBar,
  showPageCount,
  refreshTrigger,
  active = true,
}: {
  onOpen: (path: string, onComplete?: () => void, onPagesLoaded?: (total: number) => void, libraryId?: string) => void;
  showProgressBar: boolean;
  showPageCount: boolean;
  refreshTrigger: number;
  // Whether the library is the currently visible view. LibraryView stays
  // mounted across reader sessions; this flips false while reading and back to
  // true on return, which triggers a background re-scan of the filesystem.
  active?: boolean;
}) {
  const { t } = useTranslation();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [activeLibId, setActiveLibId] = useState<string | null>(null);
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [notFoundIds, setNotFoundIds] = useState<Set<string>>(new Set());
  const [librariesLoaded, setLibrariesLoaded] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");
  const [viewMode, setViewMode] = useState<ViewMode>("details");
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(() => sessionShowFavoritesOnly);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [tagEditorEntries, setTagEditorEntries] = useState<LibraryEntry[] | null>(null);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [recentTags, setRecentTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(() => new Set(sessionSelectedTags));
  const [ambiguousCandidates, setAmbiguousCandidates] = useState<Map<string, string[]>>(new Map());
  const [resolveTarget, setResolveTarget] = useState<{ entry: LibraryEntry; candidates: string[] } | null>(null);
  const [selectedFolders, setSelectedFolders] = useState<Map<string, "full" | "partial">>(new Map());
  const [moveFolderTarget, setMoveFolderTarget] = useState<LibraryEntry[] | null>(null);
  const [renameTarget, setRenameTarget] = useState<LibraryEntry | null>(null);
  const [availableFolders, setAvailableFolders] = useState<string[]>([]);
  const [deleteConfirmEntries, setDeleteConfirmEntries] = useState<LibraryEntry[] | null>(null);
  const [removeLibraryConfirm, setRemoveLibraryConfirm] = useState(false);
  const [purgeGhostsConfirm, setPurgeGhostsConfirm] = useState(false);
  // Read fresh when the confirm modal opens (the setting can change in
  // SettingsModal while LibraryView stays mounted), used for both the modal
  // wording and the purge decision below.
  const [keepDataOnRemove, setKeepDataOnRemove] = useState(true);
  const [pageMap, setPageMap] = useState<Map<string, number>>(new Map());
  const [bgScanQueue, setBgScanQueue] = useState<LibraryEntry[]>([]);
  const bgScanCancelRef = useRef(false);

  // Stable refs used inside callbacks to avoid stale closures without adding
  // frequently-changing values to useCallback dependency arrays.
  const selectedIdsRef = useRef<Set<string>>(selectedIds);
  selectedIdsRef.current = selectedIds;
  const entriesRef = useRef<LibraryEntry[]>(entries);
  entriesRef.current = entries;
  const notFoundIdsRef = useRef<Set<string>>(notFoundIds);
  notFoundIdsRef.current = notFoundIds;
  const lastCtrlSelectedIdRef = useRef<string | null>(null);
  const sortedRef = useRef<LibraryEntry[]>([]);
  const folderFilterLoadedForLibRef = useRef<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollRestoredRef = useRef(false);

  const activeLib = libraries.find((l) => l.id === activeLibId) ?? null;

  useEffect(() => {
    getLibraries().then((libs) => {
      setLibraries(libs);
      if (libs.length > 0) setActiveLibId(libs[0].id);
      setLibrariesLoaded(true);
    });
    getLibraryViewMode().then(setViewMode);
    getRecentTags().then(setRecentTags);
  }, []);

  const handleViewModeToggle = () => {
    const next: ViewMode = viewMode === "details" ? "grid" : "details";
    setViewMode(next);
    saveLibraryViewMode(next);
  };

  const scanRef = useRef(false);
  const scanAbortRef = useRef(false);
  // Library id whose initial scan has already completed in this mount. Gates
  // the background re-scan effect so it never runs before the first scan.
  const scannedLibRef = useRef<string | null>(null);

  // Phase B: scan the filesystem and reconcile it against a baseline set of
  // entries — relocations, new files, missing/ambiguous detection, sticky
  // metadata overlay and page-count queueing. `baseline` is the stored set on
  // the initial scan, or the live entries on a background re-scan when the user
  // returns to the library. Bails (leaving the rendered list untouched) if the
  // user opens a file mid-scan; the caller's finally clears the scan flags.
  const reconcileScan = useCallback(async (
    lib: Library,
    baseline: LibraryEntry[],
    allPageProgress: Map<string, number>,
  ) => {
    setScanning(true);
    const scanned = await invoke<ScannedFile[]>("scan_library", { root: lib.rootPath });

    // If the user opened a file while scan_library was running in Rust, drop
    // the results to avoid competing store writes with file loading. The scan
    // runs cleanly on the next library visit.
    if (scanAbortRef.current) return;

    const scannedByPath = new Map(scanned.map((f) => [f.path, f]));
    const storedById = new Map(baseline.map((e) => [e.id, e]));

    const newAmbiguous = new Map<string, string[]>();
    const updatedEntries = await Promise.all(
      baseline.map(async (entry) => {
        if (scannedByPath.has(entry.currentPath)) return entry;
        const matches = scanned.filter(
          (f) => f.filename === entry.filename && f.size_bytes === entry.sizeBytes
        );
        if (matches.length === 1) {
          await updateEntryPath(entry.id, entry.libraryId, matches[0].path);
          return { ...entry, currentPath: matches[0].path };
        }
        if (matches.length > 1) {
          newAmbiguous.set(entry.id, matches.map((f) => f.path));
        }
        return entry;
      })
    );
    setAmbiguousCandidates(newAmbiguous);

    const now = Math.floor(Date.now() / 1000);
    const newEntries: LibraryEntry[] = [];
    for (const file of scanned) {
      const id = makeEntryId(file.filename, file.size_bytes);
      if (!storedById.has(id)) {
        newEntries.push({
          id,
          libraryId: lib.id,
          currentPath: file.path,
          filename: file.filename,
          sizeBytes: file.size_bytes,
          modifiedAt: file.modified_secs,
          autoTags: [],
          customTags: [],
          isFavorite: false,
          addedAt: now,
          readingState: "unread",
        });
      }
    }

    // Apply auto-parse to any entry that has no autoTags yet (new or pre-feature).
    const needsTagging = [...updatedEntries, ...newEntries].filter((e) => e.autoTags.length === 0);
    for (const entry of needsTagging) {
      entry.autoTags = parseAutoTags(entry.filename);
    }

    const allEntries = [...updatedEntries, ...newEntries];

    // Sticky user metadata (tags/favorite/rating/readingState), keyed by entry
    // id and independent of the library. Overlay saved meta onto the entries so
    // it survives delete + re-add; entries with no saved meta backfill it from
    // their current values (first scan / pre-feature data), so nothing existing
    // is wiped. Runs before the upsert below so restored values get persisted
    // into the library blob.
    const metaMap = await getEntryMetaMap();
    const metaBackfill: { id: string; meta: EntryMeta }[] = [];
    for (const entry of allEntries) {
      const meta = metaMap.get(entry.id);
      if (meta) {
        entry.customTags = meta.customTags ?? [];
        entry.isFavorite = meta.isFavorite ?? false;
        entry.rating = meta.rating;
        entry.readingState = meta.readingState ?? "unread";
      } else {
        metaBackfill.push({
          id: entry.id,
          meta: {
            customTags: entry.customTags,
            isFavorite: entry.isFavorite,
            rating: entry.rating,
            readingState: entry.readingState,
          },
        });
      }
    }
    if (metaBackfill.length > 0) await batchSetEntryMeta(metaBackfill);

    const toUpsert = [...newEntries, ...needsTagging.filter((e) => !newEntries.includes(e))];
    if (toUpsert.length > 0) await upsertEntries(lib.id, toUpsert);

    // Mark entries absent from the scan as missing — scan_library does a full
    // recursive walk so any path not found is gone from the library root.
    // Ambiguous entries are excluded: they have candidates, just unresolved.
    const missing = new Set<string>();
    for (const entry of allEntries) {
      if (!scannedByPath.has(entry.currentPath) && !newAmbiguous.has(entry.id)) {
        missing.add(entry.id);
      }
    }

    setEntries(allEntries);
    setNotFoundIds(missing);

    const toCount = allEntries.filter((e) => e.totalPages === undefined && !missing.has(e.id));
    setBgScanQueue(toCount);

    const toRead = allEntries.filter(
      (e) => (e.totalPages ?? 0) > 0 && e.readingState !== "unread"
    );
    if (toRead.length > 0) {
      const pMap = new Map<string, number>();
      for (const entry of toRead) {
        const page = allPageProgress.get(entry.currentPath) ?? 0;
        if (page > 0) pMap.set(entry.id, page);
      }
      setPageMap(pMap);
    }
  }, []);

  // Initial scan on mount / library switch: Phase A renders stored entries +
  // reading progress immediately (interactive in <100ms), then Phase B
  // reconciles against the filesystem in the background.
  useEffect(() => {
    if (!activeLib) return;
    if (scanRef.current) return;
    scanRef.current = true;
    const lib = activeLib;

    (async () => {
      // Reset abort flag at the start of each scan cycle so a previous
      // handleOpen call doesn't cancel this fresh scan.
      scanAbortRef.current = false;
      try {
        const [stored, allPageProgress] = await Promise.all([
          getEntries(lib.id),
          getAllPageProgress(),
        ]);
        setEntries(stored);
        const initialToRead = stored.filter((e) => (e.totalPages ?? 0) > 0 && e.readingState !== "unread");
        if (initialToRead.length > 0) {
          const pMap = new Map<string, number>();
          for (const entry of initialToRead) {
            const page = allPageProgress.get(entry.currentPath) ?? 0;
            if (page > 0) pMap.set(entry.id, page);
          }
          setPageMap(pMap);
        }

        // Skip the filesystem scan if the user already opened a file during Phase A.
        if (scanAbortRef.current) return;
        await reconcileScan(lib, stored, allPageProgress);
        scannedLibRef.current = lib.id;
      } finally {
        setScanning(false);
        scanRef.current = false;
      }
    })();
  }, [activeLib, reconcileScan]);

  // Returning to the library (active flips false→true) after the initial scan
  // completed: re-reconcile against disk in the background so files added or
  // moved while away show up, without clearing the already-rendered list.
  useEffect(() => {
    if (!active || !activeLib) return;
    if (scannedLibRef.current !== activeLib.id) return;
    if (scanRef.current) return;
    scanRef.current = true;
    const lib = activeLib;

    (async () => {
      scanAbortRef.current = false;
      try {
        const allPageProgress = await getAllPageProgress();
        if (scanAbortRef.current) return;
        await reconcileScan(lib, entriesRef.current, allPageProgress);
      } finally {
        setScanning(false);
        scanRef.current = false;
      }
    })();
  }, [active, activeLib, reconcileScan]);

  const handleAddLibrary = async () => {
    const folder = await open({ directory: true, multiple: false });
    if (!folder || typeof folder !== "string") return;
    const name = basename(folder);
    const lib = await addLibrary(name, folder);
    setLibraries((prev) => [...prev, lib]);
    setActiveLibId(lib.id);
    setEntries([]);
  };

  const handleToggleFavorite = useCallback(async (entry: LibraryEntry) => {
    const next = !entry.isFavorite;
    await setFavorite(entry.id, entry.libraryId, next);
    setEntries((prev) => prev.map((e) => e.id === entry.id ? { ...e, isFavorite: next } : e));
  }, []);

  const handleOpen = useCallback((entry: LibraryEntry) => {
    scanAbortRef.current = true;
    const now = Math.floor(Date.now() / 1000);
    const onComplete = entry.readingState !== "completed"
      ? () => {
          setReadingState(entry.id, entry.libraryId, "completed").catch(console.error);
          setEntries((prev) =>
            prev.map((e) => e.id === entry.id ? { ...e, readingState: "completed" as const } : e)
          );
        }
      : undefined;
    const onPagesLoaded = (total: number) => {
      setTotalPages(entry.id, entry.libraryId, total).catch(console.error);
      setEntries((prev) =>
        prev.map((e) => e.id === entry.id ? { ...e, totalPages: total } : e)
      );
    };
    // Open the file immediately — store writes are fire-and-forget so they don't
    // block the reader from opening while a background scan may be active.
    onOpen(entry.currentPath, onComplete, onPagesLoaded, entry.libraryId);
    setLastOpenedAt(entry.id, entry.libraryId, now).catch(console.error);
    setEntries((prev) =>
      prev.map((e) => e.id === entry.id ? { ...e, lastOpenedAt: now } : e)
    );
    if (entry.readingState !== "completed") {
      setReadingState(entry.id, entry.libraryId, "in_progress").catch(console.error);
      setEntries((prev) =>
        prev.map((e) => e.id === entry.id ? { ...e, readingState: "in_progress" as const } : e)
      );
    }
  }, [onOpen]);

  const handleItemClick = useCallback((entry: LibraryEntry, e: MouseEvent) => {
    if (e.ctrlKey && e.shiftKey) {
      const last = lastCtrlSelectedIdRef.current;
      if (!last) {
        setSelectedIds((prev) => new Set([...prev, entry.id]));
        lastCtrlSelectedIdRef.current = entry.id;
        return;
      }
      const sortedList = sortedRef.current;
      const startIdx = sortedList.findIndex((s) => s.id === last);
      const endIdx = sortedList.findIndex((s) => s.id === entry.id);
      if (startIdx === -1 || endIdx === -1) return;
      const [lo, hi] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
      const rangeIds = sortedList.slice(lo, hi + 1).map((s) => s.id);
      setSelectedIds((prev) => new Set([...prev, ...rangeIds]));
    } else if (e.ctrlKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(entry.id)) next.delete(entry.id);
        else next.add(entry.id);
        return next;
      });
      lastCtrlSelectedIdRef.current = entry.id;
    } else {
      setSelectedIds(new Set());
    }
  }, []);

  const handleContextMenu = useCallback((entry: LibraryEntry, x: number, y: number) => {
    const ids = selectedIdsRef.current;
    if (ids.has(entry.id) && ids.size > 1) {
      const menuEntries = entriesRef.current.filter((e) => ids.has(e.id));
      setContextMenu({ x, y, entries: menuEntries });
    } else {
      setSelectedIds(new Set());
      setContextMenu({ x, y, entries: [entry] });
    }
  }, []);

  const handleResetProgress = useCallback(async (targetEntries: LibraryEntry[]) => {
    for (const entry of targetEntries) {
      await setReadingState(entry.id, entry.libraryId, "unread");
    }
    const ids = new Set(targetEntries.map((e) => e.id));
    setEntries((prev) =>
      prev.map((e) => ids.has(e.id) ? { ...e, readingState: "unread" as const } : e)
    );
    setContextMenu(null);
  }, []);

  const handleMarkAsRead = useCallback(async (targetEntries: LibraryEntry[]) => {
    for (const entry of targetEntries) {
      await setReadingState(entry.id, entry.libraryId, "completed");
    }
    const ids = new Set(targetEntries.map((e) => e.id));
    setEntries((prev) =>
      prev.map((e) => ids.has(e.id) ? { ...e, readingState: "completed" as const } : e)
    );
    setContextMenu(null);
  }, []);

  const handleCopyFilename = useCallback((targetEntries: LibraryEntry[]) => {
    const text = targetEntries.map((e) => e.filename).join("\n");
    navigator.clipboard.writeText(text).catch(console.error);
    setContextMenu(null);
  }, []);

  const handleRate = useCallback(async (entry: LibraryEntry, rating: number | undefined) => {
    await setRating(entry.id, entry.libraryId, rating);
    setEntries((prev) => prev.map((e) => e.id === entry.id ? { ...e, rating } : e));
  }, []);

  const handleMoveToFolder = useCallback(async (targetEntries: LibraryEntry[], targetFolder: string) => {
    const rootPath = normalizePath(activeLib?.rootPath ?? "");
    const destDir = targetFolder === "/" ? rootPath : `${rootPath}/${targetFolder}`;

    if (targetFolder !== "/") {
      await mkdir(destDir, { recursive: true });
    }

    const movedPaths = new Map<string, string>();
    for (const entry of targetEntries) {
      const newPath = `${destDir}/${entry.filename}`;
      const normalizedCurrent = normalizePath(entry.currentPath);
      if (normalizedCurrent === newPath) continue;
      await rename(entry.currentPath, newPath);
      await updateEntryPath(entry.id, entry.libraryId, newPath);
      movedPaths.set(entry.id, newPath);
    }

    setEntries((prev) =>
      prev.map((e) => movedPaths.has(e.id) ? { ...e, currentPath: movedPaths.get(e.id)! } : e)
    );
    setMoveFolderTarget(null);
  }, [activeLib]);

  // Renames the file on disk and migrates every id-/path-keyed record, since the
  // entry id is derived from the filename ({filename}::{sizeBytes}). Returns
  // false (without renaming) when a file already exists at the destination, so
  // the modal can stay open for the user to choose another name.
  const handleRename = useCallback(async (entry: LibraryEntry, newFilename: string): Promise<boolean> => {
    if (newFilename === entry.filename) { setRenameTarget(null); return true; }

    // Preserve the original directory and path separator, swapping only the
    // basename. Keeping the separator style avoids a needless relocation on the
    // next scan (which compares against the OS-native path from scan_library).
    const sep = Math.max(entry.currentPath.lastIndexOf("/"), entry.currentPath.lastIndexOf("\\"));
    const newPath = entry.currentPath.slice(0, sep + 1) + newFilename;

    if (await exists(newPath)) return false;
    await rename(entry.currentPath, newPath);

    const oldId = entry.id;
    const newId = makeEntryId(newFilename, entry.sizeBytes);
    const newEntry: LibraryEntry = {
      ...entry,
      id: newId,
      filename: newFilename,
      currentPath: newPath,
      autoTags: parseAutoTags(newFilename),
    };

    await removeEntry(oldId, entry.libraryId);
    await upsertEntry(newEntry);
    await renameEntryMeta(oldId, newId);
    await migrateReadingProgress(entry.currentPath, newPath);
    await clearThumbnailDiskCache([oldId]);

    setEntries((prev) => prev.map((e) => e.id === oldId ? newEntry : e));
    setSelectedIds((prev) => {
      if (!prev.has(oldId)) return prev;
      const next = new Set(prev);
      next.delete(oldId);
      next.add(newId);
      return next;
    });
    setPageMap((prev) => {
      if (!prev.has(oldId)) return prev;
      const next = new Map(prev);
      next.set(newId, next.get(oldId)!);
      next.delete(oldId);
      return next;
    });
    setNotFoundIds((prev) => {
      if (!prev.has(oldId)) return prev;
      const next = new Set(prev);
      next.delete(oldId);
      return next;
    });
    setAmbiguousCandidates((prev) => {
      if (!prev.has(oldId)) return prev;
      const next = new Map(prev);
      next.delete(oldId);
      return next;
    });
    setRenameTarget(null);
    return true;
  }, []);

  const handleDeleteEntries = useCallback(async (targetEntries: LibraryEntry[]) => {
    for (const entry of targetEntries) {
      await invoke("trash_file", { path: entry.currentPath });
      await removeEntry(entry.id, entry.libraryId);
    }
    const deletedIds = new Set(targetEntries.map((e) => e.id));
    setEntries((prev) => prev.filter((e) => !deletedIds.has(e.id)));
    setSelectedIds((prev) => {
      if ([...prev].some((id) => deletedIds.has(id))) {
        const next = new Set(prev);
        for (const id of deletedIds) next.delete(id);
        return next;
      }
      return prev;
    });
    setDeleteConfirmEntries(null);
  }, []);

  const handlePurgeGhosts = useCallback(async (ghostEntries: LibraryEntry[]) => {
    for (const entry of ghostEntries) {
      await removeEntry(entry.id, entry.libraryId);
    }
    const purgedIds = new Set(ghostEntries.map((e) => e.id));
    setEntries((prev) => prev.filter((e) => !purgedIds.has(e.id)));
    setNotFoundIds((prev) => {
      const next = new Set(prev);
      for (const id of purgedIds) next.delete(id);
      return next;
    });
    setSelectedIds((prev) => {
      if ([...prev].some((id) => purgedIds.has(id))) {
        const next = new Set(prev);
        for (const id of purgedIds) next.delete(id);
        return next;
      }
      return prev;
    });
    setPurgeGhostsConfirm(false);
  }, []);

  // Persist a batch of per-entry customTags updates (store write-through +
  // optimistic local state). Shared by the per-entry TagEditor and the
  // library-wide TagManager (rename/recolor/delete).
  const persistCustomTagUpdates = useCallback(async (updates: { id: string; tags: Tag[] }[]) => {
    if (updates.length === 0) return;
    const firstEntry = entriesRef.current.find((e) => e.id === updates[0].id);
    if (!firstEntry) return;
    await batchSetCustomTags(firstEntry.libraryId, updates);
    const updateMap = new Map(updates.map(({ id, tags }) => [id, tags]));
    setEntries((prev) =>
      prev.map((e) => updateMap.has(e.id) ? { ...e, customTags: updateMap.get(e.id)! } : e)
    );
  }, []);

  const handleTagSave = useCallback(async (updates: { id: string; tags: Tag[] }[]) => {
    await persistCustomTagUpdates(updates);
  }, [persistCustomTagUpdates]);

  const handleRecordRecentTags = useCallback(async (values: string[]) => {
    await pushRecentTags(values);
    setRecentTags(await getRecentTags());
  }, []);

  // Rename a custom tag across the whole library. If an entry already carries
  // the destination value, the rename merges (dedupe, keeping first occurrence).
  const handleRenameTag = useCallback(async (from: string, to: string) => {
    const updates = entriesRef.current
      .filter((e) => e.customTags.some((t) => t.value === from))
      .map((e) => {
        const renamed = e.customTags.map((t) => t.value === from ? { ...t, value: to } : t);
        const seen = new Set<string>();
        const tags: Tag[] = [];
        for (const t of renamed) {
          if (!seen.has(t.value)) { seen.add(t.value); tags.push(t); }
        }
        return { id: e.id, tags };
      });
    await persistCustomTagUpdates(updates);
    setSelectedTags((prev) => {
      if (!prev.has(from)) return prev;
      const next = new Set(prev);
      next.delete(from);
      next.add(to);
      return next;
    });
    // Drop the stale old value from recents and surface the new one in its place.
    await removeRecentTags([from]);
    await handleRecordRecentTags([to]);
  }, [persistCustomTagUpdates, handleRecordRecentTags]);

  // Set the same color on a custom tag across every entry that carries it.
  const handleRecolorTag = useCallback(async (value: string, color: string | undefined) => {
    const updates = entriesRef.current
      .filter((e) => e.customTags.some((t) => t.value === value))
      .map((e) => ({
        id: e.id,
        tags: e.customTags.map((t) => t.value === value ? { ...t, color } : t),
      }));
    await persistCustomTagUpdates(updates);
  }, [persistCustomTagUpdates]);

  // Remove a custom tag from every entry in the library.
  const handleDeleteTag = useCallback(async (value: string) => {
    const updates = entriesRef.current
      .filter((e) => e.customTags.some((t) => t.value === value))
      .map((e) => ({ id: e.id, tags: e.customTags.filter((t) => t.value !== value) }));
    await persistCustomTagUpdates(updates);
    setSelectedTags((prev) => {
      if (!prev.has(value)) return prev;
      const next = new Set(prev);
      next.delete(value);
      return next;
    });
    // A deleted tag shouldn't keep surfacing in the recents quick-pick.
    await removeRecentTags([value]);
    setRecentTags(await getRecentTags());
  }, [persistCustomTagUpdates]);

  const handleResolveLocation = useCallback(async (entry: LibraryEntry, chosenPath: string) => {
    await updateEntryPath(entry.id, entry.libraryId, chosenPath);
    setAmbiguousCandidates((prev) => {
      const next = new Map(prev);
      next.delete(entry.id);
      return next;
    });
    setNotFoundIds((prev) => {
      const next = new Set(prev);
      next.delete(entry.id);
      return next;
    });
    setEntries((prev) =>
      prev.map((e) => e.id === entry.id ? { ...e, currentPath: chosenPath } : e)
    );
    setResolveTarget(null);
  }, []);

  // Escape clears selection (runs regardless of contextMenu so Escape covers both).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedIds(new Set());
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    sessionSelectedTags = selectedTags;
  }, [selectedTags]);

  useEffect(() => {
    sessionShowFavoritesOnly = showFavoritesOnly;
  }, [showFavoritesOnly]);

  useEffect(() => {
    if (!activeLibId) {
      setSelectedFolders(new Map());
      return;
    }
    folderFilterLoadedForLibRef.current = null;
    getSavedFolderFilter(activeLibId).then((saved) => {
      setSelectedFolders(saved);
      folderFilterLoadedForLibRef.current = activeLibId;
    });
  }, [activeLibId]);

  useEffect(() => {
    if (!activeLibId || folderFilterLoadedForLibRef.current !== activeLibId) return;
    saveFolderFilter(activeLibId, selectedFolders).catch(console.error);
  }, [selectedFolders, activeLibId]);

  const openRemoveLibraryConfirm = useCallback(async () => {
    setKeepDataOnRemove(await getKeepDataOnRemove());
    setRemoveLibraryConfirm(true);
  }, []);

  const handleRemoveLibrary = useCallback(async () => {
    if (!activeLib) return;
    const removedId = activeLib.id;
    const remaining = libraries.filter((l) => l.id !== removedId);

    // When "forget" is selected, drop the sticky metadata for files that were
    // only in this library (keep it for files still present in another library).
    if (!keepDataOnRemove) {
      const removedEntries = await getEntries(removedId);
      const idsInOtherLibs = new Set<string>();
      for (const lib of remaining) {
        for (const e of await getEntries(lib.id)) idsInOtherLibs.add(e.id);
      }
      const toForget = removedEntries
        .map((e) => e.id)
        .filter((id) => !idsInOtherLibs.has(id));
      await deleteEntryMeta(toForget);
    }

    await removeLibrary(removedId);
    setLibraries(remaining);
    setActiveLibId(remaining.length > 0 ? remaining[0].id : null);
    setEntries([]);
    setNotFoundIds(new Set());
  }, [activeLib, libraries, keepDataOnRemove]);

  // Background page-count scan: processes entries without totalPages one at a time.
  useEffect(() => {
    if (bgScanQueue.length === 0) return;
    bgScanCancelRef.current = false;

    (async () => {
      for (const entry of bgScanQueue) {
        if (bgScanCancelRef.current) break;
        try {
          const count = await countPages(entry);
          if (bgScanCancelRef.current) break;
          if (count !== null) {
            await setTotalPages(entry.id, entry.libraryId, count);
            setEntries((prev) =>
              prev.map((e) => e.id === entry.id ? { ...e, totalPages: count } : e)
            );
          }
        } catch {
          // skip entries that fail (not found, unsupported, etc.)
        }
      }
    })();

    return () => { bgScanCancelRef.current = true; };
  }, [bgScanQueue]);

  const handleRefreshMetadata = useCallback(async () => {
    if (!activeLibId) return;
    bgScanCancelRef.current = true;
    await clearAllTotalPages(activeLibId);
    const ids = entriesRef.current.map((e) => e.id);
    await clearThumbnailDiskCache(ids);
    const cleared = entriesRef.current.map((e) => ({ ...e, totalPages: undefined as number | undefined }));
    setEntries(cleared);
    setBgScanQueue(cleared.filter((e) => !notFoundIdsRef.current.has(e.id)));
  }, [activeLibId]);

  useEffect(() => {
    if (refreshTrigger === 0) return;
    handleRefreshMetadata();
  }, [refreshTrigger, handleRefreshMetadata]);

  const handleSortClick = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir(field === "lastOpened" || field === "pages" ? "desc" : "asc"); }
  };

  const sortIndicator = (field: SortField) =>
    sortField !== field ? null : (sortDir === "asc" ? " ↑" : " ↓");

  // All tags across the library with their entry counts.
  const allTags = useMemo(() => {
    const map = new Map<string, { tag: Tag; count: number }>();
    for (const entry of entries) {
      for (const tag of [...entry.autoTags, ...entry.customTags]) {
        const existing = map.get(tag.value);
        if (existing) {
          existing.count++;
          if (!existing.tag.color && tag.color) existing.tag = { ...tag };
        } else {
          map.set(tag.value, { tag: { ...tag }, count: 1 });
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      const aSelected = selectedTags.has(a.tag.value);
      const bSelected = selectedTags.has(b.tag.value);
      if (aSelected !== bSelected) return aSelected ? -1 : 1;
      return b.count - a.count;
    });
  }, [entries, selectedTags]);

  const allTagValues = useMemo(() => allTags.map(({ tag }) => tag.value), [allTags]);

  const allFolders = useMemo(() => {
    const rootPath = activeLib?.rootPath ?? "";
    const set = new Set<string>();
    for (const entry of entries) {
      set.add(getRelativeFolder(entry.currentPath, rootPath));
    }
    return Array.from(set).sort((a, b) => {
      if (a === "/") return -1;
      if (b === "/") return 1;
      return a.localeCompare(b);
    });
  }, [entries, activeLib]);

  const filtered = entries.filter((e) => {
    if (showFavoritesOnly && !e.isFavorite) return false;
    if (search.trim() !== "" && !e.filename.toLowerCase().includes(search.trim().toLowerCase())) return false;
    if (selectedTags.size > 0) {
      const vals = new Set([...e.autoTags, ...e.customTags].map((t) => t.value));
      for (const tag of selectedTags) {
        if (!vals.has(tag)) return false;
      }
    }
    if (selectedFolders.size > 0) {
      const rootPath = activeLib?.rootPath ?? "";
      const entryFolder = getRelativeFolder(e.currentPath, rootPath);
      const matches = [...selectedFolders.entries()].some(([folder, mode]) => {
        if (mode === "full") {
          if (folder === "/") return true;
          return entryFolder === folder || entryFolder.startsWith(folder + "/");
        }
        return entryFolder === folder;
      });
      if (!matches) return false;
    }
    return true;
  });

  const filteredGhosts = filtered.filter((e) => notFoundIds.has(e.id));

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    switch (sortField) {
      case "name":   cmp = a.filename.localeCompare(b.filename, undefined, { numeric: true }); break;
      case "size":   cmp = a.sizeBytes - b.sizeBytes; break;
      case "date":   cmp = a.modifiedAt - b.modifiedAt; break;
      case "folder": {
        const fa = normalizePath(a.currentPath).lastIndexOf("/");
        const fb = normalizePath(b.currentPath).lastIndexOf("/");
        cmp = a.currentPath.slice(0, fa).localeCompare(b.currentPath.slice(0, fb));
        break;
      }
      case "lastOpened": cmp = (a.lastOpenedAt ?? 0) - (b.lastOpenedAt ?? 0); break;
      case "pages":      cmp = (a.totalPages ?? 0) - (b.totalPages ?? 0); break;
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  // Keep ref in sync for range-selection inside handleItemClick.
  sortedRef.current = sorted;

  // Restore the saved scroll position once the list is tall enough to scroll
  // (one-shot per mount). useLayoutEffect avoids a top-then-jump flash.
  useLayoutEffect(() => {
    if (scrollRestoredRef.current) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    if (sessionScrollTop > 0 && el.scrollHeight > el.clientHeight) {
      el.scrollTop = sessionScrollTop;
      scrollRestoredRef.current = true;
    }
  }, [sorted.length]);

  const colHeaderClass = "flex items-center gap-1 cursor-pointer select-none text-xs font-medium uppercase tracking-wide hover:text-[var(--text-primary)] transition-colors";

  return (
    <div className="flex flex-col h-full" style={{ color: "var(--text-primary)" }}>
      {/* Library selector + view toggle + actions */}
      <div className="flex items-center gap-3 px-4 py-2 border-b shrink-0" style={{ borderColor: "var(--border-nav)" }}>
        {libraries.length > 1 && (
          <select
            value={activeLibId ?? ""}
            onChange={(e) => { setActiveLibId(e.target.value); setEntries([]); setBgScanQueue([]); setSearch(""); }}
            className="text-sm rounded px-2 py-1"
            style={{ background: "var(--bg-tab-active)", color: "var(--text-primary)", border: "1px solid var(--border-nav)" }}
          >
            {libraries.map((lib) => (
              <option key={lib.id} value={lib.id}>{lib.name}</option>
            ))}
          </select>
        )}
        {activeLib && libraries.length <= 1 && (
          <span className="text-sm font-medium truncate" style={{ color: "var(--text-secondary)" }}>
            {activeLib.name}
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* Folders filter dropdown */}
          <FilterDropdown
            label={t("library.folders")}
            selectedCount={selectedFolders.size}
            searchPlaceholder={t("library.searchFolders")}
            width={240}
            onClear={() => setSelectedFolders(new Map())}
            renderItems={(folderSearch) =>
              (folderSearch.trim()
                ? allFolders.filter((f) => f.toLowerCase().includes(folderSearch.trim().toLowerCase()))
                : allFolders
              ).map((folder) => {
                const state = selectedFolders.get(folder);
                return (
                  <button
                    key={folder}
                    onClick={() => {
                      setSelectedFolders((prev) => {
                        const next = new Map(prev);
                        const cur = next.get(folder);
                        if (!cur) next.set(folder, "full");
                        else if (cur === "full") next.set(folder, "partial");
                        else next.delete(folder);
                        return next;
                      });
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors hover:bg-[var(--bg-tab-active)]"
                    style={{ color: state ? "var(--text-primary)" : "var(--text-secondary)" }}
                  >
                    <span
                      className="shrink-0 w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold"
                      style={{
                        border: state ? "none" : "1px solid var(--text-muted)",
                        background: state === "full"
                          ? "var(--color-selection)"
                          : state === "partial"
                            ? "transparent"
                            : "transparent",
                        color: state === "full"
                          ? "#fff"
                          : state === "partial"
                            ? "var(--text-primary)"
                            : "transparent",
                        ...(state === "partial" ? { border: "1px solid var(--text-primary)" } : {}),
                      }}
                    >
                      {state === "full" ? "✓" : state === "partial" ? "—" : ""}
                    </span>
                    <span className="flex-1 truncate font-mono">{folder}</span>
                  </button>
                );
              })
            }
          />

          {/* Tags filter dropdown */}
          <FilterDropdown
            label={t("library.tags")}
            selectedCount={selectedTags.size}
            searchPlaceholder={t("library.searchTags")}
            width={220}
            onClear={() => setSelectedTags(new Set())}
            renderItems={(tagSearch) => {
              const visibleTags = tagSearch.trim()
                ? allTags.filter((tg) => tg.tag.value.toLowerCase().includes(tagSearch.trim().toLowerCase()))
                : allTags;
              return (
                <>
                  {visibleTags.length === 0 && (
                    <p className="px-3 py-2 text-xs" style={{ color: "var(--text-muted)" }}>
                      {t("library.noTags")}
                    </p>
                  )}
                  {visibleTags.map(({ tag, count }) => {
                    const active = selectedTags.has(tag.value);
                    return (
                      <button
                        key={tag.value}
                        onClick={() => {
                          setSelectedTags((prev) => {
                            const next = new Set(prev);
                            if (next.has(tag.value)) next.delete(tag.value);
                            else next.add(tag.value);
                            return next;
                          });
                        }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors hover:bg-[var(--bg-tab-active)]"
                        style={{
                          color: active ? "var(--text-primary)" : "var(--text-secondary)",
                          fontWeight: active ? 600 : undefined,
                        }}
                      >
                        <span
                          className="shrink-0 w-2 h-2 rounded-full"
                          style={{ background: tag.color ?? "var(--text-muted)" }}
                        />
                        <span className="flex-1 truncate">{tag.value}</span>
                        <span style={{ color: "var(--text-muted)" }}>{count}</span>
                      </button>
                    );
                  })}
                </>
              );
            }}
            footer={
              <button
                onClick={() => setTagManagerOpen(true)}
                className="w-full px-3 py-1.5 text-xs text-left transition-colors hover:bg-[var(--bg-tab-active)]"
                style={{ color: "var(--text-secondary)" }}
              >
                {t("library.manageTags")}
              </button>
            }
          />

          {/* Purge ghosts button — visible only when filtered view contains ghost entries */}
          {filteredGhosts.length > 0 && (
            <button
              onClick={() => setPurgeGhostsConfirm(true)}
              title={t("library.purgeGhosts")}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors"
              style={{
                background: "var(--bg-tab-active)",
                color: "var(--color-danger)",
                border: "1px solid var(--border-nav)",
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                aria-hidden="true">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              {filteredGhosts.length}
            </button>
          )}

          {/* Favorites filter */}
          <button
            onClick={() => setShowFavoritesOnly((v) => !v)}
            title={t("library.favoritesOnly")}
            className="p-1.5 rounded transition-colors"
            style={{
              background: showFavoritesOnly ? "var(--color-favorite)" : "var(--bg-tab-active)",
              color: showFavoritesOnly ? "#fff" : "var(--text-secondary)",
              border: "1px solid var(--border-nav)",
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
              fill={showFavoritesOnly ? "currentColor" : "none"}
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </button>

          {/* View mode toggle */}
          <button
            onClick={handleViewModeToggle}
            title={viewMode === "details" ? t("library.viewGrid") : t("library.viewDetails")}
            className="p-1.5 rounded transition-colors"
            style={{
              background: "var(--bg-tab-active)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border-nav)",
            }}
          >
            {viewMode === "details" ? <GridIcon /> : <DetailsIcon />}
          </button>

          {scanning && entries.length > 0 && (
            <div
              className="w-3.5 h-3.5 border-2 border-t-transparent rounded-full animate-spin shrink-0"
              style={{ borderColor: "var(--text-muted)", borderTopColor: "transparent" }}
              title={t("library.scanning")}
            />
          )}

          {activeLib && (
            <button
              onClick={openRemoveLibraryConfirm}
              className="text-xs px-2 py-1 rounded transition-colors"
              style={{ color: "var(--text-muted)" }}
              title={t("library.removeLibrary")}
            >
              ✕
            </button>
          )}
          <button
            onClick={handleAddLibrary}
            className="text-xs px-3 py-1 rounded-lg font-medium transition-all duration-200 hover:shadow-[0_0_20px_var(--glow)] hover:-translate-y-px"
            style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
          >
            + {t("library.addLibrary")}
          </button>
        </div>
      </div>

      {!librariesLoaded ? (
        <div className="flex-1 flex items-center justify-center py-8" style={{ color: "var(--text-muted)" }}>
          <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin mr-2"
            style={{ borderColor: "var(--text-muted)", borderTopColor: "transparent" }} />
          {t("library.scanning")}
        </div>
      ) : libraries.length === 0 ? (
        <div className="flex-1 flex items-center justify-center px-8 text-center" style={{ color: "var(--text-muted)" }}>
          <p className="max-w-sm">{t("library.noLibraries")}</p>
        </div>
      ) : (
        <>
          {/* Search */}
          <div className="flex items-center gap-2 px-4 py-2 shrink-0 border-b" style={{ borderColor: "var(--border-nav)" }}>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("library.search")}
              className="flex-1 text-sm rounded-lg px-3 py-1.5 outline-none transition-colors bg-[var(--bg-tab-active)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] border border-[var(--border-nav)] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--glow-soft)]"
            />
            <span className="text-sm shrink-0 tabular-nums" style={{ color: "var(--text-secondary)" }}>
              {t("library.resultCount", { count: filtered.length })}
            </span>
          </div>

          {/* Column headers — details mode only */}
          {viewMode === "details" && (
            <div
              className="flex items-center gap-4 px-4 py-2 border-b shrink-0"
              style={{ borderColor: "var(--border-nav)", color: "var(--text-muted)" }}
            >
              <div className={COL_STAR} />
              <div className={COL_RATING} />
              <button className={`${colHeaderClass} ${COL_WIDTHS.name}`} onClick={() => handleSortClick("name")}>
                {t("library.colName")}{sortIndicator("name")}
              </button>
              <button className={`${colHeaderClass} ${COL_WIDTHS.size} justify-end`} onClick={() => handleSortClick("size")}>
                {t("library.colSize")}{sortIndicator("size")}
              </button>
              <button className={`${colHeaderClass} ${COL_WIDTHS.date}`} onClick={() => handleSortClick("date")}>
                {t("library.colDate")}{sortIndicator("date")}
              </button>
              <button className={`${colHeaderClass} ${COL_WIDTHS.folder}`} onClick={() => handleSortClick("folder")}>
                {t("library.colFolder")}{sortIndicator("folder")}
              </button>
              <button className={`${colHeaderClass} ${COL_WIDTHS.lastOpened}`} onClick={() => handleSortClick("lastOpened")}>
                {t("library.colLastOpened")}{sortIndicator("lastOpened")}
              </button>
              <button className={`${colHeaderClass} ${COL_WIDTHS.pages} justify-end`} onClick={() => handleSortClick("pages")}>
                {t("library.colPages")}{sortIndicator("pages")}
              </button>
            </div>
          )}

          {/* Content */}
          <div
            ref={scrollContainerRef}
            className="flex-1 overflow-y-auto"
            onScroll={(e) => { sessionScrollTop = e.currentTarget.scrollTop; }}
            onClick={(e) => { if (e.target === e.currentTarget) setSelectedIds(new Set()); }}
          >
            {scanning && entries.length === 0 && (
              <div className="flex items-center justify-center py-8" style={{ color: "var(--text-muted)" }}>
                <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin mr-2"
                  style={{ borderColor: "var(--text-muted)", borderTopColor: "transparent" }} />
                {t("library.scanning")}
              </div>
            )}
            {!scanning && sorted.length === 0 && (
              <div className="flex items-center justify-center py-8 px-8 text-center" style={{ color: "var(--text-muted)" }}>
                {t("library.empty")}
              </div>
            )}

            {viewMode === "details"
              ? sorted.map((entry) => (
                  <LibraryDetailsRow
                    key={entry.id}
                    entry={entry}
                    rootPath={activeLib?.rootPath ?? ""}
                    notFound={notFoundIds.has(entry.id)}
                    ambiguous={ambiguousCandidates.has(entry.id)}
                    selected={selectedIds.has(entry.id)}
                    onOpen={handleOpen}
                    onSelect={handleItemClick}
                    onToggleFavorite={handleToggleFavorite}
                    onRate={handleRate}
                    onContextMenu={handleContextMenu}
                    showProgressBar={showProgressBar}
                    currentPage={pageMap.get(entry.id) ?? 0}
                  />
                ))
              : (
                <div
                  className="p-4"
                  style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "1.25rem" }}
                  onClick={(e) => { if (e.target === e.currentTarget) setSelectedIds(new Set()); }}
                >
                  {sorted.map((entry) => (
                    <LibraryCard
                      key={entry.id}
                      entry={entry}
                      notFound={notFoundIds.has(entry.id)}
                      ambiguous={ambiguousCandidates.has(entry.id)}
                      selected={selectedIds.has(entry.id)}
                      onOpen={handleOpen}
                      onSelect={handleItemClick}
                      onToggleFavorite={handleToggleFavorite}
                      onRate={handleRate}
                      onContextMenu={handleContextMenu}
                      showProgressBar={showProgressBar}
                      currentPage={pageMap.get(entry.id) ?? 0}
                      showPageCount={showPageCount}
                    />
                  ))}
                </div>
              )
            }

            {contextMenu && (
              <ContextMenu
                x={contextMenu.x}
                y={contextMenu.y}
                entries={contextMenu.entries}
                ambiguousCandidates={ambiguousCandidates}
                onOpenInNewWindow={(entry) => { invoke("open_new_window", { path: entry.currentPath, libraryId: entry.libraryId }).catch(console.error); setContextMenu(null); }}
                onEditTags={(entries) => { setTagEditorEntries(entries); setContextMenu(null); }}
                onResolveLocation={(entry, candidates) => { setResolveTarget({ entry, candidates }); setContextMenu(null); }}
                onResetProgress={handleResetProgress}
                onMarkAsRead={handleMarkAsRead}
                onMoveToFolder={async (entries) => {
                  const folders = await invoke<string[]>("list_subdirs", { root: activeLib!.rootPath });
                  setAvailableFolders(folders);
                  setMoveFolderTarget(entries);
                  setContextMenu(null);
                }}
                onRename={(entry) => { setRenameTarget(entry); setContextMenu(null); }}
                onCopyFilename={handleCopyFilename}
                onDelete={(entries) => {
                  const allGhost = entries.every((e) => notFoundIds.has(e.id));
                  if (allGhost) handleDeleteEntries(entries);
                  else setDeleteConfirmEntries(entries);
                  setContextMenu(null);
                }}
                onClose={() => setContextMenu(null)}
              />
            )}
          </div>
        </>
      )}

      {tagEditorEntries && (
        <TagEditor
          entries={tagEditorEntries}
          onSave={handleTagSave}
          onClose={() => setTagEditorEntries(null)}
          allTagValues={allTagValues}
          recentTags={recentTags}
          onRecordRecent={handleRecordRecentTags}
        />
      )}

      {tagManagerOpen && (
        <TagManager
          entries={entries}
          onRename={handleRenameTag}
          onRecolor={handleRecolorTag}
          onDelete={handleDeleteTag}
          onClose={() => setTagManagerOpen(false)}
        />
      )}

      {moveFolderTarget && (
        <MoveFolderModal
          entries={moveFolderTarget}
          folders={availableFolders}
          rootPath={activeLib?.rootPath ?? ""}
          onMove={handleMoveToFolder}
          onClose={() => setMoveFolderTarget(null)}
        />
      )}

      {renameTarget && (
        <RenameModal
          entry={renameTarget}
          onRename={handleRename}
          onClose={() => setRenameTarget(null)}
        />
      )}

      {deleteConfirmEntries && (
        <DeleteConfirmModal
          entries={deleteConfirmEntries}
          onConfirm={() => handleDeleteEntries(deleteConfirmEntries)}
          onClose={() => setDeleteConfirmEntries(null)}
        />
      )}

      {removeLibraryConfirm && activeLib && (
        <RemoveLibraryConfirmModal
          libraryName={activeLib.name}
          keepData={keepDataOnRemove}
          onConfirm={() => { handleRemoveLibrary(); setRemoveLibraryConfirm(false); }}
          onClose={() => setRemoveLibraryConfirm(false)}
        />
      )}

      {resolveTarget && (
        <ResolveLocationModal
          entry={resolveTarget.entry}
          candidates={resolveTarget.candidates}
          rootPath={activeLib?.rootPath ?? ""}
          onResolve={handleResolveLocation}
          onClose={() => setResolveTarget(null)}
        />
      )}

      {purgeGhostsConfirm && (
        <PurgeGhostsModal
          ghosts={filteredGhosts}
          onConfirm={() => handlePurgeGhosts(filteredGhosts)}
          onClose={() => setPurgeGhostsConfirm(false)}
        />
      )}
    </div>
  );
}

export default LibraryView;
